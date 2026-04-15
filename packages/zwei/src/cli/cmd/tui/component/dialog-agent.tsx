import { createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useRoute } from "@tui/context/route"
import { useKV } from "@tui/context/kv"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"

const DUAL_KEY = "dual.sessions"
const DUAL_MAP_KEY = "dual.sessions.map"
const DUAL_FLOW_KEY = "dual.flow.mode"
const MODE_KEY = "agent.mode"
const VERDICT_KEY = "dual.verdict.message"
const PACKET_KEY = "plan.packet.cache"

type DualSessions = {
  parentSessionID?: string
  studentSessionID?: string
  supervisorSessionID?: string
}

type PlanPacket = {
  l1: { goal: string; constraints: string; summary: string }
  l2: { current_step: string; checkpoints: string[]; verdict: string }
  l3: { evidence: string[]; risks: string[] }
}

function str(v: unknown): string {
  return typeof v === "string" ? v : ""
}

function one(v: unknown, n: number) {
  return str(v).trim().slice(0, n)
}

function list(v: unknown, n: number, size: number) {
  return str(v)
    .split("\n")
    .map((x) => x.trim())
    .map((x) => x.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, ""))
    .filter(Boolean)
    .filter((x, i, arr) => arr.indexOf(x) === i)
    .slice(0, n)
    .map((x) => x.slice(0, size))
}

function parseJSON(text: string): Record<string, unknown> | undefined {
  const trim = text.trim()
  if (!trim) return undefined
  const m = trim.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = (m ? m[1] : trim).trim()
  try {
    return JSON.parse(body) as Record<string, unknown>
  } catch {
    const s = body.indexOf("{")
    const e = body.lastIndexOf("}")
    if (s >= 0 && e > s) {
      try {
        return JSON.parse(body.slice(s, e + 1)) as Record<string, unknown>
      } catch {
        return undefined
      }
    }
    return undefined
  }
}

function packet(text: string): PlanPacket | undefined {
  const obj = parseJSON(text)
  if (obj && typeof obj["l1"] === "object" && typeof obj["l2"] === "object" && typeof obj["l3"] === "object") {
    const l1 = obj["l1"] as Record<string, unknown>
    const l2 = obj["l2"] as Record<string, unknown>
    const l3 = obj["l3"] as Record<string, unknown>
    const checkpoints = Array.isArray(l2["checkpoints"]) ? l2["checkpoints"].map((x) => one(x, 160)).filter(Boolean) : []
    const evidence = Array.isArray(l3["evidence"]) ? l3["evidence"].map((x) => one(x, 180)).filter(Boolean) : []
    const risks = Array.isArray(l3["risks"]) ? l3["risks"].map((x) => one(x, 180)).filter(Boolean) : []
    return {
      l1: {
        goal: one(l1["goal"], 240),
        constraints: one(l1["constraints"], 200),
        summary: one(l1["summary"], 280),
      },
      l2: {
        current_step: one(l2["current_step"], 420),
        checkpoints: checkpoints.slice(0, 6),
        verdict: one(l2["verdict"], 180),
      },
      l3: {
        evidence: evidence.slice(0, 6),
        risks: risks.slice(0, 6),
      },
    }
  }

  if (!obj) {
    const summary = one(text, 280)
    if (!summary) return undefined
    return {
      l1: {
        goal: "carry context across mode switch",
        constraints: "prefer compact packet over full history",
        summary,
      },
      l2: {
        current_step: one(text, 420),
        checkpoints: list(text, 4, 140),
        verdict: "context migrated",
      },
      l3: {
        evidence: [],
        risks: [],
      },
    }
  }

  const summary = one(obj["main_issue"] || obj["task_understanding"] || obj["summary"], 280)
  const step = one(obj["repair_hint"] || obj["artifact"] || obj["current_step"], 420)
  const cps = list(obj["repair_hint"] || obj["artifact"], 6, 160)
  const evidence = list(obj["evidence"], 6, 180)
  const risks = list(obj["memory_reminder"] || obj["remaining_risk"], 6, 180)
  if (!summary && !step) return undefined
  return {
    l1: {
      goal: one(obj["task_understanding"] || "carry plan context", 240),
      constraints: "plan packet only; no full-history replay",
      summary: summary || step,
    },
    l2: {
      current_step: step || summary,
      checkpoints: cps.length > 0 ? cps : ["continue from latest validated step"],
      verdict: one(obj["status"] || "pending", 180),
    },
    l3: {
      evidence,
      risks,
    },
  }
}

function pick(saved: DualSessions | undefined, sid: string | undefined) {
  if (!saved) return undefined
  if (sid && saved.parentSessionID !== sid) return undefined
  return saved
}

function findDual(
  kv: ReturnType<typeof useKV>,
  sid: string | undefined,
) {
  if (!sid) return undefined
  const map = kv.get(DUAL_MAP_KEY) as Record<string, DualSessions> | undefined
  if (sid && map?.[sid]) return map[sid]
  return pick(kv.get(DUAL_KEY) as DualSessions | undefined, sid)
}

function findLive(
  sync: ReturnType<typeof useSync>,
  sid: string | undefined,
) {
  if (!sid) return
  const list = sync.data.session as { id: string; parentID?: string; title?: string }[]
  const kids = list.filter((x) => x.parentID === sid)
  if (kids.length === 0) return
  const student = kids.find((x) => x.title?.startsWith("PhD ·") || x.title?.startsWith("Student ·"))?.id ?? sid
  const supervisor = kids.find((x) => x.title?.startsWith("Supervisor ·"))?.id
  if (!supervisor) return { parentSessionID: sid, studentSessionID: student }
  return { parentSessionID: sid, studentSessionID: student, supervisorSessionID: supervisor }
}

function visible(
  sync: ReturnType<typeof useSync>,
  sid: string | undefined,
) {
  if (!sid) return false
  const msgs = sync.data.message[sid] ?? []
  for (const msg of msgs) {
    const parts = sync.data.part[msg.id] ?? []
    for (const part of parts) {
      if (part.type !== "text") continue
      if (part.synthetic || part.ignored) continue
      if (part.text.trim()) return true
    }
  }
  return false
}

export function DialogAgent() {
  const local = useLocal()
  const dialog = useDialog()
  const route = useRoute()
  const kv = useKV()
  const sync = useSync()
  const sdk = useSDK()

  const options = createMemo(() => {
    const names = new Set(local.agent.list().map((item) => item.name))
    const out: { value: string; title: string; description: string }[] = []
    if (names.has("build")) {
      out.push(
        { value: "dual.build", title: "dual fast", description: "phd=build, supervisor on" },
        { value: "auto.build", title: "auto fast", description: "phd first, supervisor on demand" },
        { value: "single.build", title: "single fast", description: "supervisor off" },
      )
    }
    if (names.has("plan")) {
      out.push(
        { value: "dual.plan", title: "dual plan", description: "phd=plan, supervisor on" },
        { value: "auto.plan", title: "auto plan", description: "phd=plan, supervisor on demand" },
        { value: "single.plan", title: "single plan", description: "supervisor off" },
      )
    }
    return out
  })

  const current = createMemo(() => {
    const name = local.agent.current().name === "plan" ? "plan" : "build"
    const saved = kv.get(MODE_KEY, "auto")
    const mode = saved === "single" || saved === "dual" || saved === "auto" ? saved : "auto"
    return `${mode}.${name}`
  })

  const latest = (sid: string | undefined) => {
    if (!sid) return
    const msgs = sync.data.message[sid] ?? []
    for (const msg of [...msgs].reverse()) {
      if (msg.role !== "assistant") continue
      const parts = sync.data.part[msg.id] ?? []
      for (const part of [...parts].reverse()) {
        if (part.type !== "text") continue
        const text = part.text.trim()
        if (text) return text
      }
    }
  }

  const remember = (k: string, v: string) => {
    const map = (kv.get(PACKET_KEY) as Record<string, string> | undefined) ?? {}
    if (map[k] === v) return false
    kv.set(PACKET_KEY, { ...map, [k]: v })
    return true
  }

  const inject = async (sid: string | undefined, ag: "plan" | "build", src: string, text: string | undefined) => {
    if (!sid || !text) return
    const p = packet(text)
    if (!p) return
    const body = [`<plan_packet source="${src}">`, JSON.stringify(p, null, 2), "</plan_packet>"].join("\n")
    const key = `${sid}:${src}`
    if (!remember(key, body)) return
    await sdk.client.session.prompt({
      sessionID: sid,
      agent: ag,
      noReply: true,
      parts: [{ type: "text", text: body }],
    })
  }

  const copy = async (saved: DualSessions, ag: "plan" | "build") => {
    if (!saved.studentSessionID || !saved.supervisorSessionID) return
    const msgs = sync.data.message[saved.supervisorSessionID] ?? []
    const msg = [...msgs].reverse().find((item) => item.role === "assistant")
    if (!msg) return
    if (kv.get(VERDICT_KEY) === msg.id) return
    const text = latest(saved.supervisorSessionID)
    if (!text) return
    const body = [`<supervisor_feedback source="dual">`, text, `</supervisor_feedback>`].join("\n")
    await sdk.client.session.prompt({
      sessionID: saved.studentSessionID,
      agent: ag,
      noReply: true,
      parts: [{ type: "text", text: body }],
    })
    kv.set(VERDICT_KEY, msg.id)
  }

  return (
    <DialogSelect
      title="Select agent"
      current={current()}
      options={options()}
      onSelect={(option) => {
        const [mode, raw] = option.value.split(".")
        const next = raw === "plan" ? "plan" : "build"
        kv.set(MODE_KEY, mode)
        local.agent.set(next)
        if (mode === "auto") kv.set(DUAL_FLOW_KEY, "auto")
        if (mode === "dual") kv.set(DUAL_FLOW_KEY, "dual")

        void (async () => {
          if (route.data.type === "session") {
            route.navigate({ type: "dual", sessionID: route.data.sessionID })
            dialog.clear()
            return
          }

          if (route.data.type === "dual") {
            dialog.clear()
            return
          }

          route.navigate({ type: "dual" })
          dialog.clear()
        })()
      }}
    />
  )
}
