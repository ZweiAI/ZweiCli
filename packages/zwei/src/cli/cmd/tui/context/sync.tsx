import type {
  Message,
  Agent,
  Provider,
  Session,
  Part,
  Config,
  Todo,
  Command,
  PermissionRequest,
  QuestionRequest,
  LspStatus,
  McpStatus,
  McpResource,
  FormatterStatus,
  SessionStatus,
  ProviderListResponse,
  ProviderAuthMethod,
  VcsInfo,
} from "@zwei/sdk/v2"
import { createStore, produce, reconcile } from "solid-js/store"
import { useProject } from "@tui/context/project"
import { useEvent } from "@tui/context/event"
import { useSDK } from "@tui/context/sdk"
import { Binary } from "@zwei/util/binary"
import { createSimpleContext } from "./helper"
import type { Snapshot } from "@/snapshot"
import { useExit } from "./exit"
import { useArgs } from "./args"
import { batch, createEffect, on } from "solid-js"
import { Log } from "@/util/log"
import { ConsoleState, emptyConsoleState, type ConsoleState as ConsoleStateType } from "@/config/console-state"

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const [store, setStore] = createStore<{
      status: "loading" | "partial" | "complete"
      provider: Provider[]
      provider_default: Record<string, string>
      provider_next: ProviderListResponse
      console_state: ConsoleStateType
      provider_auth: Record<string, ProviderAuthMethod[]>
      agent: Agent[]
      command: Command[]
      permission: {
        [sessionID: string]: PermissionRequest[]
      }
      question: {
        [sessionID: string]: QuestionRequest[]
      }
      config: Config
      session: Session[]
      session_status: {
        [sessionID: string]: SessionStatus
      }
      session_diff: {
        [sessionID: string]: Snapshot.FileDiff[]
      }
      todo: {
        [sessionID: string]: Todo[]
      }
      message: {
        [sessionID: string]: Message[]
      }
      part: {
        [messageID: string]: Part[]
      }
      lsp: LspStatus[]
      mcp: {
        [key: string]: McpStatus
      }
      mcp_resource: {
        [key: string]: McpResource
      }
      formatter: FormatterStatus[]
      vcs: VcsInfo | undefined
    }>({
      provider_next: {
        all: [],
        default: {},
        connected: [],
      },
      console_state: emptyConsoleState,
      provider_auth: {},
      config: {},
      status: "loading",
      agent: [],
      permission: {},
      question: {},
      command: [],
      provider: [],
      provider_default: {},
      session: [],
      session_status: {},
      session_diff: {},
      todo: {},
      message: {},
      part: {},
      lsp: [],
      mcp: {},
      mcp_resource: {},
      formatter: [],
      vcs: undefined,
    })

    const event = useEvent()
    const project = useProject()
    const sdk = useSDK()

    event.subscribe((event) => {
      switch (event.type) {
        case "server.instance.disposed":
          bootstrap()
          break
        case "permission.replied": {
          const requests = store.permission[event.properties.sessionID]
          if (!requests) break
          const match = Binary.search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "permission",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "permission.asked": {
          const request = event.properties
          const requests = store.permission[request.sessionID]
          if (!requests) {
            setStore("permission", request.sessionID, [request])
            break
          }
          const match = Binary.search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("permission", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "permission",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "question.replied":
        case "question.rejected": {
          const requests = store.question[event.properties.sessionID]
          if (!requests) break
          const match = Binary.search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "question",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "question.asked": {
          const request = event.properties
          const requests = store.question[request.sessionID]
          if (!requests) {
            setStore("question", request.sessionID, [request])
            break
          }
          const match = Binary.search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("question", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "question",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "todo.updated":
          setStore("todo", event.properties.sessionID, event.properties.todos)
          break

        case "session.diff":
          setStore("session_diff", event.properties.sessionID, event.properties.diff)
          break

        case "session.deleted": {
          const result = Binary.search(store.session, event.properties.info.id, (s) => s.id)
          if (result.found) {
            setStore(
              "session",
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }
        case "session.updated": {
          const result = Binary.search(store.session, event.properties.info.id, (s) => s.id)
          if (result.found) {
            setStore("session", result.index, reconcile(event.properties.info))
            break
          }
          setStore(
            "session",
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          break
        }

        case "session.status": {
          setStore("session_status", event.properties.sessionID, event.properties.status)
          break
        }

        case "message.updated": {
          const messages = store.message[event.properties.info.sessionID]
          if (!messages) {
            setStore("message", event.properties.info.sessionID, [event.properties.info])
            break
          }
          const result = Binary.search(messages, event.properties.info.id, (m) => m.id)
          if (result.found) {
            setStore("message", event.properties.info.sessionID, result.index, reconcile(event.properties.info))
            break
          }
          setStore(
            "message",
            event.properties.info.sessionID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          const updated = store.message[event.properties.info.sessionID]
          if (updated.length > 100) {
            const oldest = updated[0]
            batch(() => {
              setStore(
                "message",
                event.properties.info.sessionID,
                produce((draft) => {
                  draft.shift()
                }),
              )
              setStore(
                "part",
                produce((draft) => {
                  delete draft[oldest.id]
                }),
              )
            })
          }
          break
        }
        case "message.removed": {
          const messages = store.message[event.properties.sessionID]
          const result = Binary.search(messages, event.properties.messageID, (m) => m.id)
          if (result.found) {
            setStore(
              "message",
              event.properties.sessionID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }
        case "message.part.updated": {
          const parts = store.part[event.properties.part.messageID]
          if (!parts) {
            setStore("part", event.properties.part.messageID, [event.properties.part])
            break
          }
          const result = Binary.search(parts, event.properties.part.id, (p) => p.id)
          if (result.found) {
            setStore("part", event.properties.part.messageID, result.index, reconcile(event.properties.part))
            break
          }
          setStore(
            "part",
            event.properties.part.messageID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.part)
            }),
          )
          break
        }

        case "message.part.delta": {
          const parts = store.part[event.properties.messageID]
          if (!parts) break
          const result = Binary.search(parts, event.properties.partID, (p) => p.id)
          if (!result.found) break
          setStore(
            "part",
            event.properties.messageID,
            produce((draft) => {
              const part = draft[result.index]
              const field = event.properties.field as keyof typeof part
              const existing = part[field] as string | undefined
              ;(part[field] as string) = (existing ?? "") + event.properties.delta
            }),
          )
          break
        }

        case "message.part.removed": {
          const parts = store.part[event.properties.messageID]
          const result = Binary.search(parts, event.properties.partID, (p) => p.id)
          if (result.found)
            setStore(
              "part",
              event.properties.messageID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          break
        }

        case "lsp.updated": {
          const workspace = project.workspace.current()
          sdk.client.lsp.status({ workspace }).then((x) => setStore("lsp", x.data!))
          break
        }

        case "vcs.branch.updated": {
          setStore("vcs", { branch: event.properties.branch })
          break
        }
      }
    })

    const exit = useExit()
    const args = useArgs()

    async function bootstrap() {
      console.log("bootstrapping")
      const workspace = project.workspace.current()
      const start = Date.now() - 30 * 24 * 60 * 60 * 1000

      // Two design rules below:
      //   1. Each request hydrates its own store slice the moment its response
      //      arrives (no joint Promise.all gating per-slice paint). Components
      //      reading one slice no longer wait for the slowest sibling.
      //   2. Wave 2 ("non-blocking") fires in parallel with wave 1 instead of
      //      sitting idle until wave 1 resolves. Status semantics preserved:
      //      "loading"→"partial" still gates on wave 1 only; "partial"→
      //      "complete" still gates on both waves.
      const sessionListPromise = sdk.client.session
        .list({ start })
        .then((x) => (x.data ?? []).toSorted((a, b) => a.id.localeCompare(b.id)))

      // ── Wave 1 (blocking — gates "loading"→"partial") ────────────────────
      const providersDone = sdk.client.config
        .providers({ workspace }, { throwOnError: true })
        .then((x) => {
          const data = x.data!
          batch(() => {
            setStore("provider", reconcile(data.providers))
            setStore("provider_default", reconcile(data.default))
          })
        })
      const providerListDone = sdk.client.provider
        .list({ workspace }, { throwOnError: true })
        .then((x) => setStore("provider_next", reconcile(x.data!)))
      const consoleStatePromise = sdk.client.experimental.console
        .get({ workspace }, { throwOnError: true })
        .then((x) => ConsoleState.parse(x.data))
        .catch(() => emptyConsoleState)
      const consoleStateDone = consoleStatePromise.then((s) => setStore("console_state", reconcile(s)))
      const agentsDone = sdk.client.app
        .agents({ workspace }, { throwOnError: true })
        .then((x) => setStore("agent", reconcile(x.data ?? [])))
      const configDone = sdk.client.config
        .get({ workspace }, { throwOnError: true })
        .then((x) => setStore("config", reconcile(x.data!)))
      const projectDone = project.sync()
      const sessionListBlockingDone = args.continue
        ? sessionListPromise.then((sessions) => setStore("session", reconcile(sessions)))
        : undefined

      const wave1: Promise<unknown>[] = [
        providersDone,
        providerListDone,
        consoleStateDone,
        agentsDone,
        configDone,
        projectDone,
        ...(sessionListBlockingDone ? [sessionListBlockingDone] : []),
      ]

      // ── Wave 2 (non-blocking — gates "partial"→"complete") ───────────────
      // Started immediately; not awaited by the .catch(exit) chain so individual
      // failures (e.g. an MCP server down) won't bring down the TUI.
      const wave2: Promise<unknown>[] = [
        ...(args.continue
          ? []
          : [sessionListPromise.then((sessions) => setStore("session", reconcile(sessions)))]),
        sdk.client.command.list({ workspace }).then((x) => setStore("command", reconcile(x.data ?? []))),
        sdk.client.lsp.status({ workspace }).then((x) => setStore("lsp", reconcile(x.data!))),
        sdk.client.mcp.status({ workspace }).then((x) => setStore("mcp", reconcile(x.data!))),
        sdk.client.experimental.resource
          .list({ workspace })
          .then((x) => setStore("mcp_resource", reconcile(x.data ?? {}))),
        sdk.client.formatter.status({ workspace }).then((x) => setStore("formatter", reconcile(x.data!))),
        sdk.client.session.status({ workspace }).then((x) => setStore("session_status", reconcile(x.data!))),
        sdk.client.provider.auth({ workspace }).then((x) => setStore("provider_auth", reconcile(x.data ?? {}))),
        sdk.client.vcs.get({ workspace }).then((x) => setStore("vcs", reconcile(x.data))),
        project.workspace.sync(),
      ]

      try {
        await Promise.all(wave1)
        if (store.status !== "complete") setStore("status", "partial")
      } catch (e) {
        Log.Default.error("tui bootstrap failed", {
          error: e instanceof Error ? e.message : String(e),
          name: e instanceof Error ? e.name : undefined,
          stack: e instanceof Error ? e.stack : undefined,
        })
        await exit(e)
        return
      }

      // "complete" only after both waves land. Fire-and-forget — wave 2 errors
      // are intentionally swallowed (matches the prior behavior where the
      // inner Promise.all wasn't returned to the outer .catch chain).
      Promise.all(wave2)
        .then(() => setStore("status", "complete"))
        .catch(() => {})
    }

    const fullSyncedSessions = new Set<string>()
    const syncingSessions = new Map<string, Promise<void>>()
    createEffect(
      on(
        () => project.workspace.current(),
        () => {
          fullSyncedSessions.clear()
          syncingSessions.clear()
          void bootstrap()
        },
      ),
    )

    const result = {
      data: store,
      set: setStore,
      get status() {
        return store.status
      },
      get ready() {
        return store.status !== "loading"
      },
      get path() {
        return project.instance.path()
      },
      session: {
        get(sessionID: string) {
          const match = Binary.search(store.session, sessionID, (s) => s.id)
          if (match.found) return store.session[match.index]
          return undefined
        },
        status(sessionID: string) {
          const session = result.session.get(sessionID)
          if (!session) return "idle"
          if (session.time.compacting) return "compacting"
          const messages = store.message[sessionID] ?? []
          const last = messages.at(-1)
          if (!last) return "idle"
          if (last.role === "user") return "working"
          return last.time.completed ? "idle" : "working"
        },
        async sync(sessionID: string, force = false) {
          if (force) fullSyncedSessions.delete(sessionID)
          if (!force && fullSyncedSessions.has(sessionID)) return
          const syncing = syncingSessions.get(sessionID)
          if (syncing) return syncing
          const run = (async () => {
            const workspace = project.workspace.current()
            const session = await sdk.client.session.get({ sessionID, workspace }, { throwOnError: true })
            setStore(
              produce((draft) => {
                const match = Binary.search(draft.session, sessionID, (s) => s.id)
                if (match.found) draft.session[match.index] = session.data!
                if (!match.found) draft.session.splice(match.index, 0, session.data!)
              }),
            )
            const [messages, todo, diff] = await Promise.all([
              sdk.client.session.messages({ sessionID, limit: 100, workspace }),
              sdk.client.session.todo({ sessionID, workspace }),
              sdk.client.session.diff({ sessionID, workspace }),
            ])
            setStore(
              produce((draft) => {
                draft.todo[sessionID] = todo.data ?? []
                draft.message[sessionID] = messages.data!.map((x) => x.info)
                for (const message of messages.data!) {
                  draft.part[message.info.id] = message.parts
                }
                draft.session_diff[sessionID] = diff.data ?? []
              }),
            )
            fullSyncedSessions.add(sessionID)
          })()
          syncingSessions.set(sessionID, run)
          try {
            await run
          } finally {
            syncingSessions.delete(sessionID)
          }
        },
      },
      bootstrap,
    }
    return result
  },
})
