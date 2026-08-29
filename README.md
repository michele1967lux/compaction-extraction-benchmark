# Compaction extraction benchmark — two candidates, one task

Experimental artifacts from a coding benchmark. **Not software to use.**

Two coding agents were given the identical task: extract the conversation
compaction subsystem out of [`deepseek-harness`](https://github.com/deepseek-ai)
into a standalone, importable package with no framework dependencies — a
high-fidelity port, where a real source exists and fidelity to it is the point.

| | |
|---|---|
| `candidate-qwen38/` | Qwen3.8-27B via ds-harness on a Lucebox backend (AMD R9700) |
| `candidate-sonnet5/` | Claude Code (Sonnet 5), local instance |
| `judge/` | the independent evaluation |
| `TASK.md` | the task exactly as delivered, preserved verbatim in Italian |

## Result

**Sonnet 5: 87. Qwen3.8: 59.**

The judgment did not rely on either candidate's own test suite. The original
subsystem was reconstructed and **executed** against the same external harness
as both candidates, over 22 differential scenarios:

| | original | Sonnet 5 | Qwen3.8 |
|---|---:|---:|---:|
| scenarios passed | 22/22 | 22/22 | 21/22 |

Sonnet 5's event log for a canonical compaction is byte-identical to the
original's, modulo JSON key ordering.

Qwen3.8 showed three confirmed behavioural divergences, could not be imported
as shipped (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` — no build step, entry point
pointing at TypeScript), and its `PLAN.md` asserted five features that do not
exist in its `src/`.

Qwen3.8 was better in exactly one respect that matters: it kept an injection
point for the optional tool-result pruner, which Sonnet 5 dropped.

Full reasoning in [`judge/JUDGE-REPORT.md`](judge/JUDGE-REPORT.md).

## What has been removed, and what has not

`node_modules/`, build output (`lib/`), and caches are excluded — they are
reproducible from `package-lock.json`.

**Nothing produced by the models has been modified.** Source, tests, and the
governance documents (`PLAN.md`, `ROADMAP.md`, `PROGRAM_STATE.md`) are exactly
as delivered, including the claims the judge found to be false. Correcting them
would destroy the thing being measured.

The task specification is preserved in Italian, the language in which the
candidates received it. Translating it would create a prompt they never saw.

## Context

This benchmark is one of two. The other — a **greenfield** build rather than a
port — produced the opposite outcome for the same model:
[`qwen38-durable-job-queue-benchmark`](https://github.com/michele1967lux/qwen38-durable-job-queue-benchmark).

The two are **not comparable as scores**: this one measures two candidates
against each other on the same task, the other has a single candidate and an
absolute verdict. Analysis of what can and cannot be concluded from the pair is
in
[`real-world-local-llm-benchmarks`](https://github.com/michele1967lux/real-world-local-llm-benchmarks/blob/main/coding-agents/README.md).

## Licensing

Both candidates are derived works of `deepseek-harness`, which is **MIT**
licensed, Copyright (c) 2026 DeepSeek. The upstream license text is preserved
in [`LICENSE-UPSTREAM-MIT`](LICENSE-UPSTREAM-MIT) and governs the derived
source in `candidate-qwen38/` and `candidate-sonnet5/`.

The judge report and this README are CC BY 4.0.
