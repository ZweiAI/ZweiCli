import type { Argv } from "yargs"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"

// Auto-upgrade is disabled in this fork. Upstream opencode's Installation
// service checks opencode-ai on npm / opencode on brew+choco+scoop +
// anomalyco/opencode on GitHub, none of which are relevant to Zwei. The
// command is kept so `zwei upgrade` doesn't 404, but it just prints the
// manual-install path.
export const UpgradeCommand = {
  command: "upgrade [target]",
  describe: "show manual install instructions (auto-upgrade is disabled in this fork)",
  builder: (yargs: Argv) => {
    return yargs
      .positional("target", { type: "string", describe: "ignored" })
      .option("method", {
        alias: "m",
        type: "string",
        describe: "ignored",
        choices: ["curl", "npm", "pnpm", "bun", "brew", "choco", "scoop"],
      })
  },
  handler: async () => {
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    prompts.intro("Upgrade")
    prompts.log.warn(
      "Auto-upgrade is disabled in this fork to avoid pulling unrelated upstream opencode releases.",
    )
    prompts.log.info("To upgrade manually:")
    prompts.log.info("  npm install -g @zweicli/cli@latest")
    prompts.outro("Done")
  },
}
