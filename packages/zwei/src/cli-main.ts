import yargs, { type CommandModule } from "yargs"
import { hideBin } from "yargs/helpers"
import { Log } from "./util/log"
import { UI } from "./cli/ui"
import { NamedError } from "@zwei/util/error"
import { FormatError } from "./cli/error"
import { EOL } from "os"
import { VERSION, CHANNEL } from "./installation/meta"
import { errorMessage } from "./util/error"
import path from "path"

type Mod = CommandModule<object, object>
type Load = () => Promise<Mod>
const mod = (input: unknown) => input as Mod
const spec = (command: string, describe: string, aliases?: string[]) =>
  ({
    command,
    describe,
    ...(aliases ? { aliases } : {}),
    handler() {},
  }) as Mod

const tui: Load = () => import("./cli/cmd/tui/thread").then((x) => mod(x.TuiThreadCommand))
const attach: Load = () => import("./cli/cmd/tui/attach").then((x) => mod(x.AttachCommand))
const acp: Load = () => import("./cli/cmd/acp").then((x) => mod(x.AcpCommand))
const mcp: Load = () => import("./cli/cmd/mcp").then((x) => mod(x.McpCommand))
const run: Load = () => import("./cli/cmd/run").then((x) => mod(x.RunCommand))
const gen: Load = () => import("./cli/cmd/generate").then((x) => mod(x.GenerateCommand))
const debug: Load = () => import("./cli/cmd/debug").then((x) => mod(x.DebugCommand))
const consoleCmd: Load = () => import("./cli/cmd/account").then((x) => mod(x.ConsoleCommand))
const providers: Load = () => import("./cli/cmd/providers").then((x) => mod(x.ProvidersCommand))
const agent: Load = () => import("./cli/cmd/agent").then((x) => mod(x.AgentCommand))
const upgrade: Load = () => import("./cli/cmd/upgrade").then((x) => mod(x.UpgradeCommand))
const uninstall: Load = () => import("./cli/cmd/uninstall").then((x) => mod(x.UninstallCommand))
const serve: Load = () => import("./cli/cmd/serve").then((x) => mod(x.ServeCommand))
const web: Load = () => import("./cli/cmd/web").then((x) => mod(x.WebCommand))
const models: Load = () => import("./cli/cmd/models").then((x) => mod(x.ModelsCommand))
const stats: Load = () => import("./cli/cmd/stats").then((x) => mod(x.StatsCommand))
const exp: Load = () => import("./cli/cmd/export").then((x) => mod(x.ExportCommand))
const imp: Load = () => import("./cli/cmd/import").then((x) => mod(x.ImportCommand))
const github: Load = () => import("./cli/cmd/github").then((x) => mod(x.GithubCommand))
const pr: Load = () => import("./cli/cmd/pr").then((x) => mod(x.PrCommand))
const session: Load = () => import("./cli/cmd/session").then((x) => mod(x.SessionCommand))
const plug: Load = () => import("./cli/cmd/plug").then((x) => mod(x.PluginCommand))
const db: Load = () => import("./cli/cmd/db").then((x) => mod(x.DbCommand))
const dual: Load = () => import("./cli/cmd/dual").then((x) => mod(x.DualCommand))
const evalCmd: Load = () => import("./cli/cmd/dual-eval").then((x) => mod(x.DualEvalCommand))
const stress: Load = () => import("./cli/cmd/dual-stress").then((x) => mod(x.DualStressCommand))
const task: Load = () => import("./cli/cmd/task").then((x) => mod(x.TaskCommand))

const help = [
  spec("$0 [project]", "start opencode tui"),
  spec("attach <url>", "attach to a running opencode server"),
  spec("acp", "agent client protocol tools"),
  spec("mcp", "manage MCP servers"),
  spec("run [message..]", "run opencode with a message"),
  spec("generate", "generate output from a prompt"),
  spec("debug", "debugging utilities"),
  spec("console", "manage console accounts"),
  spec("providers", "manage AI providers and credentials", ["auth"]),
  spec("agent", "manage agents"),
  spec("upgrade [target]", "upgrade zwei"),
  spec("uninstall", "uninstall zwei"),
  spec("serve", "start the local server"),
  spec("web", "web tooling"),
  spec("models [provider]", "list available models"),
  spec("stats", "show usage stats"),
  spec("export [sessionID]", "export session data"),
  spec("import <file>", "import session data"),
  spec("github", "manage GitHub agent"),
  spec("pr <number>", "work with a pull request"),
  spec("session", "manage sessions"),
  spec("plugin <module>", "manage plugins"),
  spec("db", "database tools"),
  spec("dual [task..]", "run a Student ↔ Supervisor dual-agent loop against a task"),
  spec("eval", "run the dual-agent eval harness against a curated task set"),
  spec("stress", "run the dual-agent long-range attention comparison harness (dual vs single, multi-trial)"),
  spec("task", "task utilities"),
]

const root: Record<string, Load> = {
  acp,
  mcp,
  attach,
  run,
  generate: gen,
  debug,
  console: consoleCmd,
  providers,
  auth: providers,
  agent,
  upgrade,
  uninstall,
  serve,
  web,
  models,
  stats,
  export: exp,
  import: imp,
  github,
  pr,
  session,
  plugin: plug,
  db,
  dual,
  eval: evalCmd,
  stress,
  task,
}

function head(args: string[]) {
  let skip = false
  for (const arg of args) {
    if (skip) {
      skip = false
      continue
    }
    if (arg === "--") return undefined
    if (arg === "--log-level") {
      skip = true
      continue
    }
    if (arg.startsWith("--log-level=")) continue
    if (arg.startsWith("-")) continue
    return arg
  }
  return undefined
}

function cold(args: string[]) {
  if (args.length === 1 && (args[0] === "-v" || args[0] === "--version")) return true
  if (args.includes("-h") || args.includes("--help")) return true
  if (args[0] === "completion" || args.includes("--get-yargs-completions")) return true
  return false
}

async function all() {
  const list = [tui, ...new Set(Object.values(root))]
  return Promise.all(list.map((fn) => fn()))
}

async function pick(args: string[]) {
  const cmd = head(args)
  if (!cmd) {
    if (args.includes("-h") || args.includes("--help")) return help
    return [await tui()]
  }
  if (cmd === "completion" || args.includes("--get-yargs-completions")) return all()
  const load = root[cmd]
  if (!load) return all()
  return [await load()]
}

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", {
    e: errorMessage(e),
  })
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", {
    e: errorMessage(e),
  })
})

const args = hideBin(process.argv)

if (args.length === 1 && (args[0] === "-v" || args[0] === "--version")) {
  console.log(VERSION)
  process.exit(0)
}

function show(out: string) {
  const text = out.trimStart()
  if (!text.startsWith("supervisor ") && !text.startsWith("opencode ")) {
    process.stderr.write(UI.logo() + EOL + EOL)
    process.stderr.write(text)
    return
  }
  process.stderr.write(out)
}

// Pick the displayed CLI name based on the launcher that invoked us.
// `bin/zwei` sets ZWEI_INVOKED=1; everything else (legacy `opencode`, direct
// `bun src/index.ts`, or the CI scripts) keeps the historical "supervisor"
// scriptName so existing help / docs / shell completions don't shift under us.
const SCRIPT_NAME = process.env.ZWEI_INVOKED ? "zwei" : "supervisor"

const cli = yargs(args)
  .parserConfiguration({ "populate--": true })
  .scriptName(SCRIPT_NAME)
  .wrap(100)
  .help("help", "show help")
  .alias("help", "h")
  .version("version", "show version number", VERSION)
  .alias("version", "v")
  .option("print-logs", {
    describe: "print logs to stderr",
    type: "boolean",
  })
  .option("log-level", {
    describe: "log level",
    type: "string",
    choices: ["DEBUG", "INFO", "WARN", "ERROR"],
  })
  .option("pure", {
    describe: "run without external plugins",
    type: "boolean",
  })
  .middleware(async (opts) => {
    if (opts.pure) {
      process.env.ZWEI_PURE = "1"
    }
    if (cold(args)) return

    const [{ Heap }, { Filesystem }, { Global }, { JsonMigration }, { Database }, { drizzle }] = await Promise.all([
      import("./cli/heap"),
      import("./util/filesystem"),
      import("./global"),
      import("./storage/json-migration"),
      import("./storage/db"),
      import("drizzle-orm/bun-sqlite"),
    ])

    await Log.init({
      print: process.argv.includes("--print-logs"),
      dev: CHANNEL === "local",
      level: (() => {
        if (opts.logLevel) return opts.logLevel as Log.Level
        if (CHANNEL === "local") return "DEBUG"
        return "INFO"
      })(),
    })

    Heap.start()

    process.env.AGENT = "1"
    process.env.ZWEI = "1"
    process.env.ZWEI_PID = String(process.pid)

    Log.Default.info("zwei", {
      version: VERSION,
      args: process.argv.slice(2),
    })

    const marker = path.join(Global.Path.data, "zwei.db")
    if (!(await Filesystem.exists(marker))) {
      const tty = process.stderr.isTTY
      process.stderr.write("Performing one time database migration, may take a few minutes..." + EOL)
      const width = 36
      const orange = "\x1b[38;5;214m"
      const muted = "\x1b[0;2m"
      const reset = "\x1b[0m"
      let last = -1
      if (tty) process.stderr.write("\x1b[?25l")
      try {
        await JsonMigration.run(drizzle({ client: Database.Client().$client }), {
          progress: (event) => {
            const percent = Math.floor((event.current / event.total) * 100)
            if (percent === last && event.current !== event.total) return
            last = percent
            if (tty) {
              const fill = Math.round((percent / 100) * width)
              const bar = `${"■".repeat(fill)}${"･".repeat(width - fill)}`
              process.stderr.write(
                `\r${orange}${bar} ${percent.toString().padStart(3)}%${reset} ${muted}${event.label.padEnd(12)} ${event.current}/${event.total}${reset}`,
              )
              if (event.current === event.total) process.stderr.write("\n")
            } else {
              process.stderr.write(`sqlite-migration:${percent}${EOL}`)
            }
          },
        })
      } finally {
        if (tty) process.stderr.write("\x1b[?25h")
        else {
          process.stderr.write(`sqlite-migration:done${EOL}`)
        }
      }
      process.stderr.write("Database migration complete." + EOL)
    }
  })
  .usage(
    process.env.ZWEI_INVOKED
      ? "Zwei — dual-agent CLI (Student writes, Supervisor verifies). Fork of opencode."
      : "",
  )
  .completion("completion", "generate shell completion script")
  .fail((msg, err) => {
    if (
      msg?.startsWith("Unknown argument") ||
      msg?.startsWith("Not enough non-option arguments") ||
      msg?.startsWith("Invalid values:")
    ) {
      if (err) throw err
      cli.showHelp(show)
    }
    if (err) throw err
    process.exit(1)
  })
  .strict()

for (const item of await pick(args)) {
  cli.command(item)
}

try {
  if (args.includes("-h") || args.includes("--help")) {
    await cli.parse(args, (err: Error | undefined, _argv: unknown, out: string) => {
      if (err) throw err
      if (!out) return
      show(out)
    })
  } else {
    await cli.parse()
  }
} catch (e) {
  let data: Record<string, any> = {}
  if (e instanceof NamedError) {
    const obj = e.toObject()
    Object.assign(data, {
      ...obj.data,
    })
  }

  if (e instanceof Error) {
    Object.assign(data, {
      name: e.name,
      message: e.message,
      cause: e.cause?.toString(),
      stack: e.stack,
    })
  }

  if (e instanceof ResolveMessage) {
    Object.assign(data, {
      name: e.name,
      message: e.message,
      code: e.code,
      specifier: e.specifier,
      referrer: e.referrer,
      position: e.position,
      importKind: e.importKind,
    })
  }
  Log.Default.error("fatal", data)
  const formatted = FormatError(e)
  if (formatted) UI.error(formatted)
  if (formatted === undefined) {
    UI.error("Unexpected error, check log file at " + Log.file() + " for more details" + EOL)
    process.stderr.write(errorMessage(e) + EOL)
  }
  process.exitCode = 1
} finally {
  // Some subprocesses don't react properly to SIGTERM and similar signals.
  // Most notably, some docker-container-based MCP servers don't handle such signals unless
  // run using `docker run --init`.
  // Explicitly exit to avoid any hanging subprocesses.
  process.exit()
}
