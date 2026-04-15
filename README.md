# Zwei CLI

<p align="right"><b>English</b> | <a href="./README.zh.md">简体中文</a></p>

> **Experimental** dual-agent coding tool. **PhD writes, Supervisor verifies.**
>
> A different take on how coding agents compose: two isolated minds, one codebase, asymmetric memory.
>
> Fork of [opencode](https://github.com/sst/opencode).
>
> _"Zwei" — German for "two"._

---

## Why

Most coding agents cram everything into a single context: read, write, run tests, grade, retry. As runs get longer, attention thins, test output drowns out intent, and the agent ends up grading its own homework.

Zwei borrows a pattern from academia: **PhD writes, Supervisor grades.** Two isolated sessions, two independent skill sets, one-way information flow at the boundary. The writer never peeks at the grader's reasoning — so it can't optimise against it.

## Core Ideas

- **Dual Attention** — two physically isolated sessions. The PhD focuses on writing; the Supervisor focuses on reviewing. Neither role burns attention on the other's job.
- **Independent Skills** — each role loads its own skill set. Nothing is shared by default — the PhD isn't distracted by review tooling, the Supervisor isn't tempted to reach in and edit.
- **Asymmetric Memory** — the PhD never sees the Supervisor's reasoning; only a structured verdict crosses the boundary. The Supervisor sees the PhD's code and test output. Memory flows one way, by design.
- **Write / Test Separation** — the PhD has no `bash` and no read access to tests. Self-verification is physically impossible, and the writer's context stays clean — no tool traces, no test output, no file dumps polluting it.

The combined effect: the writer can't Goodhart the grader, and neither context contaminates the other.

## Install

### From source

```bash
git clone https://github.com/ZweiAI/ZweiCli
cd ZweiCli
bun install
bun run --cwd packages/zwei dev --help
```

### From npm (once published)

```bash
npm install -g @zweicli/cli
zwei --help
```

For everything outside the dual loop (auth, models, providers, sessions, web UI), upstream opencode conventions still apply. See [opencode.ai](https://opencode.ai).

## Status

Pre-1.0, experimental. Architecture and terminology may still shift. Issues and PRs are welcome — especially workload reports showing where dual wins or loses against single-agent baselines.

## License

MIT. See [LICENSE](./LICENSE) — the original opencode copyright is retained alongside ZweiAI's.
