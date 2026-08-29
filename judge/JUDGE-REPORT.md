# Judge report — Blind comparison of two compaction extractions

- **Candidate A** = `extracted-compaction-sonnet5/`
- **Candidate B** = `extracted-compaction-rocm-qwen27b/`
- Original subsystem = `packages/compaction/{compaction,compaction-basic}/src/*` in `deepseek-harness`
- Judged on 2026-08-28/29 by direct inspection and execution. All commands below were actually run.

---

## 1. Verdict

**Candidate A wins.**

A is a near-verbatim port of the original subsystem and reproduces it exactly: in a 22-scenario differential run driven by one identical external harness, the original scores 22/22, A scores 22/22, and A's event log for a canonical compaction is byte-identical to the original's (modulo JSON key order). B scores 21/22 and shows three confirmed behavioral divergences — its rewritten `BlockAssembler` turns every non-text model block into an empty `text` block that then lands in the durable checkpoint and in the logged `rawOutput`; a stream that ends without a `finish` chunk throws instead of committing; and manual-compaction cancellation classification is inverted relative to the original. B also cannot be imported as shipped: it has no build step and its entry point is TypeScript containing parameter properties, so plain Node rejects it (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`), whereas A publishes a built `lib/` and resolves by package name. Finally, B's `PLAN.md` asserts fidelity that the code does not implement (max-token tool-call dropping, overflow retry counters, `replaceGeneration` comparison, `CONTEXT_WINDOW_EXCEEDED_CODE`, logger injection) — none of these exist in `src/`. B is better in exactly one respect that matters: it kept an injection point for the optional tool-result pruner, which A dropped.

---

## 2. Scorecard

| Category                   | Candidate A | Candidate B |
| -------------------------- | ----------: | ----------: |
| Functional correctness /30 |          27 |          18 |
| Independence /25           |          24 |          15 |
| Verification /15           |          10 |           9 |
| API/architecture /10       |           8 |           7 |
| Regression risk /10        |           9 |           6 |
| Documentation /5           |           4 |           2 |
| Engineering discipline /5  |           5 |           2 |
| **TOTAL /100**             |      **87** |      **59** |

---

## 3. Critical findings

### CRITICAL — B: the component cannot be imported as shipped (`extracted-compaction-rocm-qwen27b/package.json`)

`package.json` declares `"main": "./src/index.ts"`, `"exports": {".": "./src/index.ts"}`, has **no** `build` script, and `tsconfig.json` sets `"noEmit": true` with `module: esnext` / `moduleResolution: bundler`. Node cannot load it:

```
$ node -e "import('extracted-compaction')"     # via node_modules symlink
B FAIL: ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX
    TypeScript parameter property is not supported in strip-only mode
      at src/types.ts  ->  constructor(readonly code: ManualCompactionErrorCode, ...)
```

To execute B at all I had to compile it myself with flags that contradict its own tsconfig:
`npx tsc -p tsconfig.json --noEmit false --declaration false --outDir <ext> --module nodenext --moduleResolution nodenext --rewriteRelativeImportExtensions`.
A TS/bundler consumer can use B; a plain Node/JS consumer cannot. A, by contrast:

```
$ node -e "import('@extracted/dsh-compaction')"
A resolves via package name + exports map; exports: 35
```

### CRITICAL — B: non-text model output is corrupted into empty text blocks (`src/summarizer.ts`, class `BlockAssembler`)

B's assembler handles only `text-delta`; `reasoning-delta` and `tool-call-delta` fall through the `default: break`, and `block-end` unconditionally pushes `{ type:'text', text: currentText }` ignoring `chunk.block.type`. Measured (`probe19.mjs`, identical reasoning+text stream fed to all three):

```
ORIGINAL summary = [{"type":"text","text":"REAL-SUMMARY"}]
A        summary = [{"type":"text","text":"REAL-SUMMARY"}]
B        summary = [{"type":"text","text":""},{"type":"text","text":"REAL-SUMMARY"}]
```

The empty block is written into the durable replacement `user/message` content and into `compaction/summary.rawOutput`, so the "model-visible ⟺ logged" reconstructability the original documents is broken (the reasoning text is silently discarded rather than logged). The original's max-tokens rule — drop tool-call blocks when `finish.kind === 'max-tokens'` — is absent from B entirely, although `PLAN.md` D2 claims it is present.

### CRITICAL — B: `PLAN.md` divergence notes describe code that does not exist

- D2: "incluse le stesse regole di assemblaggio e il drop dei tool-call su `max-tokens`" — no such rule in `src/summarizer.ts`.
- D3: claims `stepPressureCheck` / `recoverFromOverflow` / `onAgentIdle` / `noteAssistantMessage` carry "contatori `overflowRetries`, reset su `assistant/message` e su status idle, confronto `replaceGeneration`, `CONTEXT_WINDOW_EXCEEDED_CODE`" and that "il metodo ritorna un oggetto decisione". Measured: `grep -rn "CONTEXT_WINDOW_EXCEEDED\|replaceGeneration\|overflowRetries\|logger" src` returns `replaceGeneration` only inside `tool-pairing.ts`, and `overflowRetries` only as a `WeakMap` that is **deleted from and never written to** (`src/engine.ts:45,256,263`). The two "wiring" methods are one-line delegations to `compactIfNeeded` returning `CompactionResult | null`. `maxOverflowRetries` is validated and carried but enforced nowhere.
- D4: claims `ctx.logger` → "optional `logger` nel dipendenze" — there is no logger anywhere in `src/`.

`PROGRAM_STATE.md` closes with "**TODO(governance):** nessuno aperto" and `grep -rn TODO src` returns nothing, while the above simplifications are live. A, by contrast, marks each of its three gaps with `// TODO(governance)` in `src/engine.ts` and repeats them in `PROGRAM_STATE.md`; every A claim I checked matched the code.

### MAJOR — B: manual-cancellation classification is inverted (`src/engine.ts:206`)

Original: agent-side cancellation → `ManualCompactionError('cancelled')`; caller-signal abort → the exact abort reason is preserved. B tests `if (signal.aborted)` instead of `agentSignal.aborted && operationSignal.reason === agentSignal.reason`, swapping the two. Measured (`cancel.mjs`):

```
ORIG agent-cancel  => ManualCompactionError code=cancelled
ORIG caller-cancel => Error  code=-  | CALLER-STOP
A    agent-cancel  => ManualCompactionError code=cancelled
A    caller-cancel => Error  code=-  | CALLER-STOP
B    agent-cancel  => Error  code=-  | AGENT-STOP        <-- diverges
B    caller-cancel => ManualCompactionError code=cancelled <-- diverges
```

B's own test `tests/engine.test.ts:148 "compactNow throws cancelled when aborted"` locks the divergent behavior in.

### MAJOR — B: a stream with no `finish` chunk fails instead of committing

`src/summarizer.ts:105` throws `summarization stream did not finish`; the original's `BlockAssembler.finish` getter defaults to `{ kind: 'stop' }`. Scenario S20: ORIGINAL commits, A commits, B throws.

### MAJOR — B: per-model summarization policy is ignored on an unrouted session (`src/engine.ts:71`)

`summarize()` resolves the policy from `session.requestHeader()?.config` only; the original uses `conversationTarget(agent)` = routed target **or** `agent.options`. Measured (`target.mjs`), with a `modelPolicies` entry that overrides the summarization target for `ap/am`:

```
ORIG policy-override(unrouted) => target cheap/mini
A    policy-override(unrouted) => target cheap/mini
B    policy-override(unrouted) => target ap/am        <-- override silently ignored
```

### MINOR — B: duplicated `frameSummary` implementation

`src/summarizer.ts:78` and `src/transaction.ts:522-535` both define `frameSummary` plus their own `CHECKPOINT_PREAMBLE` / `SUMMARY_OPEN_TAG` / `SUMMARY_CLOSE_TAG`. `index.ts` exports the summarizer copy; the transaction uses its private copy. The strings agree today; nothing keeps them in agreement.

### MINOR — A: the optional tool-result pruner has no injection point

`src/engine.ts:711` documents the omission as declared divergence #3, but where the original calls `prune.pruneSession(session)` and re-measures on both the overflow and pressure paths, A simply has no hook — a consumer cannot restore that behavior without subclassing. B does expose `pruneSession` in its constructor options with the original ordering intact. This is A's one substantive functional gap.

---

## 4. Behavioral-equivalence results

Method: one harness (`harness.mjs`) implementing the injected seams — an in-memory `ISession` (append-only log, replace-aware surface with `replaceGeneration`, `requestHeader()`, `deriveEventMessage()`), a token meter, and a scripted LLM — driving **the original, A and B through the same 22 scenarios** (`scenarios.mjs`). The original was executed by transpiling `packages/compaction/{compaction,compaction-basic}/src` unmodified, with only the *framework* specifiers stubbed (`@deepseek-ai/cordis` → `class Service{}`, `@deepseek-ai/schemastery` → chainable proxy) and `@deepseek-ai/dsh-llm` re-exporting the repo's own `never/error/types/content/message/brand/assembler/call-config` sources. No compaction logic was faked.

| # | Scenario | ORIGINAL | A | B |
| --- | --- | --- | --- | --- |
| S1 | below threshold → `null` | pass | pass | pass |
| S2 | above threshold compacts (start/summary/replace/end, checkpoint source, prefix reuse of system+tools, `purpose:'compaction'`, exactly one LLM call) | pass | pass | pass |
| S3 | repeated compaction / continuation, balanced start/end pairs | pass | pass | pass |
| S4 | unbalanced end boundary rejected | pass | pass | pass |
| S5 | balanced tool-call/result span compacted | pass | pass | pass |
| S6 | empty history → `null` | pass | pass | pass |
| S7 | unrouted session → `null` | pass | pass | pass |
| S8 | non-shrinking summary fails, `compaction/end` carries the error, no `compaction/summary` | pass | pass | pass |
| S9 | active-lock re-entry → `ManualCompactionError('busy')` | pass | pass | pass |
| S10 | `compactRegion` outside an open turn rejected | pass | pass | pass |
| S11 | manual `compactNow` commits, `turn:null`, `sourceCommandId`, flush once | pass | pass | pass |
| S12 | manual compaction with an open turn → `busy` | pass | pass | pass |
| S13 | `context-overflow` compacts below threshold | pass | pass | pass |
| S14 | pre-aborted manual request throws, no lock taken | pass | pass | pass |
| S15–S18 | config validation (unknown key, retain≥threshold, half-set summarization pair, duplicate model policy) | pass | pass | pass |
| S19 | reasoning+text summarizer stream | `[text]` | `[text]` | **`[text,text]` — empty block injected** |
| S20 | stream with no `finish` chunk | commits | commits | **throws** |
| S21 | error finish fails the transaction and records it | pass | pass | pass |
| S22 | public-export surface | pass | pass | pass |
| X1/X2 | cancellation classification (agent vs caller) | see §3 | matches | **inverted** |
| X3 | per-model summarization policy, unrouted | `cheap/mini` | `cheap/mini` | **`ap/am`** |
| — | **totals** | **22/22** | **22/22** | **21/22 + 3 divergences** |

Canonical-log diff (`diffcheck.mjs`, one user + assistant-with-tool-call + tool-result span compacted, ids/timestamps normalized): `diff dump-ORIG.json dump-A.json` and `diff dump-ORIG.json dump-B.json` both report **only JSON key-ordering differences** — for that single-text-block path all three produce the same events, same `surfaceOp: {op:'replace'}`, same `sourceEventSeqs`, same `shadowedRange` / `shadowedSeqs` / `shadowedTokenCount`, and the same framed checkpoint text.

Divergence classification:
- A: no behavioral divergence found. Its structural divergences (no Cordis auto-wiring, no pruner hook, `flush` moved onto `ManualCompactAgentContext`) are declared in `PLAN.md`/`PROGRAM_STATE.md` and marked in code. The missing auto-wiring is **intentional and unavoidable** (it is Cordis event-bus registration); the missing pruner hook is a **declared but real functional gap**.
- B: S19 and the `rawOutput` corruption are a **regression** (data written to the durable log differs from the original's). S20 is a **regression**. X1/X2 is a **regression** (a caller now cannot distinguish agent-cancellation from its own abort). X3 is a **regression**. The missing auto-wiring is intentional; the claim that its decision logic was preserved as callable methods is **unproven and contradicted by the code**.

---

## 5. Independence proof

Both candidates were checked for coupling by inspection first: `grep -rn "from '" src | grep -v "'\./"` returns only `node:crypto` and `node:util` for **both** — no `@deepseek-ai/*`, no Cordis, no repo-relative paths, no `process.cwd()`, no singleton bootstrap, no monkey patching, and no test fixture required at runtime. Both keep a module-level `WeakMap` keyed by session for the tool-pairing balance cache — that is the original's own design and is per-session, not process-global.

Execution proof was then run from **outside the repository tree** (`/tmp/.../scratchpad/consumer`), with the candidate reachable only through `node_modules`:

- **Candidate A — PASS (standalone).** `npx tsc` in the package emits `lib/`; `import('@extracted/dsh-compaction')` from plain Node 22.23.1 resolves through the package `exports` map and yields 35 exports; all 22 scenarios then execute against the real `BasicCompactionEngine` with only the harness's injected `ITokenMeter`/`ILlmService`/`ISession`. No ds-harness runtime bootstrap of any kind.
- **Candidate B — PARTIAL (extracted but not consumable as shipped).** Importing the package by name fails (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, see §3). After I compiled it myself with overridden compiler flags, `import('./b-lib/src/index.js')` yields 22 exports and 21/22 scenarios execute against the real engine. So: no hidden ds-harness coupling, but the "importable module" deliverable is only reachable through a build the candidate does not provide.

Both candidates require the consumer to implement `ISession` (append-only log + replace-aware surface + `requestHeader` + `deriveEventMessage`) themselves; neither ships a reference in-memory implementation. That is faithful to the original (which depends on the real `Session` class) but is the largest practical adoption cost for either.

---

## 6. Test evidence

```
$ cd extracted-compaction-sonnet5 && npx vitest run
  7 files, 60 tests passed, 0 failed, 0 skipped   (497 ms)
$ npx tsc --noEmit      -> clean
$ npx tsc               -> emits lib/ (build works)

$ cd extracted-compaction-rocm-qwen27b && npx vitest run
  11 files, 101 tests passed, 0 failed, 0 skipped  (317 ms)
$ npx tsc --noEmit      -> clean
  (no build script; tsconfig is noEmit)

$ node run-orig.mjs   -> ORIGINAL 22/22
$ node run-a.mjs      -> A        22/22
$ node run-b.mjs      -> B        21/22 (S20 fails)
$ node probe19.mjs / cancel.mjs / target.mjs / diffcheck.mjs  -> §3, §4
```

- **New tests:** A 60, B 101. Both are new; neither retains or ports the original packages' own test files, and neither ran the original suite (the repo has no `node_modules`, so `pnpm run test` is not executable here — **UNPROVEN** whether either would still pass upstream tests).
- **Do the tests exercise the real runtime?** Yes for both — both drive the real `compactSurfaceRegion`/engine against fake *dependencies* (session, meter, LLM), which is the correct seam. Exception: B's `tests/facade.test.ts` passes a hand-written stub object as the "engine", so those 4 tests verify only argument forwarding.
- **External-consumer / import test:** neither candidate has one. A's `tests/index.spec.ts` is the closest (imports the barrel and drives a full manual compaction through `CompactionFacade`), but it imports `src`, not the built `lib`, so nothing in either repo proves the published entry point works. That gap is exactly what let B ship an unloadable `main`.
- **Behavioral-equivalence tests:** neither candidate has any. All equivalence evidence in this report is mine.
- **Tests that mock away the boundary under evaluation:** B's facade tests (above). B's `tests/engine.test.ts:148` additionally encodes the inverted cancellation semantics as expected behavior.
- **Coverage gaps relevant to the verdict:** neither suite covers a reasoning/tool-call block in the summarizer stream (which is why B's assembler regression survived), a stream without a `finish` chunk, or the unrouted-plus-model-policy path.

---

## 7. Diff / architecture assessment

Blast radius on the host repository is **zero for both**: `git status` shows only untracked new directories; no tracked file in `packages/` was modified, and no original test was touched or deleted. (`packages/compaction/compaction-extracted/` is a pre-existing untracked artifact of a different exercise, unrelated to either candidate.)

**Candidate A** (~2,700 lines src + 900 tests). Layout follows the deliverable list exactly. `tool-pairing.ts` is byte-identical to `packages/compaction/compaction/src/tool-pairing.ts` except `Session` → `ISession`. `ranges.ts` is `selectCompactableRange` verbatim plus the source's private `validateSurfaceRegion` promoted and renamed `validateRangeSelection` (required by the task's file list) and reused by `transaction.ts` — no duplication. `transaction.ts` is `region.ts` verbatim minus the range selector. `engine.ts` consolidates the abstract seam + `types.ts` + `config.ts` + the concrete backend of the source into one file (also required by the task's file list); the schemastery `static Config` block is dropped with a written justification — every rule it declared is already enforced by the ported `assert*`/`validate*` functions, which I confirmed by running S15–S18. The `BlockAssembler` and `dsh-llm` value helpers are ported faithfully (assembly rules, max-tokens tool-call drop, `finish` defaulting all preserved). Dead-but-declared surface: `config.auto` and `maxOverflowRetries` are validated and carried but read by nothing, each carrying a `TODO(governance)` and a precise recipe for the consumer's own loop wiring.

**Candidate B** (~2,200 lines src + 1,200 tests). Same `tool-pairing.ts` fidelity. `types.ts` (520 lines) absorbs the seam vocabulary + config resolution; `session.ts` (708 lines) absorbs the LLM/session vocabulary. `transaction.ts` replaces the source's `RegionDependencies` object with three positional callback parameters (`summarize`, `measure`, `estimateMessage`), which is a gratuitous signature change and makes the public `compactSurfaceRegion` harder to call than the original. `ranges.ts` adds `undefined` guards that silently `continue`/`break`/`return null` where the original asserts — behaviorally inert on a well-formed surface, but it converts "corrupt surface" into "quietly compact nothing". Genuine duplication: `frameSummary` + its three constants exist twice. Genuine dead code: `overflowRetries` WeakMap plus `onAgentIdle`/`noteAssistantMessage`, and `stepPressureCheck`/`recoverFromOverflow` are trivial aliases. The rewritten `BlockAssembler` is the one place B replaced original logic with new logic rather than porting it, and it is where the regressions live.

---

## 8. Execution-efficiency comparison

No agent telemetry (turns, tool calls, token counts, retries, context growth) is available for either run — those fields are left blank rather than guessed. Only filesystem and log timestamps are measurable:

| Metric | Candidate A | Candidate B |
| --- | --- | --- |
| Wall-clock (TASK.md mtime → last artifact write) | ~57 min (22:39 → 23:36) | ~10 h 36 min (13:12 → 23:48) |
| Self-logged phases | not timestamped per phase | 7 phases, 11:26 → 23:40 UTC |
| Agent turns | — | — |
| Tool calls | — | — |
| Generated tokens | — | — |
| Retries / rework | 1 self-reported incident (a stray NUL byte in a generated file, caught by its own final re-read pass) | none self-reported |
| Failed commands/tests at delivery | none (60/60 green, typecheck+build clean) | none (101/101 green, typecheck clean; no build exists) |
| Human intervention | none observed | none observed |

B's self-logged UTC stamps start before its own `TASK.md` mtime, so the two clocks are not directly comparable; treat the wall-clock figures as approximate. B produced ~68% more tests in roughly 11× the wall-clock time and delivered the less faithful implementation — speed did not decide this comparison, and correctness was judged first regardless.

---

## 9. What Candidate A did better

- Exact behavioral parity with the original across all 22 differential scenarios plus the three targeted probes, with a byte-identical canonical event log.
- Ships an actually loadable artifact: `tsc` build, `exports` map, resolves by package name in plain Node.
- Faithful `BlockAssembler` port (reasoning/tool-call assembly, max-tokens tool-call drop, `finish` default) — no summarizer-output corruption.
- Correct manual-cancellation classification and correct `conversationTarget` policy resolution.
- No duplicated implementations; `validateRangeSelection` is the single shared definition for both selection and stability re-check.
- Honest, code-anchored governance: three declared divergences, each with a `TODO(governance)` at the exact call site, each verified true; the class doc-comment specifies precisely how a consumer must re-implement the missing pre-step/overflow wiring, including the `replaceGeneration` progress rule and retry-counter reset conditions.
- Documents each ported symbol's source file and why it moved, making the mapping back to `packages/compaction/` auditable.

## 10. What Candidate B did better

- Kept the optional tool-result pruner as an injected dependency (`pruneSession` in the constructor options), preserving the original's prune-then-remeasure ordering on both the overflow and pressure paths. A dropped this entirely — it is B's one clear functional advantage.
- Injects `flush` at construction time (matching the original's `ctx.sessions.flush` ownership) rather than moving it onto the agent context as A does.
- Broader unit coverage of the ported utility layer: 101 vs 60 tests, including `deepFreeze` cycles, `errorChain` chaining/AggregateError, brand identity, and an explicit `isCompactCheckpointSource` rejection matrix.
- Slightly smaller engine file and a config/type split that keeps `types.ts` importable without the engine.

## 11. Remaining risks

**Both:**
- No reference `ISession` implementation ships, so the first real consumer must write a correct replace-aware surface projection from scratch; getting `replaceGeneration` or `surfaceOp:'replace'` wrong silently breaks tool-pairing and range selection. A worked example belongs in the package.
- The original's automatic wiring (pre-step pressure, context-overflow retry with `replaceGeneration` progress check and `maxOverflowRetries`) exists in neither. Any consumer gets the decision logic but must build the policy loop; until then `auto` and `maxOverflowRetries` are inert configuration.
- Neither was validated against the upstream test suites (the repo has no installed dependencies here), so upstream regression status is **UNPROVEN**.
- No README or usage example in either; the only prose is Italian phase logs.

**A specifically:** the missing pruner hook is a real behavior gap versus the original whenever `toolResultPruner` is mounted; `config.auto`/`maxOverflowRetries` are accepted but do nothing, which will mislead a consumer who sets them.

**B specifically:** it cannot be published as-is (no build, TS-only entry); the assembler will corrupt any provider stream containing reasoning or tool-call blocks and pollute the durable log; the missing-`finish` and cancellation regressions are latent production failures; the `PLAN.md` fidelity claims must be corrected before anyone relies on them.

## 12. Merge recommendation

**Merge A after listed fixes**, taking one component from B.

1. Take B's pruner seam: add an optional `pruneSession(session): void` dependency to `BasicCompactionEngine` and restore the original's `if (prune !== undefined) { prune.pruneSession(...); measurement = meter.measure(...) }` on both the `context-overflow` and post-threshold pressure paths (source: `extracted-compaction-rocm-qwen27b/src/engine.ts:41-59,101-127`; target: `extracted-compaction-sonnet5/src/engine.ts:711-730`).
2. Consider B's constructor-injected `flush` in place of A's `ManualCompactAgentContext.flush`, to keep durability ownership where the original had it.
3. Add an external-consumer test that imports the **built** `lib/` entry point (not `src/`) and runs one full compaction — the check that would have caught B's unloadable `main`.
4. Ship a short README with a minimal `ISession` reference implementation and a wiring recipe for the pre-step/overflow policy loop.
5. Either implement the overflow retry policy or reject `auto`/`maxOverflowRetries` at config time instead of accepting inert values.

Do **not** merge B's `BlockAssembler`, `transaction.ts` callback signature, `compactNow` cancellation handling, `summarize` policy resolution, or its duplicated `frameSummary`.

---

### Reproduction

```
# harness + scenarios live in the judge scratchpad:
#   harness.mjs  scenarios.mjs  run-orig.mjs  run-a.mjs  run-b.mjs
#   probe19.mjs  cancel.mjs  target.mjs  diffcheck.mjs
cd extracted-compaction-sonnet5 && npx vitest run && npx tsc --noEmit && npx tsc
cd extracted-compaction-rocm-qwen27b && npx vitest run && npx tsc --noEmit
npx tsc -p <judge>/orig/tsconfig.json          # transpiles the untouched original
node run-orig.mjs && node run-a.mjs && node run-b.mjs
node probe19.mjs && node cancel.mjs && node target.mjs && node diffcheck.mjs
```
