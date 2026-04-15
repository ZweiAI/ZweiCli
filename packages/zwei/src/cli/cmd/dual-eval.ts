import type { Argv } from "yargs"
import path from "path"
import z from "zod"
import { cmd } from "./cmd"
import { bootstrap, resolveWorkdir } from "../bootstrap"
import { UI } from "../ui"
import { SessionDualAgentEval } from "../../session/dual-agent-eval"
import { Provider } from "../../provider/provider"
import { Filesystem } from "../../util/filesystem"
import { EOL } from "os"

/**
 * `supervisor eval` — run the dual-agent eval harness.
 *
 * By default, runs the canonical task set (asymmetric memory, injection hardening,
 * budget enforcement, max-rounds, happy path, strict mode) against the configured
 * provider. Use `--tasks <file>` to load a custom JSON task set instead.
 *
 * Pair with `supervisor dual --events` when debugging individual tasks — the eval
 * report surfaces failures, but per-event telemetry is where you go to diagnose
 * "why did task X fail".
 */
export const DualEvalCommand = cmd({
  command: "eval",
  describe: "run the dual-agent eval harness against a curated task set",
  builder: (yargs: Argv) => {
    return yargs
      .option("tasks", {
        type: "string",
        describe:
          "path to a JSON file containing a Task[] array. If omitted, runs the built-in canonical task set.",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model in provider/model format (defaults to provider default)",
      })
      .option("category", {
        type: "string",
        array: true,
        describe:
          "filter tasks by category. Repeat to include multiple. Choices: smoke, asymmetry, injection, budget, max-rounds, strict",
      })
      .option("ids", {
        type: "string",
        array: true,
        describe: "filter to a specific set of task ids. Repeat to include multiple.",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "emit the full report as a single JSON object instead of a text table",
      })
      .option("fail-fast", {
        type: "boolean",
        default: false,
        describe: "stop at the first failing task instead of running the whole suite",
      })
      .option("workdir", {
        type: "string",
        describe:
          "explicit working directory for the eval run. Overrides ZWEI_WORKDIR and process.cwd(). Use this to run against a scratch dir instead of the directory where `bun run --cwd` happened to land.",
      })
      .option("phase-timeout-ms", {
        type: "number",
        describe:
          "wall-clock ceiling for a single student or supervisor phase across every task, in milliseconds. Safety valve against tool-call runaway loops. Forwarded to SessionDualAgent.Input.phaseTimeoutMs.",
      })
  },
  handler: async (args) => {
    const modelSpec = (() => {
      if (!args.model) return undefined
      const [providerID, ...rest] = args.model.split("/")
      if (!providerID || rest.length === 0) {
        UI.error(`Invalid --model "${args.model}". Expected "provider/model".`)
        process.exit(1)
      }
      return Provider.parseModel(args.model)
    })()

    let workdir: string
    try {
      workdir = resolveWorkdir(args.workdir)
    } catch (e) {
      UI.error(e instanceof Error ? e.message : String(e))
      process.exit(1)
    }

    await bootstrap(workdir, async () => {
      // Load tasks — either from --tasks <file> or the canonical set.
      let tasks: readonly SessionDualAgentEval.Task[]
      if (args.tasks) {
        const abs = path.resolve(process.cwd(), args.tasks)
        if (!(await Filesystem.exists(abs))) {
          UI.error(`--tasks file not found: ${abs}`)
          process.exit(1)
        }
        const raw = await Bun.file(abs).text()
        try {
          const parsed = JSON.parse(raw)
          tasks = z
            .array(SessionDualAgentEval.Task)
            .parse(parsed) as readonly SessionDualAgentEval.Task[]
        } catch (e) {
          UI.error(`failed to parse tasks file: ${e instanceof Error ? e.message : String(e)}`)
          process.exit(1)
        }
      } else {
        tasks = SessionDualAgentEval.CANONICAL_TASKS
      }

      // Apply filters. Empty filter = include everything.
      const catFilter = new Set((args.category ?? []) as string[])
      const idFilter = new Set((args.ids ?? []) as string[])
      const filtered = tasks.filter((t) => {
        if (catFilter.size > 0 && !catFilter.has(t.category)) return false
        if (idFilter.size > 0 && !idFilter.has(t.id)) return false
        return true
      })

      if (filtered.length === 0) {
        UI.error("no tasks match the given filters")
        process.exit(1)
      }

      if (!args.json) {
        UI.println(UI.Style.TEXT_INFO_BOLD + `running ${filtered.length} eval task(s)...`)
        UI.empty()
      }

      // Fail-fast: slice tasks until the first failure. We call `runSingle` per task so
      // we can inspect pass/fail as we go.
      const results: SessionDualAgentEval.TaskResult[] = []
      let totalCost = 0
      let totalDurationMs = 0
      for (const task of filtered) {
        const r = await SessionDualAgentEval.run([task], {
          model: modelSpec,
          phaseTimeoutMs: args.phaseTimeoutMs,
        })
        const tr = r.results[0]!
        results.push(tr)
        if (typeof tr.actual.totalCost === "number") totalCost += tr.actual.totalCost
        totalDurationMs += tr.actual.durationMs
        if (!tr.pass && args.failFast) break
      }

      const byCategory: Partial<
        Record<SessionDualAgentEval.Category, { passed: number; failed: number }>
      > = {}
      for (const r of results) {
        const b = byCategory[r.category] ?? { passed: 0, failed: 0 }
        if (r.pass) b.passed++
        else b.failed++
        byCategory[r.category] = b
      }
      const passed = results.filter((r) => r.pass).length
      const report: SessionDualAgentEval.Report = {
        total: results.length,
        passed,
        failed: results.length - passed,
        byCategory,
        totalCost,
        totalDurationMs,
        results,
      }

      if (args.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + EOL)
      } else {
        UI.println(SessionDualAgentEval.formatReport(report))
      }

      // Non-zero exit if any task failed — CI-friendly.
      if (report.failed > 0) process.exitCode = 1
    })
  },
})
