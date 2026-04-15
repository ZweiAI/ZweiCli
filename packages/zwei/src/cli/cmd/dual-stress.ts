import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap, resolveWorkdir } from "../bootstrap"
import { UI } from "../ui"
import { SessionDualAgentStress, CANONICAL_STRESS_TASKS } from "../../session/dual-agent-stress"
import { Provider } from "../../provider/provider"
import { EOL } from "os"

/**
 * `supervisor stress` — run the dual-agent comparison harness.
 *
 * Runs each stress task N trials × 2 modes (dual vs single) against a real provider
 * and reports aggregated metrics: pass rate, constraint retention, error recurrence
 * rate. Designed to measure whether the dual-agent architecture's feedback loop
 * extends Student's effective attention across multi-round tasks.
 *
 * Usage:
 *   supervisor stress                                    # run all canonical tasks
 *   supervisor stress --ids stress-stack-8methods        # just one task
 *   supervisor stress --trials 5 --workdir /tmp/scratch  # more trials, explicit workdir
 *   supervisor stress --json                             # machine-readable report
 *
 * Exit code 1 if dual did not outperform single on at least one of the three metrics
 * (pass rate, retention, recurrence) for at least one task.
 */
export const DualStressCommand = cmd({
  command: "stress",
  describe:
    "run the dual-agent long-range attention comparison harness (dual vs single, multi-trial)",
  builder: (yargs: Argv) => {
    return yargs
      .option("ids", {
        type: "string",
        array: true,
        describe:
          "filter to specific task ids. Repeat to include multiple. If omitted, runs all canonical stress tasks.",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model in provider/model format (defaults to provider default)",
      })
      .option("trials", {
        type: "number",
        default: 3,
        describe: "number of trials per mode per task. 3 is directional; 5+ for better variance signal.",
      })
      .option("workdir", {
        type: "string",
        describe:
          "explicit working directory. Overrides ZWEI_WORKDIR and process.cwd(). All trials within a task share this directory with clean-and-seed between trials.",
      })
      .option("phase-timeout-ms", {
        type: "number",
        default: 240000,
        describe:
          "per-phase wall-clock ceiling for dual mode, in milliseconds. Generous default (4 min/phase) to avoid penalizing dual for its inherently longer rounds.",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "emit the full report as JSON instead of a text summary",
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
      const idFilter = new Set((args.ids ?? []) as string[])
      const tasks = CANONICAL_STRESS_TASKS.filter((t) => {
        if (idFilter.size === 0) return true
        return idFilter.has(t.id)
      })

      if (tasks.length === 0) {
        UI.error("no stress tasks match the given filters")
        process.exit(1)
      }

      if (!args.json) {
        UI.println(
          UI.Style.TEXT_INFO_BOLD +
            `running ${tasks.length} stress task(s), ${args.trials} trials × 2 modes each ` +
            `= ${tasks.length * args.trials * 2} total LLM runs`,
        )
        UI.empty()
      }

      const reports: SessionDualAgentStress.ComparisonReport[] = []
      for (const task of tasks) {
        if (!args.json) {
          UI.println(UI.Style.TEXT_INFO_BOLD + `→ ${task.id}`)
        }
        const report = await SessionDualAgentStress.runComparison(task, {
          model: modelSpec,
          trials: args.trials,
          phaseTimeoutMs: args.phaseTimeoutMs,
        })
        reports.push(report)
        if (!args.json) {
          UI.println(SessionDualAgentStress.formatReport(report))
          UI.empty()
        }
      }

      if (args.json) {
        process.stdout.write(JSON.stringify(reports, null, 2) + EOL)
      }

      // Exit 1 if dual did NOT strictly improve over single on at least one metric
      // for at least one task. This is the CI-friendly signal: dual should give SOME
      // measurable benefit somewhere, or the whole architecture is a loss.
      const dualWonSomething = reports.some((r) => {
        if (
          r.dual.meanPassRate !== undefined &&
          r.single.meanPassRate !== undefined &&
          r.dual.meanPassRate > r.single.meanPassRate
        ) {
          return true
        }
        // Retention and recurrence are dual-only metrics — having ANY value means
        // dual exercised the feedback loop, which single couldn't.
        if (r.dual.meanConstraintRetention !== undefined && r.dual.meanConstraintRetention >= 0.9)
          return true
        return false
      })
      if (!dualWonSomething) process.exitCode = 1
    })
  },
})
