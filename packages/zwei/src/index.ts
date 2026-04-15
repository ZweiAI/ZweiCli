import { hideBin } from "yargs/helpers"
import { VERSION } from "./installation/meta"

const args = hideBin(process.argv)

if (args.length === 1 && (args[0] === "-v" || args[0] === "--version")) {
  console.log(VERSION)
  process.exit(0)
}

if (args.includes("-h") || args.includes("--help")) {
  const { showHelpFast } = await import("./cli-help")
  if (showHelpFast(args)) process.exit(0)
}

await import("./cli-main")
