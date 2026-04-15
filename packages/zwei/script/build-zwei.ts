#!/usr/bin/env bun

// Zwei post-build step. `script/build.ts` already emits dist trees named
// `dist/zwei-{platform}-{arch}[-suffix]/bin/opencode` (pkg.name is "zwei",
// binary is still called `opencode` because that's the upstream compile
// target). This script transforms those in place:
//
//   - binary renamed from `opencode` -> `zwei` (`opencode.exe` -> `zwei.exe`)
//   - per-platform `package.json` rewritten: npm name becomes
//     `@zweicli/{platform}-{arch}[-suffix]`, description + license set.
//     (On-disk directory stays `zwei-{platform}-{arch}` for simplicity.)
//
// Intended invocation order in CI:
//   1. bun run script/build.ts           (emits dist/zwei-* with opencode binary)
//   2. bun run script/build-zwei.ts      (this file — renames binary, rewrites pkg.json)
//   3. bun run script/publish-zwei.ts    (npm publish each @zweicli/* + zweicli)

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const zweiPkgs: Array<{ dirName: string; name: string; version: string; os: string[]; cpu: string[] }> = []
for (const filepath of new Bun.Glob("zwei-*/package.json").scanSync({ cwd: "./dist" })) {
  const entry = await Bun.file(`./dist/${filepath}`).json()
  const dirName = path.dirname(filepath)
  zweiPkgs.push({ dirName, ...entry })
}

if (zweiPkgs.length === 0) {
  console.error(
    "build-zwei: no dist/zwei-*/package.json found. Run `bun run script/build.ts` first.",
  )
  process.exit(1)
}

for (const entry of zweiPkgs) {
  const pkgName = entry.dirName.replace(/^zwei-/, "@zweicli/")
  const binDir = path.join("dist", entry.dirName, "bin")

  for (const file of await fs.promises.readdir(binDir)) {
    if (file === "opencode" || file === "opencode.exe") {
      const srcPath = path.join(binDir, file)
      const dstPath = path.join(binDir, file === "opencode" ? "zwei" : "zwei.exe")
      await fs.promises.rename(srcPath, dstPath)
      if (process.platform !== "win32") {
        await fs.promises.chmod(dstPath, 0o755)
      }
    }
  }

  await Bun.file(path.join("dist", entry.dirName, "package.json")).write(
    JSON.stringify(
      {
        name: pkgName,
        version: entry.version,
        os: entry.os,
        cpu: entry.cpu,
        description: `Native binary for Zwei CLI on ${entry.os[0]}-${entry.cpu[0]}`,
        license: "MIT",
      },
      null,
      2,
    ),
  )
  console.log(`post-processed ${pkgName} (dist/${entry.dirName})`)
}
