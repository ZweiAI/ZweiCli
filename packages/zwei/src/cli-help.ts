import { EOL } from "os"
import { UI } from "./cli/ui"
import { VERSION } from "./installation/meta"

function name() {
  return process.env.ZWEI_INVOKED ? "zwei" : "supervisor"
}

function out(text: string) {
  process.stderr.write(UI.logo() + EOL + EOL)
  process.stderr.write(text.trimStart() + EOL)
}

function root() {
  const bin = name()
  return `
${bin} [project]

Options:
  --help, -h       show help
  --version, -v    show version number
  --print-logs     print logs to stderr
  --log-level      log level
  --pure           run without external plugins

Commands:
  attach <url>         attach to a running opencode server
  acp                  agent client protocol tools
  mcp                  manage MCP servers
  run [message..]      run opencode with a message
  generate             generate output from a prompt
  debug                debugging utilities
  console              manage console accounts
  providers            manage AI providers and credentials
  agent                manage agents
  upgrade [target]     upgrade zwei
  uninstall            uninstall zwei
  serve                start the local server
  web                  web tooling
  models [provider]    list available models
  stats                show usage stats
  export [sessionID]   export session data
  import <file>        import session data
  github               manage GitHub agent
  pr <number>          work with a pull request
  session              manage sessions
  plugin <module>      manage plugins
  db                   database tools
  dual [task..]        run a Student ↔ Supervisor dual-agent loop against a task
  eval                 run the dual-agent eval harness against a curated task set
  stress               run the dual-agent long-range attention comparison harness
  task                 task utilities

${VERSION}
`
}

function runHelp() {
  const bin = name()
  return `
${bin} run [message..]

Options:
  --help, -h                          show help
  --command                           the command to run, use message for args
  --continue, -c                      continue the last session
  --session, -s                       session id to continue
  --fork                              fork the session before continuing
  --share                             share the session
  --model, -m                         model to use in the format of provider/model
  --agent                             agent to use
  --format                            default or json
  --file, -f                          file(s) to attach to message
  --title                             title for the session
  --attach                            attach to a running opencode server
  --password, -p                      basic auth password
  --dir                               directory to run in
  --port                              port for the local server
  --variant                           model variant
  --thinking                          show thinking blocks
  --dangerously-skip-permissions      auto-approve permissions that are not explicitly denied
`
}

function target(args: string[]) {
  const clean = args.filter((arg) => arg !== "--help" && arg !== "-h")
  if (clean.length === 0) return "root"
  if (clean[0] === "run") return "run"
  return undefined
}

export function showHelpFast(args: string[]) {
  const kind = target(args)
  if (kind === "root") {
    out(root())
    return true
  }
  if (kind === "run") {
    out(runHelp())
    return true
  }
  return false
}
