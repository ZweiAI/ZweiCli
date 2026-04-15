import { Config } from "effect"

function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

function falsy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "false" || value === "0"
}

export namespace Flag {
  export const OTEL_EXPORTER_OTLP_ENDPOINT = process.env["OTEL_EXPORTER_OTLP_ENDPOINT"]
  export const OTEL_EXPORTER_OTLP_HEADERS = process.env["OTEL_EXPORTER_OTLP_HEADERS"]

  export const ZWEI_AUTO_SHARE = truthy("ZWEI_AUTO_SHARE")
  export const ZWEI_AUTO_HEAP_SNAPSHOT = truthy("ZWEI_AUTO_HEAP_SNAPSHOT")
  export const ZWEI_GIT_BASH_PATH = process.env["ZWEI_GIT_BASH_PATH"]
  export const ZWEI_CONFIG = process.env["ZWEI_CONFIG"]
  export declare const ZWEI_PURE: boolean
  export declare const ZWEI_TUI_CONFIG: string | undefined
  export declare const ZWEI_CONFIG_DIR: string | undefined
  export declare const ZWEI_PLUGIN_META_FILE: string | undefined
  export const ZWEI_CONFIG_CONTENT = process.env["ZWEI_CONFIG_CONTENT"]
  export const ZWEI_DISABLE_AUTOUPDATE = truthy("ZWEI_DISABLE_AUTOUPDATE")
  export const ZWEI_ALWAYS_NOTIFY_UPDATE = truthy("ZWEI_ALWAYS_NOTIFY_UPDATE")
  export const ZWEI_DISABLE_PRUNE = truthy("ZWEI_DISABLE_PRUNE")
  export const ZWEI_DISABLE_TERMINAL_TITLE = truthy("ZWEI_DISABLE_TERMINAL_TITLE")
  export const ZWEI_SHOW_TTFD = truthy("ZWEI_SHOW_TTFD")
  export const ZWEI_PERMISSION = process.env["ZWEI_PERMISSION"]
  export const ZWEI_DISABLE_DEFAULT_PLUGINS = truthy("ZWEI_DISABLE_DEFAULT_PLUGINS")
  export const ZWEI_DISABLE_LSP_DOWNLOAD = truthy("ZWEI_DISABLE_LSP_DOWNLOAD")
  export const ZWEI_ENABLE_EXPERIMENTAL_MODELS = truthy("ZWEI_ENABLE_EXPERIMENTAL_MODELS")
  export const ZWEI_DISABLE_AUTOCOMPACT = truthy("ZWEI_DISABLE_AUTOCOMPACT")
  export const ZWEI_DISABLE_MODELS_FETCH = truthy("ZWEI_DISABLE_MODELS_FETCH")
  export const ZWEI_DISABLE_MOUSE = truthy("ZWEI_DISABLE_MOUSE")
  export const ZWEI_DISABLE_CLAUDE_CODE = truthy("ZWEI_DISABLE_CLAUDE_CODE")
  export const ZWEI_DISABLE_CLAUDE_CODE_PROMPT =
    ZWEI_DISABLE_CLAUDE_CODE || truthy("ZWEI_DISABLE_CLAUDE_CODE_PROMPT")
  export const ZWEI_DISABLE_CLAUDE_CODE_SKILLS =
    ZWEI_DISABLE_CLAUDE_CODE || truthy("ZWEI_DISABLE_CLAUDE_CODE_SKILLS")
  export const ZWEI_DISABLE_EXTERNAL_SKILLS =
    ZWEI_DISABLE_CLAUDE_CODE_SKILLS || truthy("ZWEI_DISABLE_EXTERNAL_SKILLS")
  export declare const ZWEI_DISABLE_PROJECT_CONFIG: boolean
  export const ZWEI_FAKE_VCS = process.env["ZWEI_FAKE_VCS"]
  export declare const ZWEI_CLIENT: string
  export const ZWEI_SERVER_PASSWORD = process.env["ZWEI_SERVER_PASSWORD"]
  export const ZWEI_SERVER_USERNAME = process.env["ZWEI_SERVER_USERNAME"]
  export const ZWEI_ENABLE_QUESTION_TOOL = truthy("ZWEI_ENABLE_QUESTION_TOOL")

  // Experimental
  export const ZWEI_EXPERIMENTAL = truthy("ZWEI_EXPERIMENTAL")
  export const ZWEI_EXPERIMENTAL_FILEWATCHER = Config.boolean("ZWEI_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  )
  export const ZWEI_EXPERIMENTAL_DISABLE_FILEWATCHER = Config.boolean(
    "ZWEI_EXPERIMENTAL_DISABLE_FILEWATCHER",
  ).pipe(Config.withDefault(false))
  export const ZWEI_EXPERIMENTAL_ICON_DISCOVERY =
    ZWEI_EXPERIMENTAL || truthy("ZWEI_EXPERIMENTAL_ICON_DISCOVERY")

  const copy = process.env["ZWEI_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
  export const ZWEI_EXPERIMENTAL_DISABLE_COPY_ON_SELECT =
    copy === undefined ? process.platform === "win32" : truthy("ZWEI_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const ZWEI_ENABLE_EXA =
    truthy("ZWEI_ENABLE_EXA") || ZWEI_EXPERIMENTAL || truthy("ZWEI_EXPERIMENTAL_EXA")
  export const ZWEI_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("ZWEI_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const ZWEI_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("ZWEI_EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  export const ZWEI_EXPERIMENTAL_OXFMT = ZWEI_EXPERIMENTAL || truthy("ZWEI_EXPERIMENTAL_OXFMT")
  export const ZWEI_EXPERIMENTAL_LSP_TY = truthy("ZWEI_EXPERIMENTAL_LSP_TY")
  export const ZWEI_EXPERIMENTAL_LSP_TOOL = ZWEI_EXPERIMENTAL || truthy("ZWEI_EXPERIMENTAL_LSP_TOOL")
  export const ZWEI_DISABLE_FILETIME_CHECK = Config.boolean("ZWEI_DISABLE_FILETIME_CHECK").pipe(
    Config.withDefault(false),
  )
  export const ZWEI_EXPERIMENTAL_PLAN_MODE = ZWEI_EXPERIMENTAL || truthy("ZWEI_EXPERIMENTAL_PLAN_MODE")
  export const ZWEI_EXPERIMENTAL_WORKSPACES = ZWEI_EXPERIMENTAL || truthy("ZWEI_EXPERIMENTAL_WORKSPACES")
  export const ZWEI_EXPERIMENTAL_MARKDOWN = !falsy("ZWEI_EXPERIMENTAL_MARKDOWN")
  export const ZWEI_MODELS_URL = process.env["ZWEI_MODELS_URL"]
  export const ZWEI_MODELS_PATH = process.env["ZWEI_MODELS_PATH"]
  export const ZWEI_DISABLE_EMBEDDED_WEB_UI = truthy("ZWEI_DISABLE_EMBEDDED_WEB_UI")
  export const ZWEI_DB = process.env["ZWEI_DB"]
  export const ZWEI_DISABLE_CHANNEL_DB = truthy("ZWEI_DISABLE_CHANNEL_DB")
  export const ZWEI_SKIP_MIGRATIONS = truthy("ZWEI_SKIP_MIGRATIONS")
  export const ZWEI_STRICT_CONFIG_DEPS = truthy("ZWEI_STRICT_CONFIG_DEPS")

  function number(key: string) {
    const value = process.env[key]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}

// Dynamic getter for ZWEI_DISABLE_PROJECT_CONFIG
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "ZWEI_DISABLE_PROJECT_CONFIG", {
  get() {
    return truthy("ZWEI_DISABLE_PROJECT_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for ZWEI_TUI_CONFIG
// This must be evaluated at access time, not module load time,
// because tests and external tooling may set this env var at runtime
Object.defineProperty(Flag, "ZWEI_TUI_CONFIG", {
  get() {
    return process.env["ZWEI_TUI_CONFIG"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for ZWEI_CONFIG_DIR
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "ZWEI_CONFIG_DIR", {
  get() {
    return process.env["ZWEI_CONFIG_DIR"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for ZWEI_PURE
// This must be evaluated at access time, not module load time,
// because the CLI can set this flag at runtime
Object.defineProperty(Flag, "ZWEI_PURE", {
  get() {
    return truthy("ZWEI_PURE")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for ZWEI_PLUGIN_META_FILE
// This must be evaluated at access time, not module load time,
// because tests and external tooling may set this env var at runtime
Object.defineProperty(Flag, "ZWEI_PLUGIN_META_FILE", {
  get() {
    return process.env["ZWEI_PLUGIN_META_FILE"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for ZWEI_CLIENT
// This must be evaluated at access time, not module load time,
// because some commands override the client at runtime
Object.defineProperty(Flag, "ZWEI_CLIENT", {
  get() {
    return process.env["ZWEI_CLIENT"] ?? "cli"
  },
  enumerable: true,
  configurable: false,
})
