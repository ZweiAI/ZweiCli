#!/usr/bin/env bun

// Publishes the `zwei cli` meta-package + per-platform native packages to npm.
//
// Prerequisites:
//   1. `bun run script/build.ts`       (opencode native binaries)
//   2. `bun run script/build-zwei.ts`  (per-platform sub-packages with renamed bin)
//   3. NPM_TOKEN in env with publish access to the `zweicli` name and the
//      `@zweicli` scope.
//
// Version: derives from the first per-platform package's `version` field,
// set by `build.ts` via ZWEI_VERSION. If the meta-package version is
// supplied via ZWEI_VERSION that takes precedence.
//
// Tag: `latest` by default; set ZWEI_CHANNEL=beta (or similar) to publish
// under a pre-release dist-tag.

import { $ } from "bun"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const channel = process.env.ZWEI_CHANNEL || "latest"

const platformPkgs: Record<string, string> = {}
for (const filepath of new Bun.Glob("zwei-*/package.json").scanSync({ cwd: "./dist" })) {
  const entry = await Bun.file(`./dist/${filepath}`).json()
  platformPkgs[entry.name] = entry.version
}

if (Object.keys(platformPkgs).length === 0) {
  console.error(
    "publish-zwei: no dist/zwei-*/package.json found. Run build.ts + build-zwei.ts first.",
  )
  process.exit(1)
}

const version = process.env.ZWEI_VERSION || Object.values(platformPkgs)[0]
console.log(`publishing zweicli@${version} (tag: ${channel})`)
console.log("platform packages:", platformPkgs)

// --- Assemble the main `zweicli` meta-package ---
const metaDir = path.join("dist", "zwei")
await fs.promises.rm(metaDir, { recursive: true, force: true })
await fs.promises.mkdir(path.join(metaDir, "bin"), { recursive: true })

await fs.promises.copyFile(
  path.join("bin", "zwei"),
  path.join(metaDir, "bin", "zwei"),
)
if (process.platform !== "win32") {
  await fs.promises.chmod(path.join(metaDir, "bin", "zwei"), 0o755)
}

const licensePath = path.resolve("../../LICENSE")
if (fs.existsSync(licensePath)) {
  await fs.promises.copyFile(licensePath, path.join(metaDir, "LICENSE"))
}

const readmePath = path.resolve("../../README.md")
if (fs.existsSync(readmePath)) {
  await fs.promises.copyFile(readmePath, path.join(metaDir, "README.md"))
}

await Bun.file(path.join(metaDir, "package.json")).write(
  JSON.stringify(
    {
      name: "zweicli",
      version,
      description: "Dual-agent coding CLI. Student writes, Supervisor verifies. Fork of opencode.",
      bin: { zwei: "./bin/zwei" },
      optionalDependencies: platformPkgs,
      license: "MIT",
      repository: {
        type: "git",
        url: process.env.ZWEI_REPO || "https://github.com/ZweiAI/ZweiCli",
      },
    },
    null,
    2,
  ),
)

// --- Publish ---
// Publish platform packages first so the meta-package's optionalDependencies
// resolve when users install.
const dryRun = process.env.ZWEI_DRY_RUN === "1" ? ["--dry-run"] : []

for (const name of Object.keys(platformPkgs)) {
  const cwd = path.join("dist", name)
  if (process.platform !== "win32") {
    await $`chmod -R 755 .`.cwd(cwd).nothrow()
  }
  console.log(`publishing ${name}...`)
  await $`npm publish --access public --tag ${channel} ${dryRun}`.cwd(cwd)
}

console.log(`publishing zweicli (meta)...`)
await $`npm publish --access public --tag ${channel} ${dryRun}`.cwd(metaDir)

console.log("done.")
