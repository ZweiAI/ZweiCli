import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap, resolveWorkdir } from "../bootstrap"
import { UI } from "../ui"
import { Session } from "../../session"
import { SessionDualAgent, Event as DualEvent } from "../../session/dual-agent"
import { Provider } from "../../provider/provider"
import { Permission } from "../../permission"
import { Bus } from "../../bus"
import { EOL } from "os"

/**
 * `supervisor dual "<task>"` — drives the Student ↔ Supervisor loop.
 *
 * Thin CLI wrapper around `SessionDualAgent.run()`. Bootstraps an Instance against the
 * current working directory, creates a parent session, runs the loop, and prints a
 * linear transcript of everything that happened (the parent session's stamped
 * round headers + the real Student/Supervisor replies from the two child sessions).
 *
 * No live streaming — the orchestrator runs sequentially and only returns once both
 * agents have finished all rounds, so there is nothing to interleave. Printing after the
 * fact keeps this command under 150 lines and free of event-subscription plumbing.
 */
export const DualCommand = cmd({
  command: "dual [task..]",
  describe: "run a Student ↔ Supervisor dual-agent loop against a task",
  builder: (yargs: Argv) => {
    return yargs
      .positional("task", {
        describe: "the task to hand to Student (and validate with Supervisor)",
        type: "string",
        array: true,
        default: [],
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe:
          "shared model in provider/model format used for both Student and Supervisor unless --student-model / --supervisor-model overrides it (defaults to provider default)",
      })
      .option("student-model", {
        type: "string",
        describe:
          "model for the Student agent in provider/model format. Overrides --model for Student only. Use to put Student on a cheaper/faster writer while Supervisor stays on a stronger reviewer.",
      })
      .option("supervisor-model", {
        type: "string",
        describe:
          "model for the Supervisor agent in provider/model format. Overrides --model for Supervisor only.",
      })
      .option("max-rounds", {
        type: "number",
        default: 5,
        describe: "maximum Student↔Supervisor rounds before giving up",
      })
      .option("mode", {
        type: "string",
        choices: ["fast", "strict", "auto"] as const,
        default: "fast",
        describe:
          "fast: phd implements, supervisor verifies. strict: round-0 plan-first review, then checkpointed execution. auto: phd first, supervisor only on complex/risky rounds.",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "emit the final result as a single JSON object instead of a summary",
      })
      .option("quiet", {
        type: "boolean",
        default: false,
        describe: "suppress the transcript, print only the final summary",
      })
      .option("max-usd", {
        type: "number",
        describe:
          "hard budget ceiling in USD. The run aborts with status=budget_exceeded as soon as accumulated cost across both child sessions reaches this value. Use this in production.",
      })
      .option("warn-usd", {
        type: "number",
        describe: "soft budget threshold in USD. Logs a warning when breached but does not abort.",
      })
      .option("events", {
        type: "boolean",
        default: false,
        describe:
          "stream NDJSON telemetry events to stdout as they happen. One JSON object per line, one line per event. Pipe to jq to watch rounds, retries, budget checks, verdicts live. Compatible with --json (both fire).",
      })
      .option("workdir", {
        type: "string",
        describe:
          "explicit working directory for the run. Overrides ZWEI_WORKDIR and process.cwd(). Use this to isolate a dual run into a scratch directory — without it, `bun run --cwd packages/zwei` forces the process cwd to the zwei repo and sessions will leak into it.",
      })
      .option("phase-timeout-ms", {
        type: "number",
        describe:
          "wall-clock ceiling for a single student or supervisor phase, in milliseconds. Aborts the phase on timeout and proceeds to the next round. Production safety valve against tool-call runaway loops.",
      })
      .option("test-cmd", {
        type: "string",
        describe:
          "command to run in the workdir after each student round. Exit 0 auto-passes the run and skips the supervisor call.",
      })
  },
  handler: async (args) => {
    const task = (args.task as string[]).join(" ").trim()
    if (!task) {
      UI.error("You must provide a task. Example: supervisor dual 'implement gcd and add tests'")
      process.exit(1)
    }

    // Parse a --model-style flag. Bails the process on bad shape so the caller can
    // assume the return value is a valid spec or undefined.
    const parseSpec = (raw: string | undefined, flag: string) => {
      if (!raw) return undefined
      const [providerID, ...rest] = raw.split("/")
      if (!providerID || rest.length === 0) {
        UI.error(`Invalid --${flag} "${raw}". Expected "provider/model".`)
        process.exit(1)
      }
      return Provider.parseModel(raw)
    }
    const modelSpec = parseSpec(args.model, "model")
    const studentSpec = parseSpec(args.studentModel, "student-model")
    const supervisorSpec = parseSpec(args.supervisorModel, "supervisor-model")

    let workdir: string
    try {
      workdir = resolveWorkdir(args.workdir)
    } catch (e) {
      UI.error(e instanceof Error ? e.message : String(e))
      process.exit(1)
    }

    await bootstrap(workdir, async () => {
      const parent = await Session.create({
        title: `dual: ${task.slice(0, 50)}${task.length > 50 ? "…" : ""}`,
        permission: [{ permission: "*", pattern: "*", action: "allow" }] satisfies Permission.Ruleset,
      })

      const budget =
        args.maxUsd !== undefined || args.warnUsd !== undefined
          ? {
              ...(args.maxUsd !== undefined ? { maxUsd: args.maxUsd } : {}),
              ...(args.warnUsd !== undefined ? { warnUsd: args.warnUsd } : {}),
            }
          : undefined

      // Wire up NDJSON event streaming if --events was set. Each of the 8 telemetry
      // events becomes a line of JSON on stdout with a `type` discriminator.
      // Subscribers are registered BEFORE the run starts and disposed AFTER it ends so
      // no event is missed.
      const unsubscribers: Array<() => void> = []
      if (args.events) {
        const emit = (type: string, properties: unknown) => {
          process.stdout.write(JSON.stringify({ type, ...(properties as object) }) + EOL)
        }
        for (const def of DualEvent.all) {
          unsubscribers.push(Bus.subscribe(def, (evt) => emit(def.type, evt.properties)))
        }
      }

      let result
      try {
        result = await SessionDualAgent.run({
          parentSessionID: parent.id,
          task,
          model: modelSpec,
          studentModel: studentSpec,
          supervisorModel: supervisorSpec,
          maxRounds: args.maxRounds,
          mode: args.mode as "fast" | "strict" | "auto",
          budget,
          phaseTimeoutMs: args.phaseTimeoutMs,
          testCmd: args.testCmd,
        })
      } finally {
        for (const unsub of unsubscribers) {
          try {
            unsub()
          } catch {
            // Disposers that throw on double-unsubscribe are fine to ignore at this
            // point — we're tearing down regardless.
          }
        }
      }

      if (args.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + EOL)
        if (result.status !== "pass") process.exitCode = 1
        return
      }

      if (!args.quiet) {
        // Print the linear transcript by reading the parent session's stamps, then
        // interleaving each child session's assistant text for each round. The parent
        // session's synthetic user messages carry headers like [STUDENT · round N] /
        // [SUPERVISOR · round N] and the prompt we sent. The student/supervisor child
        // sessions each hold one assistant message per round. We walk them in order.
        await printTranscript(parent.id, result.studentSessionID, result.supervisorSessionID)
      }

      UI.empty()
      UI.println(UI.Style.TEXT_INFO_BOLD + "── dual-agent result ──")
      UI.println(`status:       ${result.status}`)
      UI.println(`rounds:       ${result.rounds}`)
      UI.println(`student:      ${result.studentSessionID}`)
      UI.println(`supervisor:   ${result.supervisorSessionID}`)
      if (typeof result.totalCost === "number") {
        UI.println(`total cost:   $${result.totalCost.toFixed(4)}`)
      }
      if (result.finalArtifact) {
        UI.empty()
        UI.println(UI.Style.TEXT_INFO_BOLD + "final artifact")
        UI.println(result.finalArtifact)
      }
      if (result.finalVerdict) {
        UI.empty()
        UI.println(UI.Style.TEXT_INFO_BOLD + "final verdict")
        UI.println(JSON.stringify(result.finalVerdict, null, 2))
      }
      if (result.lastError) {
        UI.empty()
        UI.println(UI.Style.TEXT_DANGER_BOLD + "last error: " + result.lastError)
      }

      if (result.status !== "pass") process.exitCode = 1
    })
  },
})

// Walk the three sessions and print them as one linear transcript:
// - Parent session yields [STUDENT · N] / [SUPERVISOR · N] synthetic stamps (prompts).
// - After each parent stamp, grab the corresponding assistant reply from the right child.
async function printTranscript(
  parentID: import("../../session/schema").SessionID,
  studentID: import("../../session/schema").SessionID,
  supervisorID: import("../../session/schema").SessionID,
) {
  const [parentMsgs, studentMsgs, supervisorMsgs] = await Promise.all([
    Session.messages({ sessionID: parentID }),
    Session.messages({ sessionID: studentID }),
    Session.messages({ sessionID: supervisorID }),
  ])
  const studentReplies = studentMsgs
    .filter((m) => m.info.role === "assistant")
    .map((m) => m.parts.filter((p) => p.type === "text" && !("synthetic" in p && p.synthetic)).map((p) => (p as { text: string }).text).join("\n").trim())
  const supervisorReplies = supervisorMsgs
    .filter((m) => m.info.role === "assistant")
    .map((m) => m.parts.filter((p) => p.type === "text" && !("synthetic" in p && p.synthetic)).map((p) => (p as { text: string }).text).join("\n").trim())
  let studentIdx = 0
  let supervisorIdx = 0
  for (const msg of parentMsgs) {
    if (msg.info.role !== "user") continue
    // parent user messages from the orchestrator stamp carry agent field "phd" or "supervisor"
    const agent = msg.info.agent
    if (agent !== "phd" && agent !== "supervisor") continue
    const headerPart = msg.parts.find((p) => p.type === "text")
    if (headerPart && headerPart.type === "text") {
      UI.empty()
      UI.println(UI.Style.TEXT_DIM + headerPart.text.split("\n")[0] + UI.Style.TEXT_NORMAL)
    }
    const reply =
      agent === "phd" ? studentReplies[studentIdx++] ?? "" : supervisorReplies[supervisorIdx++] ?? ""
    if (reply) UI.println(reply)
  }
}
