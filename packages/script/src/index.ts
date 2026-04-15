import { $ } from "bun"
import semver from "semver"
import path from "path"

const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

// relax version requirement
const expectedBunVersionRange = `^${expectedBunVersion}`

if (!semver.satisfies(process.versions.bun, expectedBunVersionRange)) {
  throw new Error(`This script requires bun@${expectedBunVersionRange}, but you are using bun@${process.versions.bun}`)
}

const env = {
  ZWEI_CHANNEL: process.env["ZWEI_CHANNEL"],
  ZWEI_BUMP: process.env["ZWEI_BUMP"],
  ZWEI_VERSION: process.env["ZWEI_VERSION"],
  ZWEI_RELEASE: process.env["ZWEI_RELEASE"],
}
const CHANNEL = await (async () => {
  if (env.ZWEI_CHANNEL) return env.ZWEI_CHANNEL
  if (env.ZWEI_BUMP) return "latest"
  if (env.ZWEI_VERSION && !env.ZWEI_VERSION.startsWith("0.0.0-")) return "latest"
  return await $`git branch --show-current`.text().then((x) => x.trim())
})()
const IS_PREVIEW = CHANNEL !== "latest"

const VERSION = await (async () => {
  if (env.ZWEI_VERSION) return env.ZWEI_VERSION
  if (IS_PREVIEW) return `0.0.0-${CHANNEL}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
  const version = await fetch("https://registry.npmjs.org/opencode-ai/latest")
    .then((res) => {
      if (!res.ok) throw new Error(res.statusText)
      return res.json()
    })
    .then((data: any) => data.version)
  const [major, minor, patch] = version.split(".").map((x: string) => Number(x) || 0)
  const t = env.ZWEI_BUMP?.toLowerCase()
  if (t === "major") return `${major + 1}.0.0`
  if (t === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
})()

// Legacy upstream opencode concept: a curated team-members list loaded from
// .github/TEAM_MEMBERS for changelog attribution. The fork deleted that file
// in the Tier 1 cleanup and nothing reads Script.team, so this just surfaces
// the bot list. Keep the getter so any future caller doesn't break.
const team = ["actions-user", "opencode", "opencode-agent[bot]"]

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return VERSION
  },
  get preview() {
    return IS_PREVIEW
  },
  get release(): boolean {
    return !!env.ZWEI_RELEASE
  },
  get team() {
    return team
  },
}
console.log(`opencode script`, JSON.stringify(Script, null, 2))
