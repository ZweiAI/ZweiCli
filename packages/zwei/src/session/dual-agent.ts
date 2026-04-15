import z from "zod"
import { ulid } from "ulid"
import { spawnSync } from "child_process"
import { Cause, Effect, Layer, Context, Option } from "effect"
import { Log } from "../util/log"
import { InstanceState } from "../effect/instance-state"
import { Session } from "."
import { SessionPrompt } from "./prompt"
import { SessionCompaction } from "./compaction"
import { MessageV2 } from "./message-v2"
import { SessionID, MessageID, PartID } from "./schema"
import { Provider } from "../provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { Bus } from "../bus"
import { Shell } from "../shell/shell"
import { Permission } from "../permission"
import { Question } from "../question"
import { makeRuntime } from "@/effect/run-service"
import { Event, PhaseName, RunStatus, type DualPhaseName } from "./dual-agent-event"
import {
  gate as interactiveGate,
  runInteractive as startInteractive,
  type InteractiveHandle as BaseInteractiveHandle,
} from "./dual-agent-interactive"
import {
  audit,
  extractPacket as parsePacket,
  formatTrace as formatTracePolicy,
  packet,
  renderStudentPrompt,
  renderStudentRound0Prompt,
  renderSupervisorPlanRevisePrompt,
  renderSupervisorPrompt,
  renderSupervisorRound0Prompt,
  sanitizeScaffold as sanitizeScaffoldPolicy,
  type PlanPacket,
  type StudentOutput,
  type SupervisorOutput,
  type TraceEntry,
} from "./dual-agent-policy"
export { Event } from "./dual-agent-event"
export { formatTrace, sanitizeScaffold } from "./dual-agent-policy"

type ResolvedModel = { providerID: ProviderID; modelID: ModelID }

/**
 * ------- Production hardening constants -------
 *
 * These are intentionally conservative defaults, not user-facing knobs. If you find
 * yourself needing to tune them, that's a sign the underlying layer (opencode's LLM
 * retry, the AI SDK middleware, the provider's rate limit) is the wrong place to be
 * fighting with. Consider filing a bug against opencode rather than loosening these.
 */

// Retry policy for transient provider errors. Non-transient errors bubble up immediately.
// We deliberately keep this tight — the orchestrator does its own per-round parse-error
// recovery via auto-feedback, so retries are only needed for truly ephemeral failures
// (429, 5xx, network resets). Three attempts total ≈ 500ms + 1s + 2s + jitter ≈ ≤4s of
// added latency in the worst case.
const RETRY_MAX_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 500

function args(file: string, cmd: string) {
  const shell = Shell.name(file)
  if (shell === "powershell" || shell === "pwsh") return ["-NoProfile", "-Command", cmd]
  if (shell === "cmd") return ["/d", "/s", "/c", cmd]
  if (Shell.login(file)) return ["-lc", cmd]
  return ["-c", cmd]
}

function exec(cmd: string, cwd: string, timeout: number) {
  const file = Shell.preferred()
  const result = spawnSync(file, args(file, cmd), {
    cwd,
    encoding: "utf-8",
    timeout,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: process.platform === "win32",
  })
  return {
    status: result.status,
    output: ((result.stdout ?? "") + "\n" + (result.stderr ?? "")).trim(),
    error: result.error?.message,
  }
}

// ----- Structured telemetry event schemas -------------------------------------------
//
// Every event is correlated via `runID` (a ulid generated at the start of each `run()`).
// Subscribers (tests, CLI --events mode, future dashboards) can build a full timeline of
// a single dual-agent run by filtering on runID.
//
// Design notes:
// - Keep payloads small. Anything large (full JSON output, raw LLM text) goes to the
//   session DB, not the telemetry bus. Events are for observers to build timelines and
//   aggregates, not for replaying runs.
// - Every event includes a `timestamp` so consumers don't have to rely on their own
//   receive time (which can drift across async fiber schedules).
// - Error fields are optional and shaped for programmatic use (`errorKind` is the
//   classifier bucket, `errorMessage` is the truncated raw message).
// - Never include the NVIDIA-key-in-chat scenario: no event carries secrets. Input
//   task text IS sent but is user-provided, not a secret.

/**
 * SessionDualAgent
 *
 * Orchestrates a two-agent loop (Student → Supervisor → Student …).
 *
 * Design goals:
 * - Two *isolated* child sessions share no history, no skill memory, and no tool permissions.
 *   Student owns a write-capable session; Supervisor owns a read+test-only session.
 * - Rounds run sequentially — streaming is coordinated by construction (at most one stream at a
 *   time to the parent session, never interleaved).
 * - Each round's role is stamped on the parent session as a synthetic text part before the child
 *   session streams, so the parent transcript reads as a multiplexed conversation.
 * - Structured JSON exchange (student.artifact ↔ supervisor.verdict) is parsed leniently —
 *   code-fences are stripped and the first balanced `{…}` block is extracted.
 * - Loop halts on supervisor `status: "pass"`, on `maxRounds`, or on a parse failure that
 *   cannot be recovered on the next round.
 *
 * This module is transport-agnostic: it does not speak to the LLM directly. It drives the
 * existing `SessionPrompt.prompt()` path, which means native streaming, permissions, skills,
 * compaction, tool execution, and bus events keep working exactly as they do for single-agent
 * runs.
 */
export namespace SessionDualAgent {
  const log = Log.create({ service: "session.dual-agent" })
  export const formatTrace = formatTracePolicy
  export const sanitizeScaffold = sanitizeScaffoldPolicy

  export const STUDENT_AGENT = "phd"
  export const SUPERVISOR_AGENT = "supervisor"

  export const Input = z.object({
    parentSessionID: SessionID.zod,
    task: z.string().min(1),
    model: z
      .object({
        providerID: ProviderID.zod,
        modelID: ModelID.zod,
      })
      .optional(),
    maxRounds: z.number().int().positive().max(20).optional(),
    /**
     * Loop mode.
     *
     * - "fast" (default): Student goes straight to implementation. Supervisor writes tests
     *   after seeing the code. Folder separation prevents both sides from sabotaging each
     *   other's artifacts; residual anchoring bias on Supervisor's side is accepted as the
     *   cost of fewer phases and lower token use. Use this for most tasks.
     *
      * - "strict": Round 0 is plan-first. Student drafts a structured implementation plan,
      *   Supervisor performs feasibility/reuse review, then the loop executes checkpoint-by-
      *   checkpoint using a compact plan_packet instead of replaying full plan history.
      *   Use this when implementation strategy and review checkpoints matter more than speed.
      *
      * - "auto": PhD runs first and auto-escalates to Supervisor only when the round looks
      *   risky/complex. Simple rounds can pass without a Supervisor phase.
      */
    mode: z.enum(["fast", "strict", "auto"]).optional(),
    /**
     * Budget guardrails. If set, the orchestrator queries accumulated cost across both
     * child sessions at the end of every phase and aborts the run if a hard ceiling is
     * breached. Without these set, there is NO automatic ceiling — `maxRounds` alone is
     * not a budget guard because a single round can internally call the LLM many times
     * (tool-call loops, compaction, retries). For production use, always set `maxUsd`.
     *
     * The ceiling is measured in USD using `MessageV2.Assistant.cost`, which opencode
     * populates from the provider's usage + cost metadata. Providers without cost
     * metadata (test/fake/free tiers) report cost=0 and will never trip the ceiling —
     * that's a known limitation, not a bug. For those, use `maxRounds` as the ceiling.
     */
    budget: z
      .object({
        maxUsd: z.number().positive().optional(),
        warnUsd: z.number().positive().optional(),
      })
      .optional(),
    /**
     * Wall-clock ceiling for a single phase (student or supervisor) in milliseconds.
     * If a phase exceeds this duration, the orchestrator aborts it and proceeds to the
     * next round (or exits the loop if already at maxRounds). The aborted phase is
     * logged as a timeout failure with errorKind="transient" in telemetry.
     *
     * This is a safety valve against tool-call runaway loops where opencode's inner
     * LLM layer keeps iterating without making progress — see the bundle-2 eval v2
     * finding where a 7-minute student runaway prevented supervisor from ever running.
     * Without a phase timeout, the only upper bound on a single dual.run() invocation
     * is `maxRounds × (however long each phase happens to take)`, which on a runaway
     * can be unbounded in practice.
     *
     * Default: unset = no timeout. Production callers should set this to something
     * generous but finite (e.g. 120_000ms = 2 minutes) for individual phases.
     */
    phaseTimeoutMs: z.number().int().positive().optional(),
    /**
     * Optional shell command to run tests after each student phase. If provided,
     * the orchestrator runs this command and:
     *   - Exit 0 → auto-declare "pass" WITHOUT calling supervisor (saves an LLM call)
     *   - Non-zero → inject stdout/stderr into supervisor prompt so supervisor
     *     doesn't need to re-run the tests itself (saves a bash tool call + timeout)
     *
     * This is the single biggest performance optimization for the dual loop:
     * it eliminates supervisor's redundant test execution (which can timeout at
     * 120s on hanging code) and skips the supervisor LLM call entirely on passing
     * rounds. In benchmarks, this cuts dual's wall time by ~60% on multi-round tasks.
     */
    testCmd: z.string().optional(),
    /**
     * Optional preflight subagent tasks injected into the first PhD phase.
     * Each entry is converted into a `subtask` part so SessionPrompt can run
     * TaskTool deterministically before the phase's main text prompt.
     */
    subtasks: z
      .array(
        z.object({
          agent: z.string().min(1),
          description: z.string().min(1),
          prompt: z.string().min(1),
          model: z
            .object({
              providerID: ProviderID.zod,
              modelID: ModelID.zod,
            })
            .optional(),
        }),
      )
      .max(6)
      .optional(),
    /**
     * Optional async hook called after each supervisor phase completes and before
     * the next student round begins. Receives the just-completed round number.
     * The dual loop AWAITS the returned Promise — the hook runs synchronously
     * with respect to the loop, so no events are lost and the workdir is stable.
     *
     * Primary consumer: the stress-comparison harness, which uses this to snapshot
     * test results + constraint state at the round-1 boundary. Bus-based snapshot
     * was unreliable (subscriber fiber couldn't drain fast enough; see git history).
     *
     * The hook is typed as `z.any()` because Zod can't express async functions.
     * At runtime, callers should pass `(round: number) => Promise<void>`.
     */
    onRoundComplete: z.any().optional(),
    /**
     * Optional permission ruleset applied to the Student child session. Supervisor
     * is not affected. Primary consumer: the stress-comparison harness, which uses
     * this to deny Student from reading the test file even though the test file
     * must physically exist in the workdir for the auto-test-gate to spawn `bun test`.
     * Rules are last-match-wins (see permission/evaluate.ts), so a deny on
     * `**\/tests/**` will override the default `*:*:allow`.
     */
    studentPermission: z.any().optional(),
    /**
     * Reuse already-existing child sessions instead of creating new ones. When
     * set, the orchestrator skips the `sessions.create(...)` calls for the
     * matched side and runs its loop against the provided session, appending
     * to its message history. Primary consumer: the dual-agent TUI — each
     * user submit fires a new `runInteractive` on the SAME student / supervisor
     * sessions so the chat reads as one continuous conversation instead of
     * N disjoint runs.
     *
     * Both IDs must be passed together; passing only one is unsupported and
     * the orchestrator will treat a missing ID as "create fresh".
     */
    studentSessionID: SessionID.zod.optional(),
    supervisorSessionID: SessionID.zod.optional(),
    /**
     * Per-agent model overrides. If set, student phases use `studentModel` and
     * supervisor phases use `supervisorModel`; unset agents fall back to the shared
     * `model` field, then to the parent-session heuristic in `resolveModel`.
     */
    studentModel: z
      .object({
        providerID: ProviderID.zod,
        modelID: ModelID.zod,
      })
      .optional(),
    supervisorModel: z
      .object({
        providerID: ProviderID.zod,
        modelID: ModelID.zod,
      })
      .optional(),
    /**
     * Internal escape hatch for `runInteractive`. A mutable holder whose fields are
     * read fresh each phase, letting the TUI swap models mid-run via `/model`,
     * `/model1`, `/model2`. Undefined fields fall back to the static resolution of
     * `studentModel` / `supervisorModel` / `model`. Not part of the public contract;
     * shape mirrors `onRoundComplete` (`z.any()`) because zod can't express a live ref.
     */
    _modelRef: z.any().optional(),
    /**
     * Internal one-shot callback fired after the two child sessions are created and
     * `runID` is generated, before the round loop starts. Lets callers (the dual
     * HTTP route) learn the session IDs without subscribing to the bus. Not public.
     */
    _onStart: z.any().optional(),
    /**
     * Internal gate hook fired at the TOP of every round after the first — i.e.
     * right before a new Student phase begins. Distinct from `onRoundComplete`
     * (which fires unconditionally at the end of each round for stress-harness
     * snapshots): `_onGate` only fires when the loop is about to iterate. On
     * pass / budget-exceeded / auto-pass the loop breaks before reaching the
     * gate, so `finish()` runs and `Event.Finished` fires normally.
     * Used by `runInteractive` to pause between rounds without blocking the
     * terminal transition to `pass`.
     */
    _onGate: z.any().optional(),
  })
  export type Input = z.infer<typeof Input>

  export const Result = z.object({
    status: z.enum(["pass", "fail", "error", "budget_exceeded"]),
    rounds: z.number().int(),
    studentSessionID: SessionID.zod,
    supervisorSessionID: SessionID.zod,
    finalArtifact: z.string().optional(),
    finalVerdict: z.record(z.string(), z.any()).optional(),
    lastError: z.string().optional(),
    /**
     * Total accumulated cost (USD) across both child sessions at the time the run
     * finished. Populated when opencode's cost tracking reports non-zero usage — zero
     * for free-tier / test providers. Included in telemetry and JSON output so callers
     * can make budget decisions across multiple sequential runs.
     */
    totalCost: z.number().optional(),
  })
  export type Result = z.infer<typeof Result>

  // ---------- JSON extraction ----------

  /**
   * Pull the first balanced top-level JSON object from a string.
   *
   * The student/supervisor prompts instruct them to emit raw JSON, but models routinely wrap
   * it in markdown fences or emit prose around it. We scan for the first `{`, walk forward
   * matching braces (respecting string escapes), and return the enclosed slice.
   */
  export function extractJSON(text: string): unknown | undefined {
    if (!text) return undefined
    // Strip ```json / ``` fences if present.
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
    const body = fence ? fence[1] : text

    let depth = 0
    let start = -1
    let inStr = false
    let escape = false
    for (let i = 0; i < body.length; i++) {
      const c = body[i]
      if (inStr) {
        if (escape) escape = false
        else if (c === "\\") escape = true
        else if (c === '"') inStr = false
        continue
      }
      if (c === '"') {
        inStr = true
        continue
      }
      if (c === "{") {
        if (depth === 0) start = i
        depth++
      } else if (c === "}") {
        depth--
        if (depth === 0 && start !== -1) {
          const slice = body.slice(start, i + 1)
          try {
            return JSON.parse(slice)
          } catch {
            start = -1
            continue
          }
        }
      }
    }
    return undefined
  }

  // ---------- error classification + retry ----------

  /**
   * Classify an error message into one of four buckets. Used by the retry wrapper and
   * by telemetry to decide whether a failure is the user's fault, the model's fault,
   * the provider's fault, or something else.
   */
  export function classifyError(msg: string): "transient" | "permission" | "model" | "other" {
    if (!msg) return "other"
    // Transient provider errors — rate limit, 5xx, network resets. Safe to retry.
    if (/\b(408|429|500|502|503|504)\b/.test(msg)) return "transient"
    if (/\b(ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|EPIPE)\b/.test(msg)) return "transient"
    if (/fetch failed|socket hang up|connection (reset|refused)|network error/i.test(msg))
      return "transient"
    // Permission layer rejected the tool call. User decision, not retryable.
    if (/PermissionDeniedError|PermissionRejectedError|permission.*deny|permission.*reject/i.test(msg))
      return "permission"
    // Model layer rejected the input. Retrying won't help — the prompt itself is wrong.
    if (/invalid_request|context_length_exceeded|content_policy|safety/i.test(msg)) return "model"
    return "other"
  }

  /**
   * Manual retry loop with exponential backoff + jitter. We intentionally avoid
   * `Effect.retry` + `Schedule` here so the classification predicate is inline and
   * obvious — the semantics of "which errors retry" are load-bearing enough to merit
   * explicit code rather than a declarative rule.
   *
   * Only transient errors retry. Permission / model / other errors bubble up on first
   * failure. Maximum 3 total attempts (1 initial + 2 retries) with base delay 500ms.
   *
   * On each retry attempt (not on initial or successful attempts), `onRetry` is called
   * with the classified error info — that hook is how the orchestrator emits `dual.retry`
   * telemetry events. The retry loop itself is transport-agnostic; the hook keeps it so.
   *
   * Caveat: each retry re-invokes the thunk from scratch. If the thunk has side effects
   * (e.g. `sessionPrompt.prompt` creates a user message in the child session), those
   * side effects will be duplicated on retry. For the dual-agent orchestrator this
   * means a retried phase may leave an extra user message in the child session's
   * history — cosmetic pollution, not functional damage.
   */
  const withTransientRetry = <A, E, R>(
    make: () => Effect.Effect<A, E, R>,
    label: string,
    onRetry?: (info: { attempt: number; delayMs: number; errorMessage: string }) => Effect.Effect<void>,
  ): Effect.Effect<A, E, R> =>
    Effect.gen(function* () {
      for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
        const exit = yield* Effect.exit(make())
        if (exit._tag === "Success") {
          if (attempt > 1) {
            log.info("retry succeeded", { label, attempt })
          }
          return exit.value
        }
        if (attempt === RETRY_MAX_ATTEMPTS) {
          return yield* Effect.failCause(exit.cause)
        }
        const squashed = Cause.squash(exit.cause)
        const msg = squashed instanceof Error ? squashed.message : String(squashed)
        const kind = classifyError(msg)
        if (kind !== "transient") {
          // Not a retryable error — bubble up immediately. The caller's catchCause
          // will record it as a phase failure and the orchestrator proceeds to the
          // auto-feedback path for the next round.
          return yield* Effect.failCause(exit.cause)
        }
        const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 300)
        log.info("retrying after transient error", {
          label,
          attempt,
          nextDelayMs: delayMs,
          error: msg.slice(0, 200),
        })
        if (onRetry) {
          yield* onRetry({ attempt, delayMs, errorMessage: msg.slice(0, 500) })
        }
        yield* Effect.sleep(`${delayMs} millis`)
      }
      // Unreachable — the loop either succeeds, fails non-transiently, or exhausts
      // attempts. All three cases return inside the loop body.
      return yield* Effect.die("unreachable: retry loop exit")
    })

  // ---------- budget tracking ----------

  /**
   * Raw token shape we use for synthetic cost computation. Matches the
   * `MessageV2.Assistant.tokens` persisted shape — all fields optional because different
   * providers report different subsets.
   */
  export interface TokenCounts {
    input?: number
    output?: number
    reasoning?: number
    cache?: { read?: number; write?: number }
  }

  /**
   * Model pricing as stored in the opencode provider catalog. USD per million tokens.
   * `cache.read` and `cache.write` are optional — most providers don't distinguish.
   */
  export interface ModelCost {
    input?: number
    output?: number
    cache?: { read?: number; write?: number }
  }

  /**
   * Pure: compute synthetic USD cost from raw token counts and model pricing.
   *
   * Formula mirrors `Session.getUsage` in session/index.ts so that production and
   * fallback paths agree on dollar amounts. Reasoning tokens are billed at the output
   * rate (same choice opencode makes internally).
   *
   * Returns 0 if `modelCost` is undefined or zeroed — safe to call against any model.
   * Returned as plain number, not Decimal, because the budget ceiling check uses
   * simple `>= maxUsd` comparisons and we accept the floating-point fuzz.
   */
  export function computeSyntheticCost(tokens: TokenCounts, modelCost: ModelCost | undefined): number {
    if (!modelCost) return 0
    const input = tokens.input ?? 0
    const output = tokens.output ?? 0
    const reasoning = tokens.reasoning ?? 0
    const cacheRead = tokens.cache?.read ?? 0
    const cacheWrite = tokens.cache?.write ?? 0
    const perMillion = 1_000_000
    return (
      (input * (modelCost.input ?? 0)) / perMillion +
      (output * (modelCost.output ?? 0)) / perMillion +
      (cacheRead * (modelCost.cache?.read ?? 0)) / perMillion +
      (cacheWrite * (modelCost.cache?.write ?? 0)) / perMillion +
      // Reasoning tokens are billed at output rate — matches Session.getUsage
      (reasoning * (modelCost.output ?? 0)) / perMillion
    )
  }

  /**
   * Query the total cost across a set of sessions by summing `cost` on every assistant
   * message. This is called after each phase of the loop to check the budget ceiling.
   *
   * ## Three code paths
   *
   *   1. **Provider reported cost > 0**: trust it. Fast path.
   *   2. **Provider reported cost == 0 but tokens are present**: OAuth path. Look up
   *      the model from `Provider.getModel` (catalog-backed, cheap after first hit),
   *      compute synthetic cost via `computeSyntheticCost`. This is the fallback that
   *      unblocks budget enforcement for OpenAI OAuth, Copilot OAuth, and any other
   *      provider whose auth path strips usage metadata.
   *   3. **No tokens at all**: skip the message. Truly unmetered providers contribute 0.
   *
   * ## Known-zero providers (budget enforcement unavailable for these)
   *
   * - Test fixtures / TestLLMServer — tokens=0, cost=0 by construction.
   * - Any provider that strips BOTH tokens and cost (rare).
   *
   * For everything else — API-key providers, OAuth providers, free tiers that report
   * tokens — the budget ceiling will fire correctly thanks to the OAuth fallback.
   */
  const getAccumulatedCost = Effect.fn("SessionDualAgent.getAccumulatedCost")(function* (
    sessions: Session.Interface,
    provider: Provider.Interface,
    sessionIDs: SessionID[],
  ) {
    let total = 0
    // Per-invocation memoization: opencode's `provider.getModel` hits a cache after the
    // first call per (providerID, modelID), but we still avoid the Effect overhead of
    // re-yielding for every message in a long session.
    const modelCache = new Map<string, { cost?: ModelCost }>()
    for (const sid of sessionIDs) {
      const msgs = yield* sessions.messages({ sessionID: sid })
      for (const m of msgs) {
        if (m.info.role !== "assistant") continue
        // Fast path: provider reported a non-zero cost, trust it.
        if (typeof m.info.cost === "number" && m.info.cost > 0) {
          total += m.info.cost
          continue
        }
        // Fallback: synthesize from tokens × catalog pricing.
        if (!m.info.tokens) continue
        const key = `${String(m.info.providerID)}/${String(m.info.modelID)}`
        if (!modelCache.has(key)) {
          const modelOpt = yield* provider
            .getModel(m.info.providerID, m.info.modelID)
            .pipe(Effect.catchCause(() => Effect.succeed(undefined)))
          modelCache.set(
            key,
            modelOpt
              ? { cost: modelOpt.cost as ModelCost | undefined }
              : {},
          )
        }
        const entry = modelCache.get(key)!
        total += computeSyntheticCost(m.info.tokens, entry.cost)
      }
    }
    return total
  })

  interface SubtaskPlan {
    agent: string
    description: string
    prompt: string
    model?: ResolvedModel
  }

  function extractPacket(text: string): PlanPacket | undefined {
    return parsePacket(text, extractJSON)
  }

  // ---------- message extraction helpers ----------

  /**
   * Concatenate all non-synthetic text parts from the last assistant message in a session.
   * This is what the child agent "said" for the current round.
   */
  const lastAssistantText = Effect.fn("SessionDualAgent.lastAssistantText")(function* (
    sessions: Session.Interface,
    sessionID: SessionID,
  ) {
    const matched = yield* sessions.findMessage(sessionID, (m) => m.info.role === "assistant")
    if (Option.isNone(matched)) return ""
    const msg = matched.value
    if (msg.info.role !== "assistant") return ""
    const texts: string[] = []
    for (const p of msg.parts) {
      if (p.type !== "text") continue
      if ("ignored" in p && p.ignored) continue
      if ("synthetic" in p && p.synthetic) continue
      texts.push(p.text)
    }
    return texts.join("\n").trim()
  })

  const lastPacket = Effect.fn("SessionDualAgent.lastPacket")(function* (
    sessions: Session.Interface,
    sessionID: SessionID,
  ) {
    const msgs = yield* sessions.messages({ sessionID, limit: 80 })
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i]
      for (let j = msg.parts.length - 1; j >= 0; j--) {
        const part = msg.parts[j]
        if (part.type !== "text") continue
        if ("ignored" in part && part.ignored) continue
        const p = extractPacket(part.text)
        if (p) return p
      }
    }
    return undefined
  })

  // ---------- asymmetric memory: Supervisor reads Student's action trace ----------

  /**
   * Compressed representation of one tool invocation from Student's session.
   * We deliberately keep this small — just enough for Supervisor to verify what
   * Student actually did, not enough for Supervisor to replay Student's thinking.
   */
  const MAX_TRACE_ENTRIES = 20
  const MAX_INPUT_CHARS = 500
  const MAX_OUTPUT_CHARS = 500
  /** Write/edit outputs are the most critical for Supervisor to verify — give them more room. */
  const MAX_OUTPUT_CHARS_WRITE = 2000
  const WRITE_TOOLS = new Set(["write", "edit", "apply_patch"])

  function truncate(s: string, n: number): string {
    if (!s) return ""
    if (s.length <= n) return s
    return s.slice(0, n - 1) + "…"
  }

  /**
   * Walk a session's messages from newest to oldest and extract the tool calls made
   * since the latest user message. That is, "what did the assistant do in response
   * to the most recent prompt from the orchestrator" — the **current round's trace**.
   *
   * This is the bridge of the asymmetric memory design:
   *  - Student's JSON output (artifact, changes_made, self_check) tells Supervisor what
   *    Student *thinks* it did.
   *  - This trace tells Supervisor what Student *actually* did at the tool layer.
   *
   * The two together give Supervisor ground truth without exposing Student's private
   * reasoning (text / reasoning parts are filtered out). In the reverse direction, the
   * orchestrator does NOT call this against Supervisor's session — Student only ever
   * sees the structured `SupervisorOutput` JSON, never Supervisor's tool calls or text.
   */
  export const extractCurrentRoundTrace = Effect.fn("SessionDualAgent.extractCurrentRoundTrace")(
    function* (sessions: Session.Interface, sessionID: SessionID) {
      const allMsgs = yield* sessions.messages({ sessionID })
      // Walk backward and collect all parts up to (but not including) the previous user
      // message. Those are the assistant turns for the most recent prompt.
      const slice: MessageV2.WithParts[] = []
      for (let i = allMsgs.length - 1; i >= 0; i--) {
        const m = allMsgs[i]
        if (m.info.role === "user") break
        slice.unshift(m)
      }
      const trace: TraceEntry[] = []
      for (const msg of slice) {
        for (const part of msg.parts) {
          if (part.type !== "tool") continue
          if (trace.length >= MAX_TRACE_ENTRIES) break
          const state = part.state
          const entry: TraceEntry = {
            tool: part.tool,
            status: state.status,
            input:
              "input" in state && state.input
                ? truncate(JSON.stringify(state.input), MAX_INPUT_CHARS)
                : "",
          }
          if (state.status === "completed") {
            const out = "output" in state ? state.output : undefined
            const outputLimit = WRITE_TOOLS.has(part.tool) ? MAX_OUTPUT_CHARS_WRITE : MAX_OUTPUT_CHARS
            entry.output = typeof out === "string" ? truncate(out, outputLimit) : ""
          } else if (state.status === "error") {
            entry.error = truncate("error" in state ? String(state.error) : "unknown error", MAX_OUTPUT_CHARS)
          }
          trace.push(entry)
        }
        if (trace.length >= MAX_TRACE_ENTRIES) break
      }
      return trace
    },
  )

  /**
   * Format an action trace as a compact text block for inclusion in Supervisor prompts.
   * Empty trace returns empty string (caller should skip the `<student_actions>` block).
   */
  // Append a synthetic "transcript entry" to the parent session so the user sees a
  // coordinated view of both child streams in one linear transcript.
  //
  // We use a synthetic user message because that is how other parts of the codebase inject
  // system-reminder-style annotations into a session (see createUserMessage in prompt.ts).
  // The model field is required on User messages, so we thread the resolved model through.
  const stamp = Effect.fn("SessionDualAgent.stamp")(function* (
    sessions: Session.Interface,
    parentID: SessionID,
    role: "phd" | "supervisor",
    round: number,
    body: string,
    model: ResolvedModel,
  ) {
    const userMsg: MessageV2.User = {
      id: MessageID.ascending(),
      sessionID: parentID,
      role: "user",
      time: { created: Date.now() },
      agent: role,
      model,
    }
    yield* sessions.updateMessage(userMsg)
    yield* sessions.updatePart({
      id: PartID.ascending(),
      messageID: userMsg.id,
      sessionID: parentID,
      type: "text",
      synthetic: true,
      text: `[${role.toUpperCase()} · round ${round}]\n${body}`,
    } satisfies MessageV2.TextPart)
  })

  // ---------- service ----------

  export interface Interface {
    readonly run: (input: Input) => Effect.Effect<Result>
  }

  export class Service extends Context.Service<Service, Interface>()("@opencode/SessionDualAgent") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const sessionPrompt = yield* SessionPrompt.Service
      const provider = yield* Provider.Service
      const question = yield* Question.Service
      const bus = yield* Bus.Service
      const compaction = yield* SessionCompaction.Service

      const resolveModel = Effect.fn("SessionDualAgent.resolveModel")(function* (
        parentID: SessionID,
        explicit: ResolvedModel | undefined,
      ) {
        if (explicit) return explicit
        const match = yield* sessions.findMessage(parentID, (m) => m.info.role === "user" && !!m.info.model)
        if (Option.isSome(match) && match.value.info.role === "user") {
          const m = match.value.info.model
          return { providerID: m.providerID, modelID: m.modelID } satisfies ResolvedModel
        }
        const def = yield* provider.defaultModel()
        return { providerID: def.providerID, modelID: def.modelID } satisfies ResolvedModel
      })

      const run = Effect.fn("SessionDualAgent.run")(function* (input: Input) {
        const mode = input.mode ?? "fast"
        const parent = yield* sessions.get(input.parentSessionID)
        const maxRounds = input.maxRounds ?? 5
        // Resolve a model per agent. Order of precedence:
        //   input.{student,supervisor}Model  →  input.model  →  parent-session heuristic.
        // Both sides resolve independently so a run can put Student on a cheap writer
        // model and Supervisor on a stronger reviewer.
        const staticStudent = yield* resolveModel(parent.id, input.studentModel ?? input.model)
        const staticSupervisor = yield* resolveModel(parent.id, input.supervisorModel ?? input.model)
        // _modelRef is the live override used by `runInteractive` for mid-run swapping.
        // When a field on the ref is undefined we fall back to the static resolution,
        // so a user swapping only one side doesn't have to re-provide the other.
        const ref = input._modelRef as
          | { student?: ResolvedModel; supervisor?: ResolvedModel }
          | undefined
        const studentModel = () => ref?.student ?? staticStudent
        const supervisorModel = () => ref?.supervisor ?? staticSupervisor

        // Spin up (or reuse) two isolated child sessions. Each agent accumulates its
        // own history in its own session — that is the isolation mechanism. When the
        // caller passes pre-existing session ids (interactive dual TUI does this on
        // every submit after the first), we reuse them so the conversation history
        // persists across user messages instead of resetting per run.
        const studentSession = input.studentSessionID
          ? yield* sessions.get(input.studentSessionID)
          : yield* sessions.create({
              parentID: parent.id,
              title: `PhD · ${parent.title}`,
              permission: input.studentPermission as Permission.Ruleset | undefined,
            })
        if (studentSession.title.startsWith("Student ·")) {
          yield* sessions.setTitle({
            sessionID: studentSession.id,
            title: studentSession.title.replace(/^Student ·/, "PhD ·"),
          })
          studentSession.title = studentSession.title.replace(/^Student ·/, "PhD ·")
        }
        const supervisorSession = input.supervisorSessionID
          ? yield* sessions.get(input.supervisorSessionID)
          : yield* sessions.create({
              parentID: parent.id,
              title: `Supervisor · ${parent.title}`,
            })

        // A correlation ID that stamps every telemetry event emitted during this run.
        // Subscribers filter by `runID` to build a complete timeline of a single
        // dual-agent invocation across asynchronously-emitted events.
        const runID = ulid()
        const runStartedAt = Date.now()

        log
          .clone()
          .tag("runID", runID)
          .tag("parent", parent.id)
          .tag("student", studentSession.id)
          .tag("supervisor", supervisorSession.id)
          .info("dual-agent start", { task: input.task.slice(0, 120) })

        // Fire one-shot start hook for `runInteractive` so the HTTP caller can return
        // runID + session IDs to the client without racing the bus.
        const onStart = input._onStart as
          | ((info: { runID: string; studentSessionID: SessionID; supervisorSessionID: SessionID }) => void)
          | undefined
        onStart?.({ runID, studentSessionID: studentSession.id, supervisorSessionID: supervisorSession.id })

        // Emit the `dual.started` event BEFORE we do any work. Subscribers (CLI
        // --events, dashboards, tests) can latch on here and follow every subsequent
        // event by runID.
        yield* bus.publish(Event.Started, {
          runID,
          parentSessionID: parent.id,
          studentSessionID: studentSession.id,
          supervisorSessionID: supervisorSession.id,
          task: input.task,
          model: { providerID: String(staticStudent.providerID), modelID: String(staticStudent.modelID) },
          mode,
          maxRounds,
          budget: input.budget,
          timestamp: runStartedAt,
        })

        let round = 0
        let feedback: SupervisorOutput | undefined
        let lastStudent: StudentOutput | undefined
        let lastVerdict: SupervisorOutput | undefined
        let plan: PlanPacket | undefined = yield* lastPacket(sessions, studentSession.id)
        let status: Result["status"] = "fail"
        let lastError: string | undefined
        let totalCost = 0
        let pending: SubtaskPlan[] = (input.subtasks ?? []).map((item) => ({
          agent: item.agent.trim(),
          description: item.description.trim(),
          prompt: item.prompt,
          model: item.model
            ? { providerID: item.model.providerID, modelID: item.model.modelID }
            : undefined,
        }))

        const flush = () => {
          if (pending.length === 0) return [] as SessionPrompt.PromptInput["parts"]
          const out = pending
            .filter((item) => item.agent && item.description && item.prompt)
            .map((item) => ({
              type: "subtask" as const,
              agent: item.agent,
              description: item.description,
              prompt: item.prompt,
              ...(item.model ? { model: item.model } : {}),
            }))
          pending = []
          return out
        }

        // Shared phase invocation: wraps `sessionPrompt.prompt(...)` in transient-error
        // retry + structured error capture + start/completed telemetry. The thunk is
        // re-invoked on each retry, so the prompt's user message will be duplicated in
        // the session on retry (cosmetic, not functional). Non-transient errors set
        // `lastError` and return — the caller's parse-failure path then generates
        // auto-feedback for the next round.
        const runPhase = (
          phase: DualPhaseName,
          phaseRound: number,
          sid: SessionID,
          agent: typeof STUDENT_AGENT | typeof SUPERVISOR_AGENT,
          text: string,
          extra?: SessionPrompt.PromptInput["parts"],
        ) =>
          Effect.gen(function* () {
            const phaseStartedAt = Date.now()
            yield* bus.publish(Event.PhaseStarted, {
              runID,
              round: phaseRound,
              phase,
              timestamp: phaseStartedAt,
            })

            let success = true
            let errorKind: "transient" | "permission" | "model" | "other" | undefined
            let errorMessage: string | undefined

            // Core phase effect: retry-wrapped prompt call + error capture.
            // Read the model fresh from the per-agent getter so a mid-run swap via
            // `runInteractive.setStudentModel(...)` takes effect on the next phase
            // without touching the phase that is already in flight.
            const core = withTransientRetry(
              () =>
                sessionPrompt.prompt({
                  sessionID: sid,
                  agent,
                  model: agent === STUDENT_AGENT ? studentModel() : supervisorModel(),
                  parts: [{ type: "text", text }, ...(extra ?? [])],
                }),
              `${phase} phase`,
              // onRetry hook — emit `dual.retry` so observers can see transient recovery.
              ({ attempt, delayMs, errorMessage: retryMsg }) =>
                bus.publish(Event.Retried, {
                  runID,
                  phase,
                  attempt,
                  delayMs,
                  errorMessage: retryMsg,
                  timestamp: Date.now(),
                }),
            ).pipe(
              Effect.catchCause((cause) => {
                const squashed = Cause.squash(cause)
                const msg =
                  squashed instanceof Error
                    ? `${squashed.name}: ${squashed.message}`
                    : String(squashed)
                errorKind = classifyError(msg)
                errorMessage = msg.slice(0, 500)
                success = false
                lastError = `${phase} phase failed (${errorKind}): ${msg}`
                log.error("phase error", {
                  runID,
                  phase,
                  errorKind,
                  error: lastError,
                  stack: squashed instanceof Error ? squashed.stack : undefined,
                })
                return Effect.void
              }),
            )

            // Wall-clock safety valve: if `phaseTimeoutMs` is set, wrap the phase in
            // `Effect.timeoutOrElse`. On timeout we synthesize a phase failure with
            // errorKind="transient" (it's an infrastructure symptom, not a model
            // problem), mark lastError, and return void so the outer loop can proceed
            // to the next round via auto-feedback. Without this guard, a tool-call
            // runaway inside opencode's inner LLM layer can block a phase forever.
            if (input.phaseTimeoutMs && input.phaseTimeoutMs > 0) {
              yield* core.pipe(
                Effect.timeoutOrElse({
                  duration: `${input.phaseTimeoutMs} millis`,
                  // NB: the API is `orElse`, not `onTimeout`. It returns a fallback
                  // Effect that runs when the timeout fires. We use it to synthesize
                  // a phase failure that looks like any other transient error, so the
                  // outer loop's parse-failure path picks it up and moves to the next
                  // round rather than crashing the run.
                  orElse: () =>
                    Effect.sync(() => {
                      success = false
                      errorKind = "transient"
                      errorMessage = `phase timeout: exceeded ${input.phaseTimeoutMs}ms`
                      lastError = `${phase} phase failed (transient): ${errorMessage}`
                      log.error("phase timeout", {
                        runID,
                        phase,
                        timeoutMs: input.phaseTimeoutMs,
                      })
                    }),
                }),
              )
            } else {
              yield* core
            }

            yield* bus.publish(Event.PhaseCompleted, {
              runID,
              round: phaseRound,
              phase,
              durationMs: Date.now() - phaseStartedAt,
              success,
              errorKind,
              errorMessage,
              timestamp: Date.now(),
            })
          })

        // Budget gate: after each phase, re-query accumulated cost across both child
        // sessions and compare against `maxUsd`. `warnUsd` only logs, it does not abort.
        // Return `true` if the ceiling was tripped, `false` otherwise. Caller breaks
        // out of the loop on `true`.
        const checkBudget = (phase: DualPhaseName, phaseRound: number) =>
          Effect.gen(function* () {
            if (!input.budget) return false
            totalCost = yield* getAccumulatedCost(sessions, provider, [
              studentSession.id,
              supervisorSession.id,
            ])
            const warned = !!(input.budget.warnUsd && totalCost >= input.budget.warnUsd)
            const breached = !!(input.budget.maxUsd && totalCost >= input.budget.maxUsd)
            yield* bus.publish(Event.BudgetCheck, {
              runID,
              round: phaseRound,
              phase,
              totalCost,
              maxUsd: input.budget.maxUsd,
              warnUsd: input.budget.warnUsd,
              warned,
              breached,
              timestamp: Date.now(),
            })
            if (warned) {
              log.info("budget warning threshold reached", {
                runID,
                totalCost,
                warnUsd: input.budget.warnUsd,
              })
            }
            if (breached) {
              status = "budget_exceeded"
              lastError = `budget exceeded: $${totalCost.toFixed(4)} >= $${input.budget.maxUsd}`
              log.info("budget ceiling hit — aborting", {
                runID,
                totalCost,
                maxUsd: input.budget.maxUsd,
              })
              return true
            }
            return false
          })

        // Helper: build the final Result object + emit the `dual.finished` event in one
        // place. Every early-return path goes through this so observers always see
        // exactly one Finished event per run, regardless of whether the orchestrator
        // exited normally or bailed early on budget/contract failure.
        const finish = Effect.fn("SessionDualAgent.finish")(function* () {
          // Always compute final cost — not just when budget is set. The stress
          // harness and other callers need cost data for comparison reporting.
          if (status !== "budget_exceeded") {
            totalCost = yield* getAccumulatedCost(sessions, provider, [
              studentSession.id,
              supervisorSession.id,
            ])
          }
          const result: Result = {
            status,
            rounds: round,
            studentSessionID: studentSession.id,
            supervisorSessionID: supervisorSession.id,
            finalArtifact: lastStudent?.artifact,
            finalVerdict: lastVerdict as Record<string, unknown> | undefined,
            lastError,
            totalCost: totalCost || undefined,
          }
          yield* bus.publish(Event.Finished, {
            runID,
            status,
            rounds: round,
            totalCost: totalCost || undefined,
            totalDurationMs: Date.now() - runStartedAt,
            lastError,
            timestamp: Date.now(),
          })
          return result
        })

        // Feedback ledger: one line per completed round. Both Student and Supervisor
        // see the full history so they can avoid regressions and track progress.
        const ledger: string[] = []
        let locked = false

        // --- Strict mode Round 0 -----------------------------------------------------
        // In strict mode we prepend a plan-first phase before the main loop:
        // Student drafts a structured plan and Supervisor returns implementation guidance.
        // The orchestrator compacts this into a plan_packet and carries only that packet
        // (plus short rolling ledger) into subsequent rounds.
        if (mode === "strict") {
          const studentR0Prompt = renderStudentRound0Prompt(input.task)
          yield* stamp(sessions, parent.id, "phd", 0, studentR0Prompt, studentModel())
          yield* runPhase("student_r0", 0, studentSession.id, STUDENT_AGENT, studentR0Prompt, flush())
          if (yield* checkBudget("student_r0", 0)) {
            return yield* finish()
          }

          const rawStudentR0 = yield* lastAssistantText(sessions, studentSession.id)
          const draft = extractJSON(rawStudentR0) as StudentOutput | undefined
          if (!draft || !draft.artifact) {
            // Bail out — no plan means Supervisor can't produce reliable guidance.
            // Don't fall through to the main loop; finish with an error status.
            status = "error"
            lastError = lastError ?? "student round 0 produced no usable plan draft"
            return yield* finish()
          }
          lastStudent = draft

          const supR0Prompt = renderSupervisorRound0Prompt(input.task, draft)
          yield* stamp(sessions, parent.id, "supervisor", 0, supR0Prompt, supervisorModel())
          yield* runPhase("supervisor_r0", 0, supervisorSession.id, SUPERVISOR_AGENT, supR0Prompt)
          if (yield* checkBudget("supervisor_r0", 0)) {
            return yield* finish()
          }

          // Feed Round 0 review directly into Round 1 Student as initial feedback.
          const rawSupR0 = yield* lastAssistantText(sessions, supervisorSession.id)
          const supR0 = extractJSON(rawSupR0) as SupervisorOutput | undefined
          if (!supR0) {
            log.info("supervisor round 0 produced no parseable plan review; proceeding anyway")
            plan = packet(input.task, ledger, lastStudent, feedback, mode, plan)
          } else {
            feedback = supR0
            lastVerdict = supR0
            ledger.push(`R0: PLAN REVIEW — ${supR0.main_issue || "(no detail)"}`)
            plan = packet(input.task, ledger, lastStudent, feedback, mode, plan)
          }

          let approved = false
          let revise = 0
          while (!approved) {
            const note = plan?.l2.current_step || feedback?.repair_hint || "Plan is ready for review."
            const answers = yield* question
              .ask({
                sessionID: parent.id,
                questions: [
                  {
                    header: "Plan approval",
                    question:
                      `Supervisor has prepared the implementation plan.\n\n` +
                      `Current step: ${note}\n\n` +
                      `Approve this plan and start Student execution now?`,
                    options: [
                      {
                        label: "Approve and execute",
                        description: "Start implementation with Student and checkpoint reviews.",
                      },
                      {
                        label: "Revise plan",
                        description: "Keep planning with Supervisor before any execution.",
                      },
                    ],
                    custom: true,
                  },
                ],
              })
              .pipe(Effect.catchTag("QuestionRejectedError", () => Effect.succeed([["Revise plan"]])))
            const picked = (answers[0]?.[0] ?? "").trim()
            if (/^(approve and execute|approve|yes|通过|同意|执行)/i.test(picked)) {
              approved = true
              ledger.push("R0: USER APPROVED PLAN")
              break
            }

            revise++
            if (revise > 6) {
              status = "fail"
              lastError = "plan approval loop exceeded 6 revisions"
              return yield* finish()
            }

            const req =
              picked && !/^revise plan$/i.test(picked)
                ? picked
                : "User requested plan revision before execution."
            const supRevisePrompt = renderSupervisorPlanRevisePrompt(input.task, plan, feedback, req)
            yield* stamp(sessions, parent.id, "supervisor", 0, supRevisePrompt, supervisorModel())
            yield* runPhase("supervisor_r0", 0, supervisorSession.id, SUPERVISOR_AGENT, supRevisePrompt)
            if (yield* checkBudget("supervisor_r0", 0)) {
              return yield* finish()
            }
            const rawRevise = yield* lastAssistantText(sessions, supervisorSession.id)
            const revised = extractJSON(rawRevise) as SupervisorOutput | undefined
            if (!revised) {
              status = "error"
              lastError = "supervisor plan revision produced no parseable JSON"
              return yield* finish()
            }
            feedback = revised
            lastVerdict = revised
            ledger.push(`R0: PLAN REVISED — ${revised.main_issue || "(no detail)"}`)
            plan = packet(input.task, ledger, lastStudent, feedback, mode, plan)
          }
        }

        const autoPass = Effect.fn("SessionDualAgent.autoPass")(
          function* (round: number, note: string) {
            log.info("auto-pass: dual-agent pass", { round, note })
            ledger.push(`R${round}: PASS (auto — ${note})`)
            yield* stamp(
              sessions,
              parent.id,
              "supervisor",
              round,
              `[auto-pass] ${note}`,
              supervisorModel(),
            )
            yield* bus.publish(Event.PhaseCompleted, {
              runID,
              round,
              phase: "supervisor" as DualPhaseName,
              durationMs: 0,
              success: true,
              timestamp: Date.now(),
            })
            if (typeof input.onRoundComplete === "function") {
              yield* Effect.promise(() => (input.onRoundComplete as (round: number) => Promise<void>)(round))
            }
            status = "pass"
          },
        )

        while (round < maxRounds) {
          round++

          // --- Interactive gate ---------------------------------------------------------
          // Fire `_onGate` at the top of every round after the first so callers
          // (specifically `runInteractive`) can block here between rounds. Pass /
          // autoPass / budget-exceeded all break out BEFORE reaching this point, so
          // terminal transitions are unaffected: finish() runs, Event.Finished fires,
          // and the client learns the run is done.
          if (round > 1 && typeof input._onGate === "function") {
            yield* Effect.promise(() => (input._onGate as (round: number) => Promise<void>)(round - 1))
          }

          // --- HISTORY_SNIP — aggressive pre-round prune of the Student session ---------
          // Between rounds, we aggressively snip *older* tool-call outputs (e.g. the
          // literal file contents returned by prior rounds' read tool calls, or the
          // edit-diff echoes) from Student's session. We keep the user/assistant text
          // (task prompt, supervisor feedback, Student's own JSON output) so Student
          // retains episodic memory of what it did and what it was told — but we drop
          // the large, stale tool-output blobs that bloat context without carrying
          // semantic value for the next round.
          //
          // This runs on top of opencode's native `compaction.prune` (which is too
          // conservative for mid-size sessions — default PRUNE_PROTECT=40K tokens
          // leaves a 20K dual-agent session fully uncleared) by lowering the protect
          // threshold to ~2K and allowing even small prunes to commit.
          if (round > 1) {
            yield* compaction
              .prune({
                sessionID: studentSession.id,
                protectTokens: 2_000,
                minTokens: 0,
                protectTurns: 1,
              })
              .pipe(
                Effect.catchCause((cause) => {
                  log.warn("student snip failed", { cause: String(Cause.squash(cause)) })
                  return Effect.succeed(undefined)
                }),
              )
          }

          // --- Student phase ------------------------------------------------------------
          plan = packet(input.task, ledger, lastStudent, feedback, mode, plan)
          const studentPrompt = renderStudentPrompt(input.task, feedback, round, ledger, plan, mode)
          yield* stamp(sessions, parent.id, "phd", round, studentPrompt, studentModel())
          yield* runPhase(
            "student",
            round,
            studentSession.id,
            STUDENT_AGENT,
            studentPrompt,
            round === 1 ? flush() : [],
          )
          if (yield* checkBudget("student", round)) break

          const rawStudent = yield* lastAssistantText(sessions, studentSession.id)
          const studentTrace = yield* extractCurrentRoundTrace(sessions, studentSession.id)
          yield* bus.publish(Event.TraceExtracted, {
            runID,
            round,
            toolCallCount: studentTrace.length,
            timestamp: Date.now(),
          })
          let parsedStudent = extractJSON(rawStudent) as StudentOutput | undefined
          if (!parsedStudent) {
            // Student didn't produce valid JSON. But Student is a tool-using agent —
            // its PRIMARY output is tool calls (write, edit, bash), not JSON text.
            // If Student made write/edit tool calls, we have real work to review.
            // Synthesize a minimal StudentOutput from the trace and proceed to
            // Supervisor rather than wasting the round.
            const writeOps = studentTrace.filter((t) => WRITE_TOOLS.has(t.tool))
            if (writeOps.length > 0) {
              log.info("student JSON salvaged from trace", { round, writeOps: writeOps.length })
              parsedStudent = {
                task_understanding: "(extracted from tool trace — JSON response was malformed)",
                changes_made: writeOps.map(
                  (t) => `${t.tool}: ${truncate(t.input, 100)}`,
                ),
                artifact: "(see tool trace and workdir)",
                self_check: { what_i_checked: [], remaining_risk: "JSON response failed to parse" },
                request_for_supervisor: "Verify the files I wrote via tools",
              } as StudentOutput
              // Fall through to supervisor phase — don't continue
            } else {
              const direct = rawStudent.trim()
              if (direct) {
                // Plain-text reply with no JSON and no write tools — i.e. PhD chose to
                // answer the user directly instead of doing implementation work. Treat
                // it as a chat turn and end the run, regardless of mode. Without this
                // every "你好"/"explain X" prompt in fast or strict mode would loop until
                // maxRounds: PhD keeps answering chattily, supervisor never gets a JSON
                // artifact to verify, and the orchestrator wedges on the between-rounds
                // gate waiting for user input it has no signal to resume from.
                lastStudent = {
                  task_understanding: "Direct response — no tool calls or code changes",
                  changes_made: [],
                  artifact: direct,
                  self_check: { what_i_checked: [], remaining_risk: "Chat-style reply, supervisor skipped" },
                  request_for_supervisor: "",
                }
                yield* autoPass(round, `direct chat reply from phd in ${mode} mode`)
                break
              }
              if (input.testCmd) {
                const testResult = exec(input.testCmd, yield* InstanceState.directory, 30_000)
                if (testResult.status === 0) {
                  yield* autoPass(round, "All tests passed after an empty final reply.")
                  break
                }
              }
              // No tool calls AND no JSON — truly empty round
              lastError = `student round ${round}: no JSON and no tool calls`
              feedback = {
                status: "fail",
                main_issue: "Student produced no output — no valid JSON and no file writes",
                evidence: "JSON parse failed, tool trace empty",
                repair_hint: "Write the implementation using tools, then respond with the JSON summary.",
              }
              yield* stamp(
                sessions,
                parent.id,
                "supervisor",
                round,
                `[auto] ${feedback.main_issue}: ${feedback.evidence}`,
                supervisorModel(),
              )
              ledger.push(`R${round}: FAIL — student produced no output (no JSON, no tool calls)`)
              if (typeof input.onRoundComplete === "function") {
                yield* Effect.promise(() => (input.onRoundComplete as (round: number) => Promise<void>)(round))
              }
              continue
            }
          }
          lastStudent = parsedStudent

          // --- Auto-test gate ----------------------------------------------------------
          // If testCmd is provided, run tests BEFORE calling supervisor. This is the
          // single biggest perf optimization: it eliminates supervisor's redundant test
          // execution (which can timeout on hanging code) and skips the supervisor LLM
          // call entirely when all tests pass.
          let preTestOutput: string | undefined
          let preTestPassed = false
          if (input.testCmd) {
            const testResult = exec(input.testCmd, yield* InstanceState.directory, 30_000)
            preTestOutput = testResult.output
            preTestPassed = testResult.status === 0
            if (preTestPassed) {
              yield* autoPass(round, "All tests passed (exit 0). Supervisor skipped.")
              break
            }
          }

          if (mode === "auto") {
            const next = locked
              ? { review: true, stage: "strict" as const, note: "strict path locked after escalation" }
              : audit(round, parsedStudent, studentTrace, feedback)
            if (!next.review) {
              yield* autoPass(round, `${next.note}. supervisor skipped in auto mode`)
              break
            }
            if (next.stage === "strict" && !locked) {
              locked = true
              ledger.push(`R${round}: AUTO ESCALATION — strict path (${next.note})`)
            }
            log.info("auto mode escalated to supervisor", { round, stage: next.stage, reason: next.note })
          }

          // --- Supervisor phase ---------------------------------------------------------
          // Asymmetric memory forward leg: pull Student's current-round tool-call trace
          // from Student's isolated session and hand it to Supervisor as ground truth.
          // The reverse direction does NOT happen — Student only ever sees the structured
          // `SupervisorOutput` JSON via `<supervisor_feedback>` in the next student round,
          // never Supervisor's tool calls or raw text. That asymmetry is load-bearing:
          // Student cannot Goodhart Supervisor's reasoning if Student cannot read it.
          const supPrompt = renderSupervisorPrompt(
            input.task,
            parsedStudent,
            round,
            studentTrace,
            ledger,
            plan,
            preTestOutput,
            mode,
          )
          yield* stamp(sessions, parent.id, "supervisor", round, supPrompt, supervisorModel())
          yield* runPhase("supervisor", round, supervisorSession.id, SUPERVISOR_AGENT, supPrompt)
          if (yield* checkBudget("supervisor", round)) break

          // Hook: let callers (stress harness) snapshot workdir state between rounds.
          // Awaited synchronously so the workdir is stable during the callback.
          if (typeof input.onRoundComplete === "function") {
            yield* Effect.promise(() => (input.onRoundComplete as (round: number) => Promise<void>)(round))
          }

          const rawSup = yield* lastAssistantText(sessions, supervisorSession.id)
          const parsedSup = extractJSON(rawSup) as SupervisorOutput | undefined
          if (!parsedSup) {
            lastError = `supervisor round ${round}: could not parse JSON`
            feedback = {
              status: "fail",
              main_issue: "Supervisor did not return valid JSON",
              evidence: "JSON parse failed",
              repair_hint: "Continue with previous attempt; supervisor output was unreadable.",
            }
            ledger.push(`R${round}: FAIL — supervisor JSON parse error`)
            continue
          }
          lastVerdict = parsedSup

          yield* bus.publish(Event.VerdictReceived, {
            runID,
            round,
            status: parsedSup.status ?? "fail",
            mainIssue: parsedSup.main_issue,
            timestamp: Date.now(),
          })

          if (parsedSup.status === "pass") {
            ledger.push(`R${round}: PASS`)
            status = "pass"
            log.info("dual-agent pass", { round })
            break
          }
          ledger.push(`R${round}: FAIL — ${parsedSup.main_issue || "(no detail)"}`)
          feedback = parsedSup
          plan = packet(input.task, ledger, lastStudent, feedback, mode, plan)
        }

        if (round >= maxRounds && !new Set(["pass", "budget_exceeded"]).has(status)) {
          status = "fail"
          log.info("dual-agent exhausted rounds", { round, maxRounds })
        }

        return yield* finish()
      })

      return Service.of({ run })
    }),
  )

  export const defaultLayer = Layer.suspend(() =>
    layer.pipe(
      Layer.provide(SessionPrompt.defaultLayer),
      Layer.provide(Session.defaultLayer),
      Layer.provide(Provider.defaultLayer),
      Layer.provide(Question.defaultLayer),
      Layer.provide(SessionCompaction.defaultLayer),
      // Bus is required directly by the dual-agent layer (for telemetry event publishing)
      // and is NOT re-exported by Session.defaultLayer even though Session uses it
      // internally. Provide it explicitly so production callers (CLI, eval harness) can
      // resolve the layer without needing their own Bus.layer provision.
      Layer.provide(Bus.layer),
    ),
  )

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function run(input: Input) {
    return runPromise((svc) => svc.run(Input.parse(input)))
  }

  /**
   * Handle returned by `runInteractive`. The TUI drives the loop through this:
   * - `result` resolves when the run ends (pass/fail/error/aborted).
   * - `advance()` releases the current between-rounds pause. Must be called once per
   *   round or the loop hangs waiting.
   * - `abort(reason)` marks the run aborted; the next between-rounds pause (or the
   *   currently waiting one) rejects the orchestrator's `onRoundComplete` and the
   *   `run()` promise rejects with the given reason. Does NOT interrupt a phase
   *   mid-LLM-call — that's deliberately out of scope for Phase 1; add it when we
   *   thread AbortSignal through SessionPrompt.
   */
  export type InteractiveHandle = BaseInteractiveHandle<ResolvedModel, Result>

  /**
   * One-shot pause gate. `wait()` blocks until `advance()` is called, then blocks
   * again on the next `wait()` call. `abort()` poisons the gate — the currently
   * waiting `wait()` rejects, and every subsequent `wait()` rejects immediately.
   *
   * Extracted so the pause/advance/abort behaviour is unit-testable without spinning
   * a real dual-agent loop; `runInteractive` is a ~7-line wiring on top.
   */
  export const gate = interactiveGate

  /**
   * Interactive variant of `run`. Builds on the existing `onRoundComplete` hook so
   * the underlying orchestrator doesn't need to change — the loop already awaits that
   * hook between every round, so a gate promise injected there gives us pause for free.
   *
   * If the caller's own `onRoundComplete` was supplied (e.g. stress harness snapshot),
   * it runs first; the pause gate runs second. That order preserves workdir-stability
   * semantics documented on `Input.onRoundComplete`.
   */
  export function runInteractive(input: Input): InteractiveHandle {
    return startInteractive(run, input)
  }
}
