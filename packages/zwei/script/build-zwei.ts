#!/usr/bin/env bun

// Zwei post-build step. Consumes the existing opencode dist tree produced by
// `script/build.ts` (`dist/opencode-{platform}-{arch}[-suffix]/bin/opencode`)
// and materialises a parallel `dist/zwei-*` tree with:
//
//   - binary renamed from `opencode` -> `zwei` (`opencode.exe` -> `zwei.exe`)
//   - per-platform `package.json` naming it `@zweicli/{platform}-{arch}[-suffix]`
//     (on-disk directory stays `zwei-{platform}-{arch}` for simplicity)
//
// This preserves upstream mergeability — we never touch opencode's own build
// output, we just produce a sibling tree for npm publish under the @zweicli scope.
//
// Intended invocation order in CI:
//   1. bun run script/build.ts           (produces dist/opencode-*)
//   2. bun run script/build-zwei.ts      (produces dist/zwei-*)
//   3. bun run script/publish-zwei.ts    (npm publish each @zweicli/* + zweicli)

import { $ } from "bun"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const opencodePkgs: Array<{ name: string; version: string; os: string[]; cpu: string[] }> = []
for (const filepath of new Bun.Glob("opencode-*/package.json").scanSync({ cwd: "./dist" })) {
  const entry = await Bun.file(`./dist/${filepath}`).json()
  opencodePkgs.push(entry)
}

if (opencodePkgs.length === 0) {
  console.error(
    "build-zwei: no dist/opencode-*/package.json found. Run `bun run script/build.ts` first.",
  )
  process.exit(1)
}

for (const entry of opencodePkgs) {
  const dirName = entry.name.replace(/^opencode-/, "zwei-")
  const pkgName = entry.name.replace(/^opencode-/, "@zweicli/")
  const srcDir = path.join("dist", entry.name)
  const dstDir = path.join("dist", dirName)

  await fs.promises.rm(dstDir, { recursive: true, force: true })
  await fs.promises.mkdir(path.join(dstDir, "bin"), { recursive: true })

  const srcBinDir = path.join(srcDir, "bin")
  for (const file of await fs.promises.readdir(srcBinDir)) {
    const srcPath = path.join(srcBinDir, file)
    // Rename opencode -> zwei; keep everything else (.node helpers, etc.) as-is
    const dstFile =
      file === "opencode" ? "zwei" : file === "opencode.exe" ? "zwei.exe" : file
    const dstPath = path.join(dstDir, "bin", dstFile)
    const stat = await fs.promises.stat(srcPath)
    if (stat.isDirectory()) {
      await $`cp -r ${srcPath} ${dstPath}`
    } else {
      await fs.promises.copyFile(srcPath, dstPath)
      if (process.platform !== "win32") {
        await fs.promises.chmod(dstPath, 0o755)
      }
    }
  }

  await Bun.file(path.join(dstDir, "package.json")).write(
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
  console.log(`built ${pkgName} -> dist/${dirName} (from ${entry.name})`)
}
