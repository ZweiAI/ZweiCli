# Zwei CLI

<p align="right"><b>English</b> | <a href="./README.zh.md">简体中文</a> | <a href="./README.ja.md">日本語</a> | <a href="./README.de.md">Deutsch</a></p>

> **Experimental** dual-agent coding tool. **PhD writes, Supervisor verifies.**
>
> A different take on how coding agents compose: two isolated minds, one codebase, asymmetric memory.
>
> Fork of [opencode](https://github.com/sst/opencode).
>
> _"Zwei" — German for "two"._

<p align="center"><img src="./assets/welcome.png" alt="Zwei TUI welcome screen" width="720"></p>

---

## Why

Most coding agents cram everything into a single context: read, write, run tests, grade, retry. As runs get longer, attention thins, test output drowns out intent, and the agent ends up grading its own homework.

Zwei borrows a pattern from academia: **PhD writes, Supervisor grades.** Two isolated sessions, two independent skill sets, one-way information flow at the boundary. The writer never peeks at the grader's reasoning — so it can't optimise against it.

## The core bet

Zwei's premise is simple: split one coding agent into **two isolated roles** — the PhD writes, the Supervisor reviews — with information flowing **one way**. The writer never sees the grader's reasoning.

It targets a real failure mode: **a single agent's self-evaluation degrades over long conversations** (sometimes called "Goodharting" — grading your own homework and always getting an A).

A concrete example. Ask an agent to write a sort function and self-test it:

- **Single-agent mode:** it writes a buggy test, "passes" its own buggy test, declares victory.
- **Zwei's dual-agent mode:** the PhD writes the function but **cannot see the tests and has no `bash`**. The Supervisor independently reviews the code and runs the tests. Neither context contaminates the other.

This is an **architectural bet**: _role isolation + information asymmetry > single context doing everything_. The hypothesis is worth exploring — especially for complex, multi-step coding work. But today Zwei is best understood as **a promising experiment, not a validated tool**. If you care about agent architecture, it's worth a look. If you just want a daily-driver coding assistant, come back later.

## Core ideas

- **Dual attention** — two physically isolated sessions. The PhD focuses on writing; the Supervisor focuses on reviewing. Neither role burns attention on the other's job.
- **Independent skills** — each role loads its own skill set. Nothing is shared by default — the PhD isn't distracted by review tooling, the Supervisor isn't tempted to reach in and edit.
- **Asymmetric memory** — the PhD never sees the Supervisor's reasoning; only a structured verdict crosses the boundary. The Supervisor sees the PhD's code and test output. Memory flows one way, by design.
- **Write / test separation** — the PhD has no `bash` and no read access to tests. Self-verification is physically impossible, and the writer's context stays clean — no tool traces, no test output, no file dumps polluting it.

The combined effect: the writer can't Goodhart the grader, and neither context contaminates the other.

## Actor-critic — a substrate for self-improvement

Structurally, the PhD / Supervisor split is a classic **actor-critic** shape: the PhD acts, the Supervisor grades. That framing isn't cosmetic — it opens a loop a single-agent architecture can't close:

- **The critic's verdict is a natural training signal.** The Supervisor already emits structured pass/fail judgements with reasoning. Persist them and you get a labelled dataset of "where the agent fails and why" — with no human annotation step.
- **Information asymmetry keeps the signal honest.** Any reward a single agent produces by grading itself gets Goodharted. Zwei's isolation keeps the critic's judgement out of the actor's context, so the signal is cleaner and more suitable as a training target.
- **The loop can close without a human in it.** PhD writes → Supervisor grades → verdict persisted → periodic fine-tune or prompt evolution → the next PhD is a little sharper. Actor → environment → critic → actor, machine-to-machine.

None of this is wired up yet — pre-1.0, the focus is still inference. But the boundaries are already shaped for it: structured verdicts, persisted sessions, asymmetric memory. The long bet is a coding agent that **gets better with use**, not one frozen at whatever model version shipped.

## Install

### From source

```bash
git clone https://github.com/ZweiAI/ZweiCli
cd ZweiCli
bun install
bun run --cwd packages/zwei dev --help
```

### From npm

```bash
npm install -g @zweicli/cli
zwei --help
```

Auto-update is on by default and tracks `@zweicli/cli@latest` on npm. To manually bump: `zwei upgrade`, or `npm install -g @zweicli/cli@latest`.

For everything outside the dual loop (auth, models, providers, sessions, web UI), upstream opencode conventions still apply. See [opencode.ai](https://opencode.ai).

## Usage

Start the TUI:

```bash
zwei
```

### Slash commands

Once inside the TUI, type `/` at the prompt. The commands that matter for the dual-agent workflow:

| Command | Does what |
|---|---|
| `/agents` (or `/agent`) | Pick mode × role. See the mode table below |
| `/model` | Change model for **both** PhD and Supervisor |
| `/model1` | Change model for **PhD only** (the writer) |
| `/model2` | Change model for **Supervisor only** (the grader) |
| `/clear` | Wipe conversation in all three sessions (you + PhD + Supervisor) |
| `/clear1` | Wipe PhD's session only |
| `/clear2` | Wipe Supervisor's session only |

### `/agents` — pick a mode

The agents dialog shows six options — the product of three **modes** and two **roles**:

| Mode | What it does | When to use |
|---|---|---|
| **`dual`** | Every round, PhD writes then Supervisor reviews. Supervisor always runs | Long tasks, strict review, anti-Goodhart eval settings |
| **`auto`** | PhD writes first. If a test gate passes, Supervisor is skipped; otherwise invoked | Default — saves tokens when writer nails it on the first round |
| **`single`** | PhD only, no Supervisor. Equivalent to upstream opencode's single-agent flow | Tasks a strong model can one-shot — no point paying for review |

The **role** suffix (`fast` vs `plan`) picks the agent variant:

- **`fast`** — execution mode; the agent actually edits and runs
- **`plan`** — planning mode; read-only, produces a plan document before switching to fast

So `dual fast` means "PhD + Supervisor, both in execution mode", `auto plan` means "PhD plans first, Supervisor checks the plan on demand", etc.

### Different models for PhD and Supervisor

The whole point of the asymmetric split is that the writer can be cheap and the grader strong (or vice versa):

```
/model1   # pick a fast / cheap model for PhD (e.g. Haiku 4.5)
/model2   # pick a strong / picky model for Supervisor (e.g. Opus 4.6)
```

Switching models works mid-run too — the change lands on the next round, not the current one.

## Status

Pre-1.0, experimental. Architecture and terminology may still shift. Issues and PRs are welcome — especially workload reports showing where dual wins or loses against single-agent baselines.

## License

MIT. See [LICENSE](./LICENSE) — the original opencode copyright is retained alongside ZweiAI's.
