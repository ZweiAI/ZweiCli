/**
 * Dual-agent stress / comparison harness.
 *
 * Purpose: measure the architectural claim that the dual-agent feedback loop
 * **extends Student's effective attention across multi-round tasks**. Single-agent
 * baseline is the control; dual-agent is the treatment; we compare on three metrics:
 *
 *   1. **Pass rate** — fraction of seeded `bun test` cases that the final code passes
 *      (straightforward measure of task completion coverage)
 *   2. **Constraint retention** — of the task-level constraints that Student satisfied
 *      after round 1, how many still hold at the final round? Measures whether later
 *      rounds preserve earlier wins. Non-1.0 means Student broke something they had
 *      already gotten right — the worst failure mode for iterative refinement.
 *   3. **Error recurrence rate** — of the tests that were passing after round 1, how
 *      many are failing at the end? Directly measures "did the feedback loop destroy
 *      correct code that was already working?"
 *
 * Metrics (2) and (3) are only defined for dual mode (they require multiple rounds);
 * single mode reports N/A.
 *
 * Each task runs `trialCount` times per mode with a **fresh scratch workdir per trial**
 * to avoid cross-trial contamination. Results aggregate per mode for headline numbers
 * but preserve per-trial detail so variance is visible.
 *
 * ## Known limitations
 *
 * - 3 trials is directional, not statistically significant. Interpret gaps of <10%
 *   as "within noise" — report ranges, not just means.
 * - Test suite bias: the seeded test set is what we're measuring, so make sure tests
 *   are independent behavioral checks, not compound goals that reward iterative passes.
 * - Phase timeout must be generous (240s default) — dual mode runs longer, and we
 *   don't want the timeout to bias the measurement against dual.
 * - Recurrence snapshot timing: we run tests at "end of round 1 supervisor phase" and
 *   "end of run". If student rewrites files mid-round, snapshots see only the
 *   end-of-round state. Good enough for directional signal.
 */

import z from "zod"
import nodePath from "path"
import { spawn, spawnSync } from "child_process"
import { Effect, Layer, Context, Cause } from "effect"
import { Log } from "../util/log"
import { Session } from "."
import { SessionPrompt } from "./prompt"
import { SessionDualAgent } from "./dual-agent"
import { Permission } from "../permission"
import { ProviderID, ModelID } from "../provider/schema"
import { Provider } from "../provider/provider"
import { InstanceState } from "../effect/instance-state"
import { Shell } from "../shell/shell"
import { makeRuntime } from "@/effect/run-service"

export namespace SessionDualAgentStress {
  const log = Log.create({ service: "session.dual-agent-stress" })

  function args(file: string, cmd: string) {
    const shell = Shell.name(file)
    if (shell === "powershell" || shell === "pwsh") return ["-NoProfile", "-Command", cmd]
    if (shell === "cmd") return ["/d", "/s", "/c", cmd]
    if (Shell.login(file)) return ["-lc", cmd]
    return ["-c", cmd]
  }

  function sync(cmd: string, cwd: string, timeout: number) {
    const file = Shell.preferred()
    return spawnSync(file, args(file, cmd), {
      cwd,
      encoding: "utf-8",
      timeout,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: process.platform === "win32",
    })
  }

  // ---------- Constraint spec ----------

  /**
   * A single programmatic check against the final workdir state. Constraints are
   * evaluated at `end of round 1 supervisor phase` and `end of final run`; the
   * difference drives the retention metric.
   *
   * Three check types:
   *   - `fileRegex`: read a file and test its content against a regex. Simplest, brittle
   *     for semantic properties, fine for structural ones like "has a class declaration".
   *   - `bash`: run a shell command in the workdir, check exit code. Most flexible — use
   *     for anything expressible as `node -e "..."` or similar.
   *   - `bashOutput`: run a command and regex-match its stdout. Use when exit code alone
   *     isn't enough (e.g. "the script must print a JSON with a specific field").
   *   - `jsExpr`: read the source file, import it via a base64 data URL (so the import
   *     auto-cache-busts by content), and run a JS expression against the imported
   *     module. The expression's `return` value (truthy/falsy) is the constraint result.
   *     This is the PREFERRED check type — no spawnSync, no Windows cold-start cost,
   *     no flaky timing. Use this whenever you need to invoke student's code rather
   *     than just inspecting source bytes. The expression has access to one variable
   *     `mod` (the imported module's exports namespace), and runs inside an arrow
   *     function so `return` works at the top level.
   */
  export const Constraint = z.discriminatedUnion("type", [
    z.object({
      id: z.string().min(1),
      description: z.string(),
      type: z.literal("fileRegex"),
      file: z.string(),
      regex: z.string(),
      mustMatch: z.boolean(),
    }),
    z.object({
      id: z.string().min(1),
      description: z.string(),
      type: z.literal("bash"),
      cmd: z.string(),
      mustExit: z.number().int(),
      timeoutMs: z.number().int().positive().optional(),
    }),
    z.object({
      id: z.string().min(1),
      description: z.string(),
      type: z.literal("bashOutput"),
      cmd: z.string(),
      mustMatch: z.string(), // serialized regex source
      timeoutMs: z.number().int().positive().optional(),
    }),
    z.object({
      id: z.string().min(1),
      description: z.string(),
      type: z.literal("jsExpr"),
      /** Source file relative to the workdir, e.g. "src/stack.js". */
      file: z.string(),
      /**
       * JS expression body. Has access to `mod` (the imported module's exports).
       * Wrapped in an arrow function so you can use `return` directly.
       *
       * Example: "const s = new mod.Stack(); try { s.pop(); return false } catch { return true }"
       */
      expr: z.string(),
    }),
  ])
  export type Constraint = z.infer<typeof Constraint>

  // ---------- StressTask spec ----------

  export interface StressTask {
    id: string
    description?: string
    /** The task text handed to Student (for dual) or build agent (for single). */
    task: string
    /** Files to seed into the workdir before each trial. Same shape as Task.seed. */
    seed: Record<string, string>
    /**
     * Command to run the test suite. Relative to workdir. Must exit 0 on all pass,
     * nonzero on any fail. Its stdout is parsed for per-test pass/fail (see
     * `parseBunTestOutput`).
     */
    testsCmd: string
    /** Constraint checks — run at round 1 supervisor end and at final end. */
    constraints: Constraint[]
    /** Number of trials per mode. Default 3. */
    trialCount?: number
    /** Max rounds for the dual-agent loop. Default 5. */
    maxRounds?: number
    /**
     * Optional permission ruleset applied to the Student (in dual) and the Build
     * agent (in single). Intended for tasks where the test file must physically
     * exist in the workdir (so `bun test` can find it) but the student must not
     * be able to read its source. Typical value:
     *
     *   [
     *     { permission: "*", pattern: "*", action: "allow" },
     *     { permission: "read", pattern: "**\/tests/**", action: "deny" },
     *     { permission: "edit", pattern: "**\/tests/**", action: "deny" },
     *   ]
     *
     * Rules are last-match-wins, so deny rules must come AFTER the allow.
     */
    studentPermission?: Permission.Ruleset
    /**
     * Per-phase wall-clock timeout in ms. Default 240_000 (4 min). Generous because
     * dual runs inherently take longer; we don't want timeout to bias measurement.
     */
    phaseTimeoutMs?: number
  }

  // ---------- Per-trial and aggregated result types ----------

  export interface TestRunResult {
    /** Tests that passed, identified by full test name (as printed by bun). */
    passed: string[]
    /** Tests that failed, identified by full test name. */
    failed: string[]
    /** Raw stdout+stderr from the test invocation, useful for debugging. */
    raw: string
    /** True if the test runner exited nonzero. */
    nonZeroExit: boolean
  }

  export interface TrialResult {
    mode: "dual" | "single"
    trialIndex: number
    // Test metrics
    testsAvailable: boolean
    testsError: string | undefined
    testsPassed: number
    testsFailed: number
    testsTotal: number
    passRate: number | undefined // 0..1, computed as passed / total
    // Constraint metrics
    constraintsAtEnd: Record<string, boolean>
    constraintsAtRound1: Record<string, boolean> | undefined // undefined for single
    constraintRetention: number | undefined // (round1 held ∩ end held) / round1 held, undefined for single
    // Error recurrence (dual only)
    round1Pass: string[] | undefined
    recurrences: number | undefined // |round1Pass ∩ finalFail|
    recurrenceRate: number | undefined // recurrences / max(round1Pass.length, 1)
    // Meta
    durationMs: number
    rounds: number
    finalStatus: string
    /** Total USD cost across all LLM calls in this trial. Undefined if provider doesn't report cost. */
    costUsd: number | undefined
  }

  export interface AggregateMetrics {
    meanPassRate: number | undefined
    passRateRange: [number, number] | undefined
    testedTrials: number
    unavailableTrials: number
    meanConstraintRetention: number | undefined
    meanRecurrenceRate: number | undefined
    totalDurationMs: number
    totalCostUsd: number | undefined
  }

  export interface ComparisonReport {
    taskId: string
    trialCount: number
    dual: AggregateMetrics
    single: AggregateMetrics
    dualTrials: TrialResult[]
    singleTrials: TrialResult[]
  }

  // ---------- Test runner (bun test invocation + output parsing) ----------

  /**
   * Parse `bun test` stdout into a {passed, failed, raw} struct. Bun's default output
   * format (seen in multiple test suites in opencode itself):
   *
   *     test/file.test.ts:
   *     (pass) name of passing test [1.23ms]
   *     (fail) name of failing test [2.34ms]
   *       error details...
   *
   *      2 pass
   *      1 fail
   *      3 expect() calls
   *     Ran 3 tests across 1 file. [120ms]
   *
   * We parse the `(pass)` / `(fail)` markers to collect individual test names.
   * Falls back to the `N pass / M fail` summary if no individual markers were found.
   */
  export function parseBunTestOutput(raw: string): TestRunResult {
    const passed: string[] = []
    const failed: string[] = []
    // Match "(pass) test name [optional ms]" or "(fail) test name [optional ms]"
    const lineRx = /^\s*\((pass|fail|skip|todo)\)\s+(.+?)(?:\s+\[[\d.]+m?s\])?\s*$/
    for (const line of raw.split(/\r?\n/)) {
      const m = lineRx.exec(line)
      if (!m) continue
      const kind = m[1]
      const name = m[2]!.trim()
      if (kind === "pass") passed.push(name)
      else if (kind === "fail") failed.push(name)
      // "skip" and "todo" don't count toward pass or fail
    }

    // Reconcile with the summary line. Newer `bun test` only prints `(pass)`/`(fail)`
    // markers for FAILING tests by default — passing tests are silent, only the summary
    // shows them ("18 pass  2 fail"). Without this reconciliation we'd under-count
    // passes and report bogus 0/N results. If the summary says more passes than we
    // have named markers, pad with `anonymous_pass_N` entries; same for fails (rare,
    // but symmetric for robustness).
    const sumRx = /(\d+)\s+pass(?:\s|$)/
    const failRx = /(\d+)\s+fail(?:\s|$)/
    const sumPass = sumRx.exec(raw)
    const sumFail = failRx.exec(raw)
    if (sumPass) {
      const summaryPassCount = parseInt(sumPass[1]!, 10)
      for (let i = passed.length; i < summaryPassCount; i++) {
        passed.push(`anonymous_pass_${i + 1}`)
      }
    }
    if (sumFail) {
      const summaryFailCount = parseInt(sumFail[1]!, 10)
      for (let i = failed.length; i < summaryFailCount; i++) {
        failed.push(`anonymous_fail_${i + 1}`)
      }
    }
    return {
      passed,
      failed,
      raw,
      nonZeroExit: false, // caller fills in from actual exit code
    }
  }

  function testError(result: TestRunResult) {
    return result.failed.find((x) => x.startsWith("HARNESS_"))
  }

  function testAvailable(result: TestRunResult) {
    return testError(result) === undefined
  }

  /**
   * Hard ceiling for a single `runTests` invocation. 30s is enough for bun test to
   * boot, load a few hundred lines of student code, and run up to ~50 tests. If it
   * exceeds this, something is genuinely wrong (infinite loop in student code, file
   * lock, etc.) and the trial should fail fast rather than wait minutes.
   */
  const RUN_TESTS_TIMEOUT_MS = 30_000

  /**
   * Run `bun test` (or equivalent) in the given workdir. Returns a Promise that
   * resolves to a TestRunResult — **non-blocking**, so it can be called from inside
   * an Effect context without freezing the runtime.
   *
   * Why not `spawnSync`: the harness used to use spawnSync, which blocks the Node
   * event loop until the child exits. On Windows specifically, running `bun test`
   * shortly after dual-agent's supervisor completes its own `bun test` via the bash
   * tool can cause pipe/lock contention that hangs the second invocation for >120s.
   * The blocking sync path exhausted the Effect runtime AND the test runner's own
   * internal timeout. Switching to async `spawn` with a promise wrapper lets the
   * event loop keep servicing the Effect runtime while we wait for the subprocess,
   * and also lets us enforce a tight 30s ceiling.
   *
   * Uses `child_process.spawn` rather than opencode's bash tool because this call
   * is part of harness instrumentation — not a user action — and should not show
   * up in any agent's action trace.
   */
  export function runTests(workdir: string, cmd: string): Promise<TestRunResult> {
    if (!cmd.trim()) {
      return Promise.resolve({
        passed: [],
        failed: ["HARNESS_ERROR: empty cmd"],
        raw: "",
        nonZeroExit: true,
      })
    }
    return new Promise<TestRunResult>((resolve) => {
      let stdout = ""
      let stderr = ""
      let timedOut = false
      let child
      try {
        const file = Shell.preferred()
        child = spawn(file, args(file, cmd), {
          cwd: workdir,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: process.platform === "win32",
        })
      } catch (e) {
        resolve({
          passed: [],
          failed: [`HARNESS_ERROR: spawn failed: ${e instanceof Error ? e.message : String(e)}`],
          raw: "",
          nonZeroExit: true,
        })
        return
      }
      const killTimer = setTimeout(() => {
        timedOut = true
        try {
          child.kill("SIGKILL")
        } catch {
          /* ignore */
        }
      }, RUN_TESTS_TIMEOUT_MS)
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString()
      })
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString()
      })
      child.on("error", (err) => {
        clearTimeout(killTimer)
        resolve({
          passed: [],
          failed: [`HARNESS_ERROR: ${err.message}`],
          raw: stdout + stderr,
          nonZeroExit: true,
        })
      })
      child.on("close", (code) => {
        clearTimeout(killTimer)
        const combined = stdout + "\n" + stderr
        if (timedOut) {
          resolve({
            passed: [],
            failed: ["HARNESS_TIMEOUT"],
            raw: combined,
            nonZeroExit: true,
          })
          return
        }
        const parsed = parseBunTestOutput(combined)
        parsed.nonZeroExit = code !== 0
        resolve(parsed)
      })
    })
  }

  // ---------- Constraint evaluator ----------

  /**
   * Evaluate a single constraint against the current workdir state. Returns a
   * boolean: true = constraint held, false = constraint violated. Does NOT throw —
   * errors (file not found, command missing, regex invalid) count as "not held".
   *
   * Async because the preferred check type (`jsExpr`) imports student's source
   * via dynamic `import()`. The spawnSync-based `bash`/`bashOutput` types are
   * still supported for back-compat but should be avoided — they tripped a
   * Windows-specific cold-start timeout (~15-30s for the first spawn after a
   * fresh workdir state) that produced false negatives. See git history for
   * the pre-warm hack we used to work around it; the real fix is `jsExpr`.
   */
  export async function evaluateConstraint(workdir: string, c: Constraint): Promise<boolean> {
    try {
      if (c.type === "fileRegex") {
        const abs = nodePath.resolve(workdir, c.file)
        let content: string
        try {
          const fs = await import("fs/promises")
          content = await fs.readFile(abs, "utf-8")
        } catch {
          // File missing counts as "regex didn't match" which respects mustMatch
          return !c.mustMatch
        }
        const rx = new RegExp(c.regex)
        const matched = rx.test(content)
        return matched === c.mustMatch
      }
      if (c.type === "jsExpr") {
        // Import the source file via file:// URL with a cache-busting query param.
        // Previous approach used data: URLs which broke multi-file tasks (relative
        // imports like `import { signal } from "./reactive.js"` can't resolve from
        // a data URL context). file:// preserves the directory context so relative
        // imports work. The `?t=Date.now()` query param forces Bun to re-import
        // even if the path hasn't changed (content might have between snapshots).
        const abs = nodePath.resolve(workdir, c.file)
        let mod: Record<string, unknown>
        const fileUrl = "file://" + abs.replace(/\\/g, "/") + "?t=" + Date.now()
        try {
          mod = (await import(fileUrl)) as Record<string, unknown>
        } catch (e) {
          log.warn("jsExpr constraint: import failed", {
            id: c.id,
            error: e instanceof Error ? e.message : String(e),
          })
          return false
        }
        // Wrap the expression body in an async arrow so the user can use
        // `return`, `await`, `try/catch`, etc. AsyncFunction returns a Promise
        // that resolves to the function's value.
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
          ...args: string[]
        ) => (mod: unknown) => Promise<unknown>
        let fn: (mod: unknown) => Promise<unknown>
        try {
          fn = new AsyncFunction("mod", `"use strict";\n${c.expr}`)
        } catch (e) {
          log.warn("jsExpr constraint: expression compile failed", {
            id: c.id,
            error: e instanceof Error ? e.message : String(e),
          })
          return false
        }
        try {
          const result = await fn(mod)
          return Boolean(result)
        } catch (e) {
          log.warn("jsExpr constraint: expression threw", {
            id: c.id,
            error: e instanceof Error ? e.message : String(e),
          })
          return false
        }
      }
      if (c.type === "bash") {
        const result = sync(c.cmd, workdir, c.timeoutMs ?? 30_000)
        const passed = result.status === c.mustExit
        if (!passed) {
          log.warn("bash constraint failed", {
            id: c.id,
            cwd: workdir,
            status: result.status,
            error: result.error?.message,
            stdout: (result.stdout ?? "").slice(0, 500),
            stderr: (result.stderr ?? "").slice(0, 500),
          })
        }
        return passed
      }
      if (c.type === "bashOutput") {
        const result = sync(c.cmd, workdir, c.timeoutMs ?? 30_000)
        const out = (result.stdout ?? "") + (result.stderr ?? "")
        const rx = new RegExp(c.mustMatch)
        return rx.test(out)
      }
    } catch (e) {
      log.error("constraint eval error", {
        id: (c as { id: string }).id,
        error: e instanceof Error ? e.message : String(e),
      })
      return false
    }
    return false
  }

  /**
   * Evaluate all constraints against the workdir. Returns a record of id → held.
   * Constraints run sequentially (not parallel) so jsExpr imports don't race
   * over the same file content.
   */
  export async function evaluateConstraints(
    workdir: string,
    constraints: Constraint[],
  ): Promise<Record<string, boolean>> {
    const out: Record<string, boolean> = {}
    for (const c of constraints) {
      out[c.id] = await evaluateConstraint(workdir, c)
    }
    return out
  }

  // ---------- Recurrence / retention math ----------

  /**
   * Compute recurrence: tests that were in round1 passed set, but are in final failed set.
   */
  export function computeRecurrences(
    round1Passed: string[] | undefined,
    finalFailed: string[],
  ): { recurrences: number; rate: number } | undefined {
    if (!round1Passed) return undefined
    const finalFailSet = new Set(finalFailed)
    let recurrences = 0
    for (const t of round1Passed) {
      if (finalFailSet.has(t)) recurrences++
    }
    const rate = round1Passed.length > 0 ? recurrences / round1Passed.length : 0
    return { recurrences, rate }
  }

  /**
   * Compute constraint retention: of constraints that held at round 1, what fraction
   * still hold at final? Undefined if no round-1 snapshot was taken.
   */
  export function computeRetention(
    round1: Record<string, boolean> | undefined,
    final: Record<string, boolean>,
  ): number | undefined {
    if (!round1) return undefined
    const round1Held = Object.entries(round1)
      .filter(([, held]) => held)
      .map(([id]) => id)
    if (round1Held.length === 0) return 1.0 // nothing to retain, vacuously true
    let stillHeld = 0
    for (const id of round1Held) {
      if (final[id]) stillHeld++
    }
    return stillHeld / round1Held.length
  }

  // ---------- Workdir cleanup + seed ----------

  /**
   * Wipe all "student-writable" directories inside the workdir and re-apply the
   * task's seed files. Called at the start of every trial (both modes) so no
   * trial inherits state from a previous one.
   *
   * We wipe:
   *   - All paths declared in `task.seed` (so the fresh seed isn't merged with
   *     stale content that may have been edited by Student mid-trial)
   *   - `src/` (student's primary writing target — wipe recursively)
   *   - `tests/` (supervisor's primary writing target; the seed will recreate
   *     the canonical test file since it's listed in `task.seed`)
   *
   * We do NOT wipe the `.git` directory or any hidden files — opencode's git
   * tracking code expects a valid repo, and trial-scoped git state is fine.
   */
  async function cleanWorkdirAndSeed(workdir: string, seed: Record<string, string>): Promise<void> {
    const fs = await import("fs/promises")
    const path = await import("path")
    // Wipe seed paths first — these will be recreated in the next step
    for (const relpath of Object.keys(seed)) {
      const abs = path.resolve(workdir, relpath)
      await fs.rm(abs, { force: true }).catch(() => undefined)
    }
    // Wipe src/ and tests/ recursively (student + supervisor working dirs)
    for (const dir of ["src", "tests", "__tests__"]) {
      await fs.rm(path.resolve(workdir, dir), { recursive: true, force: true }).catch(() => undefined)
    }
    // Re-apply seed
    for (const [relpath, contents] of Object.entries(seed)) {
      const abs = path.resolve(workdir, relpath)
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, contents, "utf-8")
    }
  }

  // ---------- Service + runComparison ----------

  export interface RunOptions {
    model?: { providerID: ProviderID; modelID: ModelID }
    /** Override the task's trialCount. */
    trials?: number
    /** Override the task's phaseTimeoutMs. */
    phaseTimeoutMs?: number
  }

  export interface Interface {
    readonly runComparison: (
      task: StressTask,
      options?: RunOptions,
    ) => Effect.Effect<ComparisonReport>
  }

  export class Service extends Context.Service<Service, Interface>()(
    "@opencode/SessionDualAgentStress",
  ) {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const sessionPrompt = yield* SessionPrompt.Service
      const dual = yield* SessionDualAgent.Service

      /**
       * Run ONE trial in dual mode. Creates a fresh scratch workdir inside the
       * existing Instance (we rely on the Instance being bootstrapped into an
       * ambient workdir that the caller chose — this function creates a subdir
       * under it and treats seed files as relative paths from there).
       *
       * Subscribes to `dual.phase.completed` events filtered on Supervisor phase
       * for round 1; when that fires, takes a snapshot of test state + constraint
       * state. After the run finishes, takes a final snapshot. Aggregates both into
       * a TrialResult.
       */
      const runDualTrial = Effect.fn("SessionDualAgentStress.runDualTrial")(function* (
        task: StressTask,
        trialIndex: number,
        options?: RunOptions,
      ) {
        const startedAt = Date.now()
        // Work inside the ambient Instance directory so all sessions and tool
        // calls are rooted at the same place.
        const ctx = yield* InstanceState.context
        const workdir = ctx.directory

        // Clean + seed BEFORE every trial so state from prior trials doesn't leak
        yield* Effect.promise(() => cleanWorkdirAndSeed(workdir, task.seed))

        // Round-1 snapshot: captured via dual.run()'s onRoundComplete hook.
        // The hook runs synchronously inside the dual loop (between supervisor
        // phase end and the next student start), so the workdir is stable and
        // no events are lost. Previous approach (bus subscription) was unreliable —
        // the subscriber fiber couldn't drain fast enough and missed supervisor
        // events for rounds 1-3. See git history for the Bus-based attempt.
        let round1Snapshot:
          | { testsPassed: string[] | undefined; constraints: Record<string, boolean> }
          | undefined

        const onRoundComplete = async (round: number) => {
          // Take snapshot on the FIRST round where supervisor actually runs.
          // Not hard-coded to round=1 because student's round-1 JSON parse can
          // fail → `continue` → supervisor (and this hook) are skipped for that
          // round. We want the first supervisor-validated state, whatever round
          // number that happens to be.
          if (round1Snapshot) return
          try {
            const [constraintResult, testResult] = await Promise.all([
              evaluateConstraints(workdir, task.constraints),
              runTests(workdir, task.testsCmd),
            ])
            round1Snapshot = {
              testsPassed: testAvailable(testResult) ? testResult.passed : undefined,
              constraints: constraintResult,
            }
            log.info("round 1 snapshot taken", {
              taskId: task.id,
              trialIndex,
              passCount: testResult.passed.length,
              failCount: testResult.failed.length,
            })
          } catch (err) {
            log.error("round 1 snapshot failed", {
              taskId: task.id,
              trialIndex,
              error: err instanceof Error ? err.message : String(err),
            })
          }
        }

        // Create the parent session (permissive, dual child agents still have
        // folder-separation per their own agent permissions)
        const parent = yield* sessions.create({
          title: `stress-dual:${task.id}:trial${trialIndex}`,
          permission: [{ permission: "*", pattern: "*", action: "allow" }] satisfies Permission.Ruleset,
        })

        const runResult = yield* dual
          .run({
            parentSessionID: parent.id,
            task: task.task,
            model: options?.model,
            maxRounds: task.maxRounds ?? 5,
            phaseTimeoutMs: options?.phaseTimeoutMs ?? task.phaseTimeoutMs ?? 240_000,
            onRoundComplete,
            testCmd: task.testsCmd,
            studentPermission: task.studentPermission,
          })
          .pipe(
            Effect.catchCause((cause) =>
              Effect.sync(() => {
                log.error("dual trial error", {
                  taskId: task.id,
                  trialIndex,
                  error: String(Cause.squash(cause)),
                })
                return undefined
              }),
            ),
          )

        // Final snapshot — ALWAYS taken, even on partial runs
        const finalTests = yield* Effect.promise(() => runTests(workdir, task.testsCmd))
        const finalConstraints = yield* Effect.promise(() =>
          evaluateConstraints(workdir, task.constraints),
        )

        const testsError = testError(finalTests)
        const testsAvailable = !testsError
        const total = testsAvailable ? finalTests.passed.length + finalTests.failed.length : 0
        const recurrenceInfo = testsAvailable
          ? computeRecurrences(round1Snapshot?.testsPassed, finalTests.failed)
          : undefined
        const retention = computeRetention(round1Snapshot?.constraints, finalConstraints)

        return {
          mode: "dual" as const,
          trialIndex,
          testsAvailable,
          testsError,
          testsPassed: testsAvailable ? finalTests.passed.length : 0,
          testsFailed: testsAvailable ? finalTests.failed.length : 0,
          testsTotal: total,
          passRate: total > 0 ? finalTests.passed.length / total : undefined,
          constraintsAtEnd: finalConstraints,
          constraintsAtRound1: round1Snapshot?.constraints,
          constraintRetention: retention,
          round1Pass: round1Snapshot?.testsPassed,
          recurrences: recurrenceInfo?.recurrences,
          recurrenceRate: recurrenceInfo?.rate,
          durationMs: Date.now() - startedAt,
          rounds: runResult?.rounds ?? 0,
          finalStatus: runResult?.status ?? "error",
          costUsd: runResult?.totalCost,
        } satisfies TrialResult
      })

      /**
       * Run ONE trial in single-agent (build) mode. Same task text, same seed,
       * no Supervisor loop. Creates a session, calls SessionPrompt.prompt with
       * agent "build", waits for it to complete, then runs tests + constraints.
       *
       * No round-1 snapshot — single mode has only one "round". Retention and
       * recurrence are undefined.
       */
      const runSingleTrial = Effect.fn("SessionDualAgentStress.runSingleTrial")(function* (
        task: StressTask,
        trialIndex: number,
        options?: RunOptions,
      ) {
        const startedAt = Date.now()
        const ctx = yield* InstanceState.context
        const workdir = ctx.directory

        // Clean + seed BEFORE every trial so single mode never inherits state
        // from a preceding dual trial (or vice versa)
        yield* Effect.promise(() => cleanWorkdirAndSeed(workdir, task.seed))

        const session = yield* sessions.create({
          title: `stress-single:${task.id}:trial${trialIndex}`,
          permission: (task.studentPermission ??
            [{ permission: "*", pattern: "*", action: "allow" }]) satisfies Permission.Ruleset,
        })

        // Drive build agent directly. Apply a wall-clock timeout equal to
        // maxRounds × phaseTimeoutMs so single gets comparable total time to dual.
        // Without this, the build agent can loop internally forever.
        const singleTimeoutMs =
          (task.maxRounds ?? 5) * (options?.phaseTimeoutMs ?? task.phaseTimeoutMs ?? 240_000)
        yield* sessionPrompt
          .prompt({
            sessionID: session.id,
            agent: "build",
            model: options?.model,
            parts: [{ type: "text", text: task.task }],
          })
          .pipe(
            Effect.timeout(`${singleTimeoutMs} millis`),
            Effect.catchCause((cause) =>
              Effect.sync(() => {
                log.error("single trial error", {
                  taskId: task.id,
                  trialIndex,
                  error: String(Cause.squash(cause)),
                })
              }),
            ),
          )

        const finalTests = yield* Effect.promise(() => runTests(workdir, task.testsCmd))
        const finalConstraints = yield* Effect.promise(() =>
          evaluateConstraints(workdir, task.constraints),
        )

        // Compute cost from session messages (single mode has no Result.totalCost)
        const msgs = yield* sessions.messages({ sessionID: session.id })
        let costUsd = 0
        for (const m of msgs) {
          if (m.info.role === "assistant" && typeof m.info.cost === "number") {
            costUsd += m.info.cost
          }
        }

        const testsError = testError(finalTests)
        const testsAvailable = !testsError
        const total = testsAvailable ? finalTests.passed.length + finalTests.failed.length : 0
        return {
          mode: "single" as const,
          trialIndex,
          testsAvailable,
          testsError,
          testsPassed: testsAvailable ? finalTests.passed.length : 0,
          testsFailed: testsAvailable ? finalTests.failed.length : 0,
          testsTotal: total,
          passRate: total > 0 ? finalTests.passed.length / total : undefined,
          constraintsAtEnd: finalConstraints,
          constraintsAtRound1: undefined,
          constraintRetention: undefined,
          round1Pass: undefined,
          recurrences: undefined,
          recurrenceRate: undefined,
          durationMs: Date.now() - startedAt,
          rounds: 1,
          finalStatus: "single-agent",
          costUsd: costUsd > 0 ? costUsd : undefined,
        } satisfies TrialResult
      })

      /**
       * Run both modes `trials` times each. Yields a ComparisonReport with aggregates.
       * Trials run SEQUENTIALLY (not parallel) — each uses the ambient Instance's
       * workdir and would race over shared file state otherwise.
       *
       * Dual trials run first, then single. Between modes we clean the workdir.
       */
      const runComparison = Effect.fn("SessionDualAgentStress.runComparison")(function* (
        task: StressTask,
        options?: RunOptions,
      ) {
        const trials = options?.trials ?? task.trialCount ?? 3
        log.info("comparison start", {
          taskId: task.id,
          trials,
        })

        const dualTrials: TrialResult[] = []
        for (let i = 0; i < trials; i++) {
          const r = yield* runDualTrial(task, i, options)
          dualTrials.push(r)
          log.info("dual trial done", {
            taskId: task.id,
            trialIndex: i,
            passRate: r.passRate,
            rounds: r.rounds,
          })
        }

        const singleTrials: TrialResult[] = []
        for (let i = 0; i < trials; i++) {
          const r = yield* runSingleTrial(task, i, options)
          singleTrials.push(r)
          log.info("single trial done", {
            taskId: task.id,
            trialIndex: i,
            passRate: r.passRate,
          })
        }

        const dualAgg = aggregate(dualTrials)
        const singleAgg = aggregate(singleTrials)

        return {
          taskId: task.id,
          trialCount: trials,
          dual: dualAgg,
          single: singleAgg,
          dualTrials,
          singleTrials,
        } satisfies ComparisonReport
      })

      return Service.of({ runComparison })
    }),
  )

  /** Aggregate a list of trials into AggregateMetrics. */
  function aggregate(trials: TrialResult[]): AggregateMetrics {
    if (trials.length === 0) {
      return {
        meanPassRate: undefined,
        passRateRange: undefined,
        testedTrials: 0,
        unavailableTrials: 0,
        meanConstraintRetention: undefined,
        meanRecurrenceRate: undefined,
        totalDurationMs: 0,
        totalCostUsd: undefined,
      }
    }
    const tested = trials.filter((t) => t.testsAvailable)
    const rates = tested.map((t) => t.passRate).filter((x): x is number => x !== undefined)
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    const retentionValues = trials
      .map((t) => t.constraintRetention)
      .filter((x): x is number => x !== undefined)
    const recurrenceValues = trials
      .map((t) => t.recurrenceRate)
      .filter((x): x is number => x !== undefined)
    const costValues = trials.map((t) => t.costUsd).filter((x): x is number => x !== undefined)
    return {
      meanPassRate: rates.length > 0 ? mean(rates) : undefined,
      passRateRange: rates.length > 0 ? [Math.min(...rates), Math.max(...rates)] : undefined,
      testedTrials: tested.length,
      unavailableTrials: trials.length - tested.length,
      meanConstraintRetention: retentionValues.length > 0 ? mean(retentionValues) : undefined,
      meanRecurrenceRate: recurrenceValues.length > 0 ? mean(recurrenceValues) : undefined,
      totalDurationMs: trials.reduce((s, t) => s + t.durationMs, 0),
      totalCostUsd: costValues.length > 0 ? costValues.reduce((a, b) => a + b, 0) : undefined,
    }
  }

  /**
   * Layer composition. The harness no longer subscribes to Bus directly (we use
   * the onRoundComplete hook instead), so we can use SessionDualAgent.defaultLayer
   * as-is. No Bus sharing required.
   */
  export const defaultLayer = Layer.suspend(() =>
    layer.pipe(
      Layer.provide(SessionDualAgent.defaultLayer),
      Layer.provide(SessionPrompt.defaultLayer),
      Layer.provide(Session.defaultLayer),
    ),
  )

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function runComparison(task: StressTask, options?: RunOptions) {
    return runPromise((svc) => svc.runComparison(task, options))
  }

  // ---------- Report formatting ----------

  export function formatReport(report: ComparisonReport): string {
    const lines: string[] = []
    const pct = (n: number | undefined) => (n === undefined ? "  N/A " : `${(n * 100).toFixed(1)}%`)
    const ms = (n: number) => `${(n / 1000).toFixed(1)}s`
    const n_a = (x: number | undefined) => (x === undefined ? "  N/A " : pct(x))
    const usd = (x: number | undefined) => (x === undefined ? "N/A" : `$${x.toFixed(4)}`)

    lines.push(`── stress comparison: ${report.taskId} ──`)
    lines.push(`trials per mode: ${report.trialCount}`)
    lines.push("")
    lines.push(
      `  DUAL    pass ${pct(report.dual.meanPassRate).padStart(7)}  [${report.dual.passRateRange ? `${pct(report.dual.passRateRange[0])}..${pct(report.dual.passRateRange[1])}` : "N/A"}]`,
    )
    lines.push(`          test trials ${report.dual.testedTrials}/${report.trialCount} available`)
    if (report.dual.unavailableTrials > 0) {
      lines.push(`          unavailable ${report.dual.unavailableTrials}`)
    }
    lines.push(`          retention  ${n_a(report.dual.meanConstraintRetention).padStart(7)}`)
    lines.push(`          recurrence ${n_a(report.dual.meanRecurrenceRate).padStart(7)}`)
    lines.push(`          total time ${ms(report.dual.totalDurationMs)}`)
    lines.push(`          total cost ${usd(report.dual.totalCostUsd)}`)
    lines.push("")
    lines.push(
      `  SINGLE  pass ${pct(report.single.meanPassRate).padStart(7)}  [${report.single.passRateRange ? `${pct(report.single.passRateRange[0])}..${pct(report.single.passRateRange[1])}` : "N/A"}]`,
    )
    lines.push(`          test trials ${report.single.testedTrials}/${report.trialCount} available`)
    if (report.single.unavailableTrials > 0) {
      lines.push(`          unavailable ${report.single.unavailableTrials}`)
    }
    lines.push(`          retention  ${n_a(report.single.meanConstraintRetention).padStart(7)}`)
    lines.push(`          recurrence ${n_a(report.single.meanRecurrenceRate).padStart(7)}`)
    lines.push(`          total time ${ms(report.single.totalDurationMs)}`)
    lines.push(`          total cost ${usd(report.single.totalCostUsd)}`)
    lines.push("")
    const delta =
      report.dual.meanPassRate !== undefined && report.single.meanPassRate !== undefined
        ? (report.dual.meanPassRate - report.single.meanPassRate) * 100
        : undefined
    const deltaStr = delta === undefined ? "N/A" : delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)
    lines.push(`  delta (dual - single):`)
    lines.push(`    pass rate   ${deltaStr} percentage points`)
    if (report.dual.totalDurationMs > 0 && report.single.totalDurationMs > 0) {
      const speedup = report.single.totalDurationMs / report.dual.totalDurationMs
      lines.push(`    time ratio  ${speedup.toFixed(1)}× (single/dual)`)
    }
    if (report.dual.totalCostUsd != null && report.single.totalCostUsd != null && report.dual.totalCostUsd > 0) {
      const costRatio = report.single.totalCostUsd / report.dual.totalCostUsd
      lines.push(`    cost ratio  ${costRatio.toFixed(1)}× (single/dual)`)
    }
    lines.push("")
    lines.push(`per-trial detail:`)
    for (const t of report.dualTrials) {
      lines.push(
        `  dual[${t.trialIndex}]   ${t.testsAvailable ? `${t.testsPassed}/${t.testsTotal} (${pct(t.passRate)})` : `tests unavailable${t.testsError ? `: ${t.testsError}` : ""}`}  rounds=${t.rounds}  retention=${n_a(t.constraintRetention)}  recur=${n_a(t.recurrenceRate)}  ${ms(t.durationMs)}  ${usd(t.costUsd)}  status=${t.finalStatus}`,
      )
    }
    for (const t of report.singleTrials) {
      lines.push(
        `  single[${t.trialIndex}] ${t.testsAvailable ? `${t.testsPassed}/${t.testsTotal} (${pct(t.passRate)})` : `tests unavailable${t.testsError ? `: ${t.testsError}` : ""}`}  ${ms(t.durationMs)}  ${usd(t.costUsd)}`,
      )
    }
    return lines.join("\n")
  }

}

// Canonical stress tasks are exported from a sibling module so this file stays
// focused on harness mechanics. Re-export here for ergonomic access:
//   import { SessionDualAgentStress, CANONICAL_STRESS_TASKS } from "./dual-agent-stress"
export { CANONICAL_STRESS_TASKS } from "./dual-agent-stress-tasks"
