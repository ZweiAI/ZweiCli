import path from "path"
import fs from "fs"
import { InstanceBootstrap } from "../project/bootstrap"
import { Instance } from "../project/instance"

export async function bootstrap<T>(directory: string, cb: () => Promise<T>) {
  return Instance.provide({
    directory,
    init: InstanceBootstrap,
    fn: async () => {
      try {
        const result = await cb()
        return result
      } finally {
        await Instance.dispose()
      }
    },
  })
}

/**
 * Resolve the working directory for a CLI subcommand, honoring (in order):
 *   1. An explicit `--workdir` argument (absolute or relative to process.cwd()).
 *   2. The `ZWEI_WORKDIR` environment variable.
 *   3. process.cwd() — the default.
 *
 * This exists because `bun run --cwd packages/zwei ... src/index.ts` forces the
 * node process's CWD to the zwei package dir. That means a user who does
 * `cd /tmp/scratch && supervisor eval` ends up with `process.cwd() === packages/zwei`
 * and all sessions land in the zwei repo instead of /tmp/scratch. The `--workdir`
 * flag + env var are the explicit opt-out from that behavior — if you set either,
 * the CLI treats the resolved path as the instance's working directory regardless of
 * where bun launched the process.
 *
 * Returns the resolved absolute path. Throws if the path does not exist or is not a
 * directory — callers should surface this via UI.error + process.exit.
 */
export function resolveWorkdir(explicit?: string): string {
  const raw = explicit ?? process.env.ZWEI_WORKDIR
  if (!raw) return process.cwd()
  const resolved = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw)
  let stat: fs.Stats
  try {
    stat = fs.statSync(resolved)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`workdir does not exist: ${resolved} (${msg})`)
  }
  if (!stat.isDirectory()) {
    throw new Error(`workdir is not a directory: ${resolved}`)
  }
  return resolved
}
