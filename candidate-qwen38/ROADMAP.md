# ROADMAP — fasi di estrazione della compaction

Ogni fase si apre solo dopo che la precedente è annotata **completa** in
`PROGRAM_STATE.md`. Ogni fase chiude con checklist spuntata.

## Fase 0 — Governance

- [x] `PLAN.md` scritto
- [x] `ROADMAP.md` scritto
- [x] `PROGRAM_STATE.md` creato con voce iniziale

## Fase 1 — Fondamenta senza Cordis

Obiettivo: modulo compila sotto `strict` con zero dipendenze runtime.

File: `package.json`, `tsconfig.json`, `src/brand.ts`, `src/session.ts`.

- [x] `package.json`: `type: module`, zero `dependencies`, devDep
      `typescript` + `vitest` installati
- [x] `tsconfig.json`: `strict`, `verbatimModuleSyntax`, target es2024,
      `.ts` nelle import relative (riflette `tsconfig.base.json` del repo;
      il repo non impiega `erasableSyntaxOnly`)
- [x] `src/brand.ts`: `Branded`, `CompactionId`, `CommandId`, `SessionId`,
      `ToolCallId`, `MessageId` (port fedele di `dsh-brand` + brand specifici)
- [x] `src/session.ts`: vocab minimo `LLM` (ContentBlock/Message/StreamChunk/
      FinishReason/TokenUsage/ToolSchema/MessageSource/LlmFailure),
      `ISession` + `SessionEvent` (unione distributiva fedele a
      `dsh-session`) + `SurfaceOp`/`SurfaceIntent`/`ISessionSurface`,
      `ITokenMeter`/`TokenMeasurement`/`TokenSurfaceNode`,
      `ILLMClient`/`LlmRequest`/`LlmModelInfo`,
      `CompactionAgentContext`/`ManualCompactAgentContext`,
      util `deepFreeze`/`errorChain`/`contentHasImage`/`assertNever`/
      `createUserMessage` — tutti i campi usati dalla fonte studiata
- [x] Verifica: `tsc --noEmit` verde + `vitest run` 21/21 verde

## Fase 2 — Seam: vocab, checkpoint, tool-pairing

Obiettivo: vocabolario di compaction e due primitive pure, testate.

File: `src/types.ts`, `src/checkpoint.ts`, `src/tool-pairing.ts`,
`tests/tool-pairing.test.ts`, `tests/checkpoint.test.ts`,
`tests/types.test.ts`.

- [x] `types.ts`: `CompactionTrigger`, `ManualCompactionErrorCode`+
      `ManualCompactionError`, `CompactionResult`, `CompactionEventMap`
      (`compaction/start|summary|end|prune`), `CompactionEngine` astratta,
      vocab config + `resolveConfig`/`resolveTargetPolicy`/
      `resolveCompactSpec`/`TargetPressureConfigError` (porto fedele di
      `compaction-basic/config.ts` + `types.ts`)
- [x] `checkpoint.ts`: `compactCheckpointSource`,
      `isCompactCheckpointSource`, `CompactionCheckpointSource` (1:1)
- [x] `tool-pairing.ts`: `toolPairingBalancedBefore/After` + cache (1:1
      adattata a `ISession`)
- [x] Test: bilanciamento su surface mix tool-call/result, result orfana →
      throw, seq assente → throw, rebuild su replaceGeneration, predicate
      checkpoint, errori config (retainRatio ≥ thresholdRatio, summarize pair)
- [x] Verifica: `tsc --noEmit` + `vitest run` verdi

## Fase 3 — Range e transazione

Obiettivo: la transazione durabile start→summary→replace→end, testata su
session fake.

File: `src/ranges.ts`, `src/transaction.ts`, `tests/ranges.test.ts`,
`tests/transaction.test.ts`.

- [x] `ranges.ts`: `selectCompactableRange` + `validateRangeSelection`
      (port di `selectCompactableRange`/`validateSurfaceRegion`)
- [x] `transaction.ts`: `compactSurfaceRegion`, `assertNoActiveCompaction`,
      entry-state, stabilità (whole-surface / selected-span),
      `prepareCompaction`/`summarizeCompaction`/`commitCompactionBody`/
      `completeCompaction`, `throwManualFailure`
- [x] Test: ordine eventi + `surfaceOp: replace` + `sourceEventSeqs`;
      lock busy; stability violation → `changed`; shrink fallito;
      flush failure → `persistence`; aborted → segnale preservato
- [x] Verifica: `tsc --noEmit` + `vitest run` verdi

## Fase 4 — Summarizer

Obiettivo: summarization LLM end-to-end su client fake.

File: `src/summarizer.ts`, `tests/summarizer.test.ts`.

- [x] `summarizer.ts`: Costanti prompt/`frameSummary` (copie letterali),
      `SummarizationInput`/`SummaryResult`, `summarizeWithLlm` (adattato a
      `ILLMClient`), `finishError`/`summaryText`, port BlockAssembler
      minimale
- [x] Test: assemblaggio chunks→block, `max-tokens` → errore, `error`/
      `aborted` finish → throw, output image rifiutata, summary vuota →
      throw, frame tag, target config > last routed > options
- [x] Verifica: `tsc --noEmit` + `vitest run` verdi

## Fase 5 — Engine

Obiettivo: backend `BasicCompactionEngine` completo, testato.

File: `src/engine.ts`, `tests/engine.test.ts`.

- [x] `engine.ts`: `BasicCompactionEngine` (compactIfNeeded
      pressure+overflow, compactRegion, compactNow, `summarize` hook,
      `stepPressureCheck`/`recoverFromOverflow`/`onAgentIdle`/
      `noteAssistantMessage`, overflowRetries)
- [x] Test: sotto soglia → null; oltre soglia → compaction;
      `TargetPressureConfigError` senza contextWindow; `compactNow` senza
      range → null, busy su turn open, cancelled su abort
- [x] Verifica: `tsc --noEmit` + `vitest run` verdi

## Fase 6 — Facade, pubblico, chiusura

Obiettivo: modulo importabile come unità, suite completa verde.

File: `src/facade.ts`, `src/index.ts`, `tests/facade.test.ts`,
`tests/index.test.ts`.

- [x] `facade.ts`: `CompactionFacade` tipata (no `any`) sopra engine
- [x] `index.ts`: esporta completo del modulo
- [x] Test facade + test pubblico (ogni export raggiungibile)
- [x] `PROGRAM_STATE.md`: voce di chiusura con stato di ogni apertura
      `TODO(governance)`
- [x] Verifica finale: `tsc --noEmit` + `vitest run` verdi sull'intera suite
