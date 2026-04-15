import { Prompt, type PromptRef } from "@tui/component/prompt"
import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { parse as parsePartial } from "partial-json"
import { useTerminalDimensions } from "@opentui/solid"
import { Sidebar } from "../session/sidebar"
import { useProject } from "../../context/project"
import { Toast } from "../../ui/toast"
import { useRoute, useRouteData } from "@tui/context/route"
import { usePromptRef } from "../../context/prompt"
import { useTheme } from "../../context/theme"
import { useSDK } from "../../context/sdk"
import { useSync } from "../../context/sync"
import { useToast } from "../../ui/toast"
import { useCommandDialog } from "@tui/component/dialog-command"
import { useArgs } from "../../context/args"
import { useEvent } from "../../context/event"
import { useLocal } from "../../context/local"
import { useKV } from "../../context/kv"
import { DialogModel } from "../../component/dialog-model"
import { QuestionPrompt } from "../session/question"
import type { PromptInfo } from "../../component/prompt/history"
import { MessageID, PartID } from "@/session/schema"
import { Logo } from "../../component/logo"

const placeholders = {
  normal: [
    "Implement a gcd function with tests",
    "Fix the failing test in src/math",
    "Write a helper to parse a duration string",
  ],
  shell: ["bun test", "git status", "ls -la"],
}

const DUAL_KEY = "dual.sessions"
const DUAL_MAP_KEY = "dual.sessions.map"
const DUAL_FLOW_KEY = "dual.flow.mode"
const MODE_KEY = "agent.mode"
const DETAIL_KEY = "dual.detail"

/** Persistent across user messages: the two child sessions the orchestrator
 *  iterates on. First submit creates them; every subsequent submit reuses them
 *  so the chat appends to one continuous conversation instead of resetting. */
type DualSessions = {
  parentSessionID: string
  studentSessionID: string
  supervisorSessionID: string
}

/** Ephemeral per-run state. Reset on `dual.finished` so the next user message
 *  can spin up a fresh iteration on the same sessions. */
type DualRun = {
  runID: string
  status: "starting" | "running" | "pass" | "fail" | "error" | "budget_exceeded" | "aborted"
  round: number
}

type DualSubtask = {
  agent: string
  description: string
  prompt: string
}

/**
 * Try to pull a JSON object out of an assistant message. The orchestrator
 * prompts Student / Supervisor to emit strict JSON; providers sometimes wrap
 * it in ```json fences or prefix it with prose. This is the minimal client-
 * side reader — we don't need the full server-side extractor's recovery paths
 * because we're only showing the happy path in the UI.
 */
function parseJSON(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = (match ? match[1] : trimmed).trim()
  try {
    return JSON.parse(body) as Record<string, unknown>
  } catch {
    const brace = body.indexOf("{")
    const last = body.lastIndexOf("}")
    if (brace >= 0 && last > brace) {
      try {
        return JSON.parse(body.slice(brace, last + 1)) as Record<string, unknown>
      } catch {
        return undefined
      }
    }
    return undefined
  }
}

/**
 * Best-effort partial parse of a streaming envelope. Returns whatever fields
 * the model has emitted SO FAR — letting the UI surface them as they arrive
 * instead of waiting for the closing brace. Falls back to the strict parser
 * (handles ```json fences) once the stream completes.
 *
 * Used by the [phd] / [supervisor] panels to hide the raw JSON envelope and
 * render only the human-readable fields (artifact / main_issue / evidence /
 * repair_hint) as live markdown.
 */
function parseEnvelopePartial(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/)
  const body = (match ? match[1] : trimmed).trim()
  const brace = body.indexOf("{")
  if (brace < 0) return undefined
  try {
    return parsePartial(body.slice(brace)) as Record<string, unknown>
  } catch {
    return parseJSON(text)
  }
}

function looksLikeEnvelope(text: string): boolean {
  const t = text.trimStart()
  return t.startsWith("{") || t.startsWith("```json") || t.startsWith("```\n{") || t.startsWith("```{")
}

function str(v: unknown): string {
  return typeof v === "string" ? v : ""
}

function tex(body: string) {
  const repl = (raw: string) =>
    raw
      .trim()
      .replace(/\\frac\s*\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)")
      .replace(/\\cdot/g, "·")
      .replace(/\\times/g, "×")
      .replace(/\\circ/g, "°")
      .replace(/\\ln\b/g, "ln")
      .replace(/\\log\b/g, "log")
      .replace(/\\leq/g, "≤")
      .replace(/\\geq/g, "≥")
      .replace(/\^\{([^{}]+)\}/g, "^($1)")
      .replace(/_\{([^{}]+)\}/g, "_($1)")
      .replace(/\\([A-Za-z]+)/g, "$1")
  const chunks = body.split(/(```[\s\S]*?```)/g)
  return chunks
    .map((chunk) => {
      if (chunk.startsWith("```")) return chunk
      return chunk
        .replace(/\$\$([\s\S]+?)\$\$/g, (_m, eq) => `\n${repl(eq)}\n`)
        .replace(/\$([^$\n]+)\$/g, (_m, eq) => repl(eq))
    })
    .join("")
}

/**
 * Interactive Student ↔ Supervisor dual-agent view.
 *
 * Layout is a single chronological timeline — "Student said X, Supervisor
 * reviewed, Student revised" — not a split pane. Both child sessions' messages
 * are merged on `time.created` so the transcript reads like a conversation.
 */
export function Dual() {
  const { theme, syntax, subtleSyntax } = useTheme()
  const project = useProject()
  const router = useRoute()
  const route = useRouteData("dual")
  const promptRef = usePromptRef()
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()
  const command = useCommandDialog()
  const args = useArgs()
  const event = useEvent()
  const local = useLocal()
  const kv = useKV()
  const dimensions = useTerminalDimensions()
  // Sidebar shows when the terminal is wide enough — same threshold the
  // single-session route uses so layouts feel consistent across modes.
  const sidebarVisible = createMemo(() => dimensions().width > 120)
  const [, setRef] = createSignal<PromptRef | undefined>()
  const [sessions, setSessions] = createSignal<DualSessions | undefined>(
    (() => {
      const mode = kv.get(MODE_KEY, "auto")
      if (mode === "single") return
      if (!route.sessionID) return
      const map = kv.get(DUAL_MAP_KEY) as Record<string, DualSessions> | undefined
      return map?.[route.sessionID]
    })(),
  )
  const [run, setRun] = createSignal<DualRun | undefined>()
  const [detail, setDetail] = createSignal(!!kv.get(DETAIL_KEY, false))
  const active = createMemo(() => {
    const sid = route.sessionID
    if (!sid) return
    const s = sessions()
    if (s?.parentSessionID === sid) return s
    const map = kv.get(DUAL_MAP_KEY) as Record<string, DualSessions> | undefined
    return map?.[sid]
  })
  const busy = createMemo(() => {
    const value = run()
    if (!value) return false
    return value.status === "starting" || value.status === "running"
  })
  // Per-agent model override. Set by /model / /model1 / /model2 even before a
  // run starts; passed to dual.start as `studentModel` / `supervisorModel`.
  // While a run IS active the slash commands ALSO call sdk.dual.model() to
  // swap server-side for the next phase.
  type ModelSpec = { providerID: string; modelID: string }
  const [studentModel, setStudentModel] = createSignal<ModelSpec | undefined>()
  const [supervisorModel, setSupervisorModel] = createSignal<ModelSpec | undefined>()
  const mode = createMemo(() => {
    const saved = kv.get(MODE_KEY, "auto")
    if (saved === "single" || saved === "dual" || saved === "auto") return saved
    return "auto"
  })
  const pick = (spec: ModelSpec | undefined) => {
    const cur = spec ?? local.model.current()
    if (!cur) return "No model"
    const p = sync.data.provider.find((x) => x.id === cur.providerID)
    return p?.models[cur.modelID]?.name ?? cur.modelID
  }
  const models = createMemo(() => {
    if (mode() === "single") {
      const cur = local.model.current()
      if (!cur) {
        return (
          <box flexDirection="row" gap={1}>
            <text fg={theme.text}>No model</text>
          </box>
        )
      }
      const p = sync.data.provider.find((x) => x.id === cur.providerID)
      const name = p?.models[cur.modelID]?.name ?? cur.modelID
      const provider = p?.name ?? cur.providerID
      return (
        <box flexDirection="row" gap={1}>
          <text fg={theme.primary}>{provider}</text>
          <text fg={theme.text}>{name}</text>
        </box>
      )
    }
    const phd = pick(studentModel())
    const sup = pick(supervisorModel())
    return (
      <box flexDirection="row" gap={1}>
        <text fg={theme.primary}>phd</text>
        <text fg={theme.text}>{phd}</text>
        <text fg={theme.textMuted}>|</text>
        <text fg={theme.accent}>supervisor</text>
        <text fg={theme.text}>{sup}</text>
      </box>
    )
  })
  let once = false
  let seen: string | undefined

  // Keep client state in sync with server-side dual events.
  event.on("dual.phase.started", (e) => {
    setRun((r) =>
      r && r.runID === e.properties.runID ? { ...r, status: "running", round: e.properties.round } : r,
    )
  })
  event.on("dual.finished", (e) => {
    setRun((r) => {
      if (!r || r.runID !== e.properties.runID) return r
      return { ...r, status: e.properties.status as DualRun["status"] }
    })
  })
  // After supervisor fails a round, the orchestrator pauses on a between-rounds
  // gate waiting for an explicit advance. Auto-release it so the loop keeps
  // iterating until it either passes, exhausts maxRounds, or the user aborts
  // via esc. Without this the run appears to "stop after one round" — the
  // orchestrator is still alive but blocked at gate.wait().
  event.on("dual.verdict", (e) => {
    const r = run()
    if (!r || r.runID !== e.properties.runID) return
    if (e.properties.status === "pass") return
    sdk.client.dual.advance({ runID: e.properties.runID }).catch(() => {})
  })
  createEffect(() => {
    const s = sessions()
    if (!s) return
    kv.set(DUAL_KEY, s)
    const map = (kv.get(DUAL_MAP_KEY) as Record<string, DualSessions> | undefined) ?? {}
    kv.set(DUAL_MAP_KEY, { ...map, [s.parentSessionID]: s })
  })
  createEffect(() => {
    const sid = route.sessionID
    if (!sid) return
    const map = kv.get(DUAL_MAP_KEY) as Record<string, DualSessions> | undefined
    const match = Object.values(map ?? {}).find((x) => x.studentSessionID === sid || x.supervisorSessionID === sid)
    if (!match) return
    if (match.parentSessionID === sid) return
    router.navigate({ type: "dual", sessionID: match.parentSessionID })
  })
  createEffect(() => {
    const sid = route.sessionID
    if (sid !== seen) {
      setRun(undefined)
      seen = sid
    }
    if (!sid) {
      setSessions(undefined)
      return
    }
    if (mode() === "single") {
      setSessions(undefined)
      return
    }
    const cur = sessions()
    if (cur?.parentSessionID === sid) return
    const map = kv.get(DUAL_MAP_KEY) as Record<string, DualSessions> | undefined
    const hit = map?.[sid]
    if (hit) {
      setSessions(hit)
      return
    }
    if (cur) setSessions(undefined)
  })
  const child = createMemo(() => {
    const sid = route.sessionID
    if (!sid) return [] as Array<[string, "phd" | "supervisor"]>
    const list = sync.data.session as Array<{ id: string; parentID?: string; title?: string }>
    return list
      .filter((x) => x.parentID === sid)
      .map((x) => [x.id, x.title?.startsWith("Supervisor ·") ? "supervisor" : "phd"] as [string, "phd" | "supervisor"])
  })
  createEffect(() => {
    const s = active()
    const ids = [
      route.sessionID,
      ...child().map((x) => x[0]),
      s?.parentSessionID,
      s?.studentSessionID,
      s?.supervisorSessionID,
    ].filter(
      (x): x is string => !!x,
    )
    const uniq = [...new Set(ids)]
    uniq.forEach((id) => {
      void sync.session.sync(id)
    })
  })

  /** Run a slash command that needs the dual sessions. `needRun=true` also
   *  requires an active run (advance/abort/model — no point otherwise). */
  const withSessions = async (
    label: string,
    needRun: boolean,
    fn: (s: DualSessions, r?: DualRun) => Promise<void>,
  ) => {
    const s = active()
    if (!s) {
      toast.show({ message: `no dual sessions yet (${label}) — send a task first`, variant: "error" })
      return
    }
    const r = run()
    if (needRun && !r) {
      toast.show({ message: `no active dual run (${label})`, variant: "error" })
      return
    }
    try {
      await fn(s, r)
    } catch (e) {
      toast.show({ message: `${label} failed: ${String(e)}`, variant: "error" })
    }
  }

  command.register(() => [
    {
      title: detail() ? "Use compact output" : "Use detailed output",
      value: "dual.detail",
      category: "Dual",
      keybind: "ctrl+o",
      onSelect: (d) => {
        const next = !detail()
        setDetail(next)
        kv.set(DETAIL_KEY, next)
        toast.show({ message: next ? "Detailed mode on" : "Detailed mode off", variant: "info" })
        d.clear()
      },
    },
    {
      title: "Clear conversation (you, phd, supervisor)",
      value: "dual.clear",
      category: "Dual",
      slash: { name: "clear" },
      onSelect: (d) =>
        // Clear all three sessions so the visible chat is wiped end-to-end.
        // The parent session holds the [you] messages — without clearing it
        // the user's prompts stay on screen even after phd/supervisor are
        // wiped, which is the opposite of what /clear should do.
        withSessions("clear", false, async (s) => {
          await Promise.all([
            sdk.client.session.clear({ sessionID: s.parentSessionID }),
            sdk.client.session.clear({ sessionID: s.studentSessionID }),
            sdk.client.session.clear({ sessionID: s.supervisorSessionID }),
          ])
          d.clear()
        }),
    },
    {
      title: "Clear phd messages",
      value: "dual.clear1",
      category: "Dual",
      slash: { name: "clear1" },
      onSelect: (d) =>
        withSessions("clear1", false, async (s) => {
          await sdk.client.session.clear({ sessionID: s.studentSessionID })
          d.clear()
        }),
    },
    {
      title: "Clear supervisor messages",
      value: "dual.clear2",
      category: "Dual",
      slash: { name: "clear2" },
      onSelect: (d) =>
        withSessions("clear2", false, async (s) => {
          await sdk.client.session.clear({ sessionID: s.supervisorSessionID })
          d.clear()
        }),
    },
    {
      title: "Switch model (phd + supervisor)",
      value: "dual.model",
      category: "Dual",
      slash: { name: "model" },
      onSelect: (d) => {
        d.replace(() => (
          <DialogModel
            title="Switch both agents' model"
            current={studentModel() ?? supervisorModel() ?? local.model.current()}
            onSelect={async (providerID, modelID) => {
              const spec = { providerID, modelID }
              setStudentModel(spec)
              setSupervisorModel(spec)
              // Also update the global model store so the bottom bar, the
              // single-mode submit path (mode === "single" within dual route),
              // and the next /model open all see the new selection.
              local.model.set(spec, { recent: true })
              const r = run()
              if (r) {
                await sdk.client.dual.model({
                  runID: r.runID,
                  dualModelRequest: {
                    student: spec as never,
                    supervisor: spec as never,
                  },
                })
              }
            }}
          />
        ))
      },
    },
    {
      title: "Switch phd model",
      value: "dual.model1",
      category: "Dual",
      slash: { name: "model1" },
      onSelect: (d) => {
        d.replace(() => (
          <DialogModel
            title="Switch PhD's model"
            current={studentModel() ?? local.model.current()}
            onSelect={async (providerID, modelID) => {
              const spec = { providerID, modelID }
              setStudentModel(spec)
              local.model.set(spec, { recent: true })
              const r = run()
              if (r) {
                await sdk.client.dual.model({
                  runID: r.runID,
                  dualModelRequest: { student: spec as never },
                })
              }
            }}
          />
        ))
      },
    },
    {
      title: "Switch supervisor model",
      value: "dual.model2",
      category: "Dual",
      slash: { name: "model2" },
      onSelect: (d) => {
        d.replace(() => (
          <DialogModel
            title="Switch Supervisor's model"
            current={supervisorModel() ?? local.model.current()}
            onSelect={async (providerID, modelID) => {
              const spec = { providerID, modelID }
              setSupervisorModel(spec)
              const r = run()
              if (r) {
                await sdk.client.dual.model({
                  runID: r.runID,
                  dualModelRequest: { supervisor: spec as never },
                })
              }
            }}
          />
        ))
      },
    },
  ])

  const bind = (r: PromptRef | undefined) => {
    setRef(r)
    promptRef.set(r)
    if (once || !r) return
    if (route.initialPrompt) {
      r.set(route.initialPrompt)
      once = true
      return
    }
    if (args.prompt) {
      r.set({ input: args.prompt, parts: [] })
      once = true
    }
  }

  const abort = async () => {
    const value = run()
    if (!value) return
    await sdk.client.dual.abort({ runID: value.runID }).catch(() => {})
    setRun(undefined)
  }

  // Diagnostic: shows a toast the moment onCustomSubmit fires so we can tell
  // whether Enter is reaching this handler vs bailing somewhere upstream. The
  // toast stays on screen a couple seconds — adjust/remove once the flow is
  // confirmed working end-to-end.
  const onCustomSubmit = async (prompt: PromptInfo) => {
    const text = prompt.input
    const origin = route.sessionID
    // Only block if there's an active run (starting/running). Finished runs
    // (pass/fail/error/aborted/budget_exceeded) are no longer live — the next
    // Enter starts a fresh orchestrator iteration on the SAME child sessions.
    const r = run()
    if (r && (r.status === "starting" || r.status === "running")) {
      toast.show({
        message: `dual run ${r.status} (round ${r.round}); wait for it or press esc twice to interrupt`,
        variant: "info",
      })
      return
    }
    if (mode() === "single") {
      let sid = route.sessionID
      if (!sid) {
        const created = await sdk.client.session.create({
          workspaceID: project.workspace.current(),
        })
        if (created.error) {
          toast.show({ message: `create failed: ${JSON.stringify(created.error)}`, variant: "error" })
          return
        }
        sid = created.data.id
      }
      const selected = local.model.current()
      const variant = local.model.variant.current()
      const messageID = MessageID.ascending()
      await sdk.client.session
        .prompt({
          sessionID: sid,
          messageID,
          agent: local.agent.current().name,
          ...(selected ? selected : {}),
          ...(selected ? { model: selected } : {}),
          variant,
          parts: [{ id: PartID.ascending(), type: "text", text }] as never,
        })
        .catch(() => {})
      setRun(undefined)
      setSessions(undefined)
      if (route.sessionID !== sid) {
        router.navigate({ type: "dual", sessionID: sid })
      }
      return
    }

    // Every message after the first reuses the existing child sessions so the
    // conversation accumulates in one place — same mental model as native
    // opencode's single-session chat.
    const names = prompt.parts
      .filter((x): x is { type: "agent"; name: string } => x.type === "agent" && typeof x.name === "string")
      .map((x) => x.name.trim())
      .filter(Boolean)
      .filter((x, i, arr) => arr.indexOf(x) === i)
    const subtasks: DualSubtask[] = names.map((name) => ({
      agent: name,
      description: `Preflight via @${name}`,
      prompt: text,
    }))
    const existing = active()
    try {
      const stu = studentModel()
      const sup = supervisorModel()
      const flow =
        kv.get(DUAL_FLOW_KEY, "auto") === "auto"
          ? "auto"
          : local.agent.current().name === "plan"
            ? "strict"
            : "fast"

      // Pre-create the parent session if we don't already have one. We MUST
      // commit the user's [you] message before calling dual.start, otherwise
      // the orchestrator immediately spawns the student response and the
      // student's first message ends up with an earlier server timestamp than
      // the user prompt — which makes items().sort render the chat upside-down
      // ([phd] reply above [you] question). Pre-creating + prompting first
      // guarantees user-before-assistant chronology within the same round.
      let parentSessionID: string | undefined = existing?.parentSessionID ?? route.sessionID
      if (!parentSessionID) {
        const created = await sdk.client.session.create({
          workspaceID: project.workspace.current(),
        })
        if (created.error) {
          toast.show({ message: `create failed: ${JSON.stringify(created.error)}`, variant: "error" })
          return
        }
        parentSessionID = created.data.id
      }

      // Stamp the user message first so it precedes any assistant message the
      // orchestrator triggers in this round.
      await sdk.client.session
        .prompt({
          sessionID: parentSessionID,
          agent: local.agent.current().name,
          noReply: true,
          parts: [{ type: "text", text }],
        })
        .catch(() => {})

      const res = await sdk.client.dual.start({
        dualStartRequest: {
          task: text,
          mode: flow,
          // Cap the phd↔supervisor ping-pong. The TUI auto-advances on
          // supervisor-fail, so without a ceiling a weak phd model will
          // churn indefinitely. 3 rounds is enough for the common case
          // (initial attempt + 2 fix passes) while bounding worst-case
          // tokens/latency.
          maxRounds: 3,
          ...(subtasks.length > 0 ? { subtasks: subtasks as never } : {}),
          ...(stu ? { studentModel: stu as never } : {}),
          ...(sup ? { supervisorModel: sup as never } : {}),
          parentSessionID: parentSessionID as never,
          ...(existing
            ? {
                studentSessionID: existing.studentSessionID as never,
                supervisorSessionID: existing.supervisorSessionID as never,
              }
            : {}),
        },
      })
      if (res.error) {
        toast.show({ message: `start failed: ${JSON.stringify(res.error)}`, variant: "error" })
        return
      }
      const cur = route.sessionID
      if (cur !== origin && cur !== res.data.parentSessionID) return
      setSessions({
        parentSessionID: res.data.parentSessionID,
        studentSessionID: res.data.studentSessionID,
        supervisorSessionID: res.data.supervisorSessionID,
      })
      if (route.sessionID !== res.data.parentSessionID) {
        router.navigate({ type: "dual", sessionID: res.data.parentSessionID })
      }
      setRun({ runID: res.data.runID, status: "starting", round: 0 })
    } catch (e) {
      toast.show({ message: `start threw: ${String(e)}`, variant: "error" })
    }
  }

  // Merge user messages + child sessions' assistant messages into one
  // chronological list. The wrappers MUST keep stable identity across memo
  // ticks — without that, every sync update would create a new array of new
  // objects, making `<For>` tear down and re-mount every card on every
  // streaming token. The Map below caches one wrapper per stable id (task.id
  // for user entries, message.id for assistant entries) so `<For>` reuses DOM.
  type Item =
    | { kind: "you"; id: string; time: number; task: string }
    | {
        kind: "asst"
        id: string
        time: number
        agent: "phd" | "supervisor"
        message: { id: string; role: string; sessionID: string; time?: { created?: number; completed?: number } }
      }
  const cache = new Map<string, Item>()
  const items = createMemo<Item[]>(() => {
    const out: Item[] = []
    const root = route.sessionID
    if (root) {
      const msgs = sync.data.message[root] ?? []
      for (const m of msgs) {
        if (m.role !== "user") continue
        const parts = sync.data.part[m.id] ?? []
        const task = parts
          .map((x) => {
            const p = x as { type: string; text?: string; synthetic?: boolean }
            if (p.type !== "text") return ""
            if (p.synthetic) return ""
            return typeof p.text === "string" ? p.text.trim() : ""
          })
          .filter(Boolean)
          .join("\n")
          .trim()
        if (!task) continue
        let w = cache.get(m.id)
        if (!w || w.kind !== "you") {
          w = { kind: "you", id: m.id, time: m.time?.created ?? 0, task }
          cache.set(m.id, w)
        }
        out.push(w)
      }
    }
    const s = active()
    const by = new Map<string, "phd" | "supervisor">()
    const add = (sid: string | undefined, agent: "phd" | "supervisor") => {
      if (!sid) return
      const cur = by.get(sid)
      if (cur === "supervisor") return
      by.set(sid, agent)
    }
    for (const [sid, agent] of child()) {
      add(sid, agent)
    }
    if (s) {
      add(s.parentSessionID, "phd")
      add(s.studentSessionID, "phd")
      add(s.supervisorSessionID, "supervisor")
    }
    if (by.size === 0) {
      add(route.sessionID, "phd")
    }
    const sids = [...by.entries()] as Array<[string, "phd" | "supervisor"]>
    for (const [sid, agent] of sids) {
      const msgs = sync.data.message[sid] ?? []
      for (const m of msgs) {
        if (m.role !== "assistant") continue
        let w = cache.get(m.id)
        if (!w || w.kind !== "asst") {
          w = { kind: "asst", id: m.id, time: m.time?.created ?? 0, agent, message: m }
          cache.set(m.id, w)
        }
        out.push(w)
      }
    }
    return out.sort((a, b) => a.time - b.time)
  })
  const questions = createMemo(() => {
    const s = active()
    const ids = [
      route.sessionID,
      ...child().map((x) => x[0]),
      s?.parentSessionID,
      s?.studentSessionID,
      s?.supervisorSessionID,
    ].filter((x): x is string => !!x)
    const uniq = [...new Set(ids)]
    return uniq.flatMap((id) => sync.data.question[id] ?? [])
  })
  const sidebarID = createMemo(() => active()?.parentSessionID ?? route.sessionID)

  return (
    <Show
      when={items().length > 0}
      fallback={
        <box width="100%" height="100%" flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1}>
          <box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column">
            <Logo />
            <box paddingTop={1} flexDirection="column" alignItems="center" flexShrink={0}>
              <text fg={theme.text}>
                {mode() === "single" ? "Single agent" : "Dual agent"}{" "}
                <span style={{ fg: theme.textMuted }}>
                  {mode() === "auto" ? "with adaptive review" : "with phd + supervisor"}
                </span>
              </text>
            </box>
            <box width="100%" maxWidth={84} paddingTop={2}>
              <Prompt
                ref={bind}
                visible={true}
                launch={true}
                sessionID={route.sessionID}
                busy={busy()}
                onInterrupt={abort}
                workspaceID={project.workspace.current()}
                onCustomSubmit={onCustomSubmit}
                placeholders={placeholders}
                right={models()}
              />
            </box>
          </box>
          <Toast />
        </box>
      }
    >
      {/* Active conversation view — main column (timeline + prompt) on the
          left, the shared opencode Sidebar on the right when the terminal
          is wide enough. Sidebar reads the parent session id so the title
          ("dual: <task>") and working directory show up naturally. */}
      <box flexDirection="row" flexGrow={1}>
      <box flexGrow={1} paddingBottom={1} paddingLeft={1} paddingRight={1} gap={1}>
        <scrollbox
          flexGrow={1}
          flexShrink={1}
          stickyScroll={true}
          stickyStart="bottom"
        >
          <For each={items()}>
            {(item) => {
              if (item.kind === "you") {
                return (
                  <box flexDirection="column" marginTop={1} flexShrink={0}>
                    <text fg={theme.textMuted}>[you]</text>
                    <box paddingTop={1} paddingLeft={2}>
                      <text fg={theme.text}>{item.task}</text>
                    </box>
                  </box>
                )
              }
              return (
                <AsstCard
                  item={item}
                  detail={detail()}
                  theme={theme}
                  syntax={syntax}
                  subtleSyntax={subtleSyntax}
                  sync={sync}
                />
              )
            }}
          </For>
        </scrollbox>

        <Show when={questions().length > 0}>
          <QuestionPrompt request={questions()[0]} />
        </Show>
        <Show when={questions().length === 0}>
          <box flexShrink={0}>
            <Prompt
              ref={bind}
              visible={true}
              sessionID={route.sessionID}
              busy={busy()}
              onInterrupt={abort}
              workspaceID={project.workspace.current()}
              onCustomSubmit={onCustomSubmit}
              placeholders={placeholders}
              right={models()}
            />
          </box>
        </Show>
        <Toast />
      </box>
        <Show when={sidebarVisible() && sidebarID()}>
          <Sidebar sessionID={sidebarID()!} />
        </Show>
      </box>
    </Show>
  )
}

/**
 * Terminal-native block for one assistant message — Student or Supervisor.
 * Reads parts
 * directly from `sync.data.part[message.id]` so each part keeps its store
 * identity across streaming ticks; `<For>` reuses DOM and the markdown
 * component re-renders content reactively without remounting.
 *
 * Mirrors native opencode's `AssistantMessage` -> per-part `<Dynamic>`
 * pattern, just simplified for the dual-agent scope:
 *   - reasoning  → muted markdown ("_Thinking:_ …")
 *   - tool       → "✓ tool_name" with status colour
 *   - text       → parsed JSON summary (artifact / evidence) once complete,
 *                  raw text fallback otherwise
 */
function AsstCard(props: {
  item: { agent: "phd" | "supervisor"; message: { id: string; sessionID: string; time?: { completed?: number } } }
  detail: boolean
  theme: ReturnType<typeof useTheme>["theme"]
  syntax: ReturnType<typeof useTheme>["syntax"]
  subtleSyntax: ReturnType<typeof useTheme>["subtleSyntax"]
  sync: ReturnType<typeof useSync>
}) {
  const accent = () => (props.item.agent === "phd" ? props.theme.primary : props.theme.accent)
  const parts = createMemo(() => props.sync.data.part[props.item.message.id] ?? [])
  const completed = createMemo(() => {
    const list = props.sync.data.message[props.item.message.sessionID] ?? []
    const cur = list.find((x) => x.id === props.item.message.id) as { time?: { completed?: number } } | undefined
    return !!cur?.time?.completed
  })
  // Lift verdict from the (parsed) text part so the header can show PASS/FAIL.
  const verdict = createMemo(() => {
    if (props.item.agent !== "supervisor") return undefined
    if (!completed()) return undefined
    for (const p of parts()) {
      const pp = p as { type: string; text?: string }
      if (pp.type === "text" && pp.text) {
        const json = parseJSON(pp.text)
        if (json) return str(json.status) || "fail"
      }
    }
    return undefined
  })
  // Always mount the message block the moment the message exists — even before the
  // first part arrives — so the user gets immediate feedback that the agent
  // is responding. The body fills in reactively as parts stream.
  return (
    <box flexDirection="column" marginTop={1} flexShrink={0}>
      <box>
        <text fg={accent()}>[{props.item.agent}]</text>
        <Show when={verdict()}>
          <text fg={verdict() === "pass" ? props.theme.success : props.theme.error}>
            {" "}· {verdict()!.toUpperCase()}
          </text>
        </Show>
      </box>
      <box flexDirection="column" paddingLeft={2}>
        <box>
          <For each={parts()}>
            {(part) => (
              <PartBlock
                part={part as never}
                agent={props.item.agent}
                detail={props.detail}
                completed={completed()}
                theme={props.theme}
                syntax={props.syntax}
                subtleSyntax={props.subtleSyntax}
              />
            )}
          </For>
        </box>
      </box>
    </box>
  )
}

function PartBlock(props: {
  part: {
    type: string
    text?: string
    tool?: string
    state?: { status?: string; input?: Record<string, unknown>; output?: unknown; error?: string }
  }
  agent: "phd" | "supervisor"
  detail: boolean
  completed: boolean
  theme: ReturnType<typeof useTheme>["theme"]
  syntax: ReturnType<typeof useTheme>["syntax"]
  subtleSyntax: ReturnType<typeof useTheme>["subtleSyntax"]
}) {
  // Reasoning — stream live with subtle markdown styling, same as native.
  if (props.part.type === "reasoning") {
    if (!props.detail) return null
    const text = () => (props.part.text ?? "").trim()
    return (
      <Show when={text()}>
        <box paddingTop={1}>
          <markdown
            syntaxStyle={props.subtleSyntax()}
            streaming={true}
            content={"_Thinking:_ " + text()}
            fg={props.theme.textMuted}
          />
        </box>
      </Show>
    )
  }
  // Tool calls — short status line. Status icon ◉/✓/✗ + tool name.
  if (props.part.type === "tool") {
    const status = () => props.part.state?.status ?? "running"
    const icon = () =>
      status() === "completed" ? "✓" : status() === "error" ? "✗" : "◉"
    const color = () =>
      status() === "completed"
        ? props.theme.success
        : status() === "error"
          ? props.theme.error
          : props.theme.textMuted
    const clip = (text: string, n = 90) => (text.length > n ? text.slice(0, n) + "…" : text)
    const input = props.part.state?.input ?? {}
    const brief = () => {
      const one =
        (typeof input["filePath"] === "string" && input["filePath"]) ||
        (typeof input["path"] === "string" && input["path"]) ||
        (typeof input["pattern"] === "string" && input["pattern"]) ||
        (typeof input["query"] === "string" && input["query"]) ||
        (typeof input["description"] === "string" && input["description"]) ||
        (typeof input["command"] === "string" && input["command"]) ||
        (typeof input["url"] === "string" && input["url"]) ||
        (typeof input["name"] === "string" && input["name"]) ||
        ""
      return clip(one)
    }
    const label = () => {
      if (props.part.tool === "read") return "Read"
      if (props.part.tool === "write") return "Write"
      if (props.part.tool === "edit") return "Edit"
      if (props.part.tool === "bash") return "Shell"
      if (props.part.tool === "glob") return "Search (glob)"
      if (props.part.tool === "grep") return "Search (grep)"
      if (props.part.tool === "webfetch") return "Fetch web"
      if (props.part.tool === "websearch") return "Search web"
      if (props.part.tool === "task") return "Run task"
      if (props.part.tool === "task_complete") return "Task complete"
      if (props.part.tool === "todowrite") return "Todo"
      if (props.part.tool === "apply_patch") return "Apply patch"
      if (props.part.tool === "question") return "Ask user"
      if (props.part.tool === "skill") return "Run skill"
      return props.part.tool ?? "tool"
    }
    if (!props.detail) {
      return (
        <box paddingTop={1}>
          <text fg={color()}>
            ● {label()}
            <Show when={brief()}>
              {" "}{brief()}
            </Show>
          </text>
        </box>
      )
    }
    return (
      <box paddingTop={1}>
        <text fg={color()}>
          {icon()} {props.part.tool ?? "tool"}
        </text>
      </box>
    )
  }
  // Text — for envelope-shaped output (the StudentOutput / SupervisorOutput
  // JSON the orchestrator demands), hide the raw JSON and render only the
  // human-readable fields as streaming markdown. Plain-text replies (e.g. a
  // "你好" that PhD answered chattily without producing JSON) are passed
  // through untouched.
  //
  // In detail mode, additional fields (changes_made, repair_hint, etc.) are
  // shown beneath the headline so debugging the dual loop stays possible.
  if (props.part.type === "text") {
    const raw = () => props.part.text ?? ""
    const trimmed = () => raw().trim()
    const isEnvelope = createMemo(() => looksLikeEnvelope(trimmed()))
    const envelope = createMemo(() => {
      if (!isEnvelope()) return undefined
      return parseEnvelopePartial(trimmed())
    })
    const phdView = createMemo(() => {
      if (props.agent !== "phd") return undefined
      const j = envelope()
      if (!j) return undefined
      const body = str(j.artifact)
      const understanding = str(j.task_understanding)
      const changes = Array.isArray(j.changes_made)
        ? (j.changes_made as unknown[]).map(String).filter(Boolean)
        : []
      const sc = j.self_check && typeof j.self_check === "object" ? (j.self_check as Record<string, unknown>) : undefined
      const risk = sc ? str(sc.remaining_risk) : ""
      const ask = str(j.request_for_supervisor)
      return { body, understanding, changes, risk, ask }
    })
    const supView = createMemo(() => {
      if (props.agent !== "supervisor") return undefined
      const j = envelope()
      if (!j) return undefined
      const status = str(j.status) || (Object.keys(j).length === 0 ? "" : "fail")
      const issue = str(j.main_issue)
      const evidence = str(j.evidence)
      const repair = str(j.repair_hint)
      return { status, issue, evidence, repair }
    })
    // Plain non-envelope text (chat-style reply): just render as-is.
    if (!isEnvelope()) {
      return (
        <Show when={trimmed()}>
          <box paddingTop={1}>
            <markdown
              syntaxStyle={props.syntax()}
              streaming={true}
              content={tex(trimmed())}
              fg={props.theme.markdownText}
              bg={props.theme.background}
            />
          </box>
        </Show>
      )
    }
    // Envelope detected but parser hasn't extracted anything yet — show a
    // subtle placeholder so the user knows the agent is generating, instead
    // of a blank panel.
    return (
      <>
        <Show when={props.agent === "phd" && phdView()}>
          <Show when={phdView()!.understanding && (props.detail || !phdView()!.body)}>
            <box paddingTop={1}>
              <markdown
                syntaxStyle={props.subtleSyntax()}
                streaming={true}
                content={"_Understanding:_ " + tex(phdView()!.understanding)}
                fg={props.theme.textMuted}
              />
            </box>
          </Show>
          <Show when={phdView()!.body}>
            <box paddingTop={1}>
              <markdown
                syntaxStyle={props.syntax()}
                streaming={true}
                content={tex(phdView()!.body)}
                fg={props.theme.markdownText}
                bg={props.theme.background}
              />
            </box>
          </Show>
          <Show when={props.detail && phdView()!.changes.length > 0}>
            <box paddingTop={1}>
              <markdown
                syntaxStyle={props.subtleSyntax()}
                streaming={true}
                content={"_Changes:_\n" + phdView()!.changes.map((c) => `- ${tex(c)}`).join("\n")}
                fg={props.theme.textMuted}
              />
            </box>
          </Show>
          <Show when={props.detail && phdView()!.risk}>
            <box paddingTop={1}>
              <markdown
                syntaxStyle={props.subtleSyntax()}
                streaming={true}
                content={"_Risk:_ " + tex(phdView()!.risk)}
                fg={props.theme.textMuted}
              />
            </box>
          </Show>
          <Show when={props.detail && phdView()!.ask}>
            <box paddingTop={1}>
              <markdown
                syntaxStyle={props.subtleSyntax()}
                streaming={true}
                content={"_Ask supervisor:_ " + tex(phdView()!.ask)}
                fg={props.theme.textMuted}
              />
            </box>
          </Show>
        </Show>
        <Show when={props.agent === "supervisor" && supView()}>
          <Show when={supView()!.issue || supView()!.evidence}>
            <box paddingTop={1}>
              <markdown
                syntaxStyle={props.syntax()}
                streaming={true}
                content={tex(supView()!.evidence || supView()!.issue)}
                fg={props.theme.markdownText}
                bg={props.theme.background}
              />
            </box>
          </Show>
          <Show when={props.detail && supView()!.issue && supView()!.evidence}>
            <box paddingTop={1}>
              <markdown
                syntaxStyle={props.subtleSyntax()}
                streaming={true}
                content={"_Issue:_ " + tex(supView()!.issue)}
                fg={props.theme.textMuted}
              />
            </box>
          </Show>
          <Show when={supView()!.repair && supView()!.status !== "pass"}>
            <box paddingTop={1}>
              <markdown
                syntaxStyle={props.subtleSyntax()}
                streaming={true}
                content={"_Fix:_ " + tex(supView()!.repair)}
                fg={props.theme.textMuted}
              />
            </box>
          </Show>
        </Show>
        <Show when={!phdView() && !supView()}>
          <box paddingTop={1}>
            <text fg={props.theme.textMuted}>…</text>
          </box>
        </Show>
      </>
    )
  }
  const raw = (() => {
    const p = props.part as { text?: string }
    if (typeof p.text !== "string") return ""
    return p.text.trim()
  })()
  if (raw) {
    return (
      <box paddingTop={1}>
        <markdown
          syntaxStyle={props.syntax()}
          streaming={true}
          content={tex(raw.length > 800 ? raw.slice(0, 800) + "…" : raw)}
          fg={props.theme.markdownText}
          bg={props.theme.background}
        />
      </box>
    )
  }
  return null
}
