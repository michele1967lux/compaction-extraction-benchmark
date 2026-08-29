# PROGRAM_STATE — log append-only

Regole (da TASK.md): ogni voce ha timestamp UTC, fase corrente, cosa è fatto,
cosa resta, problemi/aperture. **Non modificare** le voci precedenti.

---

## 2026-08-28 11:26 UTC — Fase 0 completata

- **Fase corrente:** 0 (Governance).
- **Fatto:** `PLAN.md`, `ROADMAP.md`, `PROGRAM_STATE.md` creati nella root.
  Studiato il sorgente reale in
  `/home/lux-ai/Scaricati/deepseek-harness/packages/compaction/`:
  - `compaction/src/{index,types,brand,checkpoint,tool-pairing}.ts`
  - `compaction-basic/src/{index,region,summarizer,config,types}.ts`
  - `compaction-tool-result-pruner/src/index.ts` (companion, opzionale)
  - `compaction-extracted/` (tentativo esistente nel repo: solo re-export
    dei pacchetti workspace, con `any` — NON lo uso come base)
  - forme esterne: `packages/core/session` (Session/SessionEvent/Surface),
    `packages/llm/llm` (ContentBlock/StreamChunk/BlockAssembler/
    `deepFreeze`/`errorChain`), `packages/llm/token-meter`
    (TokenMeasurement/Node, measure/estimateMessage),
    `CONTEXT_WINDOW_EXCEEDED_CODE = 'CONTEXT_WINDOW_EXCEEDED'`.
- **Resta:** fasi 1–6 secondo `ROADMAP.md`.
- **Aperture documentate prima di divergere** (dettagli in `PLAN.md`, D1–D7):
  - D1: nessun Cordis (`CompactionEngine` senza `Service`; `CompactionEventMap`
    locale).
  - D2: vocab dsh-llm ridefinito al minimo; BlockAssembler portato in minima
    parte (push/blocks/usage/finish).
  - D3: event-wiring cordis (`agent/pre-step`, `agent/request-error`,
    `agent/status`, `session/event`) esposto come metodi equivalenti
    dell'engine con **identiche** guardie.
  - D4: tokenMeter/llm/sessions.flush/pruner/logger iniettati.
  - D5: pruner companion non estratto (companion opzionale); l'evento
    `compaction/prune` resta nella mappa.
  - D6: config validation porta per intero (già runtime-pura nella fonte).
  - D7: `facade.ts` nuovo, tipato, senza `any`.
- **Ambiente:** `node v22.23.1`; registry npm raggiungibile
  (`npm ping` ok); pnpm in sandbox ha un errore permessi su `.shared/pnpm`
  ma `npm` funziona → uso `npm` per le devDep del modulo.

---

## 2026-08-28 12:13 UTC — Fase 1 completata

- **Fase corrente:** 1 (Fondamenta senza Cordis) — completata.
- **Fatto (file):**
  - `package.json` — `type: module`, zero `dependencies`, devDeps
    `typescript ^6.0.3`, `vitest ^4.1.8`, `@types/node ^22.20.0`.
  - `tsconfig.json` — riflette `tsconfig.base.json` del repo
    (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
    `noImplicitOverride`, `noFallthroughCasesInSwitch`,
    `noUnusedLocals/Parameters`, `allowImportingTsExtensions` +
    `rewriteRelativeImportExtensions`, `verbatimModuleSyntax`, target
    `es2024`, `module esnext`, `moduleResolution bundler`, `noEmit`).
    Nota: il repo non usa `erasableSyntaxOnly` → omesso per fedeltà.
  - `vitest.config.ts` — config locale: impedisce a Vitest di risalire alla
    config della repo madre (permessi/workspace diversi).
  - `src/brand.ts` — `Branded<B>` + factory `CompactionId`, `CommandId`,
    `SessionId`, `ToolCallId`, `MessageId` (port fedele di `dsh-brand` e dei
    brand specifici; cast zero-cost, nessuna validazione).
  - `src/session.ts` — vocab di seam minima; contenuti:
    - LLM: `LlmFailure`, `ContentBlock` (+ 5 block), `FinishReason` + `Map`,
      `TokenUsage`, `StreamChunk` (7 varianti), `ToolSchema`,
      `MessageSource` + `Map`, `Message`/`UserMessage`/`AssistantMessage`/
      `ToolResultMessage`, `createUserMessage`, `LlmCallConfig`,
      `EpochHeader`.
    - Session: `SessionEventMap` (10 tipi evento, inclusi
      `compaction/start|summary|end|prune`), `SessionEvent<T>` unione
      distributiva (fedele a `dsh-session`), `SurfaceEventType`, `SurfaceOp`,
      `SurfaceIntent`, `ISessionSurface`, `ISession`.
    - Token: `TokenSurfaceNode`, `TokenMeasurement`, `ITokenMeter`.
    - LLM client: `LlmRequest`, `LlmModelInfo`, `ILLMClient`.
    - Agent: `CompactionAgentContext`, `ManualCompactAgentContext`.
    - Util portati: `deepFreeze`, `errorChain`, `contentHasImage`,
      `assertNever`.
- **Test (21/21 verdi):** `tests/fakes.ts` (FakeSession con surface +
  replace, FakeMeter, FakeLLM, fixture messaggi), `tests/brand.test.ts`
  (4 famiglie id), `tests/session.test.ts` (createUserMessage/deepFreeze/
  errorChain/contentHasImage/assertNever + behavior fixture).
- **Verifica:** `tsc --noEmit` verde; `vitest run` 21/21.
- **TODO(governance):** nessuno aggiunto in questa fase (tutto portato
  fedele o documentato come minima parte).
- **Resta:** fasi 2–6 secondo `ROADMAP.md`.

---

## 2026-08-28 17:51 UTC — Fase 2 completata

- **Fase corrente:** 2 (Seam: vocab, checkpoint, tool-pairing).
- **Fatto:**
  - `src/types.ts` — vocab compaction completo:
    - `CompactionTrigger`, `ManualCompactionErrorCode`, `ManualCompactionError`.
    - `CompactionResult` (port fedele di `dsh-compaction/src/types.ts`).
    - `CompactionEngine` astratta (2 metodi: `compactRegion`, `compactNow`).
    - Config: `CompactionPolicyConfig`, `ModelCompactPolicyConfig`,
      `BasicCompactionConfig`, `ResolvedRetention`, `ResolvedConfig`,
      `ResolvedTargetPolicy`, `ResolvedCompactSpec`, `TargetPressureConfigError`.
    - Resolvers: `resolveConfig`, `resolveTargetPolicy`, `resolveCompactSpec`
      (port fedele di `compaction-basic/config.ts` — tutte le formule,
      messaggi d'errore, e helper `assert*` inclusi).
  - `src/checkpoint.ts` — `COMPACT_CHECKPOINT_MARKER`,
    `CompactionCheckpointSource`, `compactCheckpointSource`,
    `isCompactCheckpointSource` (1:1 da `dsh-compaction/src/checkpoint.ts`).
  - `src/tool-pairing.ts` — `toolPairingBalancedBefore/After` + cache
    incrementale per sessione (1:1 da `dsh-compaction/src/tool-pairing.ts`,
    adattata a `ISession`).
  - `src/session.ts` — correzione: `CompactionSummaryData` ora porta la
    discriminated union `llmStreamCall` fedele alla fonte (prima era un
    semplice `boolean`).
  - Test: `tests/types.test.ts` (20 test: config validation, resolvers,
    error classes), `tests/checkpoint.test.ts` (10 test: marker, predicate,
    freeze), `tests/tool-pairing.test.ts` (9 test: balance, rebuild,
    corrupt-surface errors).
- **Verifica:** `tsc --noEmit` verde; `vitest run` 60/60 (5 file).
- **TODO(governance):** nessuno aggiunto in questa fase.
- **Resta:** fasi 3–6 secondo `ROADMAP.md`.

---

## 2026-08-28 19:11 UTC — Fase 3 completata

- **Fase corrente:** 3 (Range e transazione).
- **Fatto:**
  - `src/ranges.ts` — `selectCompactableRange` (port fedele di
    `compaction-basic/src/region.ts`: head-anchored range, priced tail
    retention, tool-pairing balance snap-back).
  - `src/transaction.ts` — transazione compaction completa:
    - `compactSurfaceRegion` (orchestratore: validate → start → prepare →
      summarize → stability → commit → end).
    - `assertNoActiveCompaction` (lock check).
    - `inspectCompactionEntryState` (open-turn, unmatched-compaction,
      end-seed state).
    - `prepareCompaction` / `summarizeCompaction` / `commitCompactionBody` /
      `completeCompaction`.
    - `assertWholeSurfaceUnchanged` / `assertSelectedSpanStable` (stability
      checks).
    - `throwManualFailure` (error classification: commit/changed/summary).
    - `frameSummary` (checkpoint preamble + tags).
  - `src/session.ts` — aggiunta `SummarizationInput` + `SummaryResult`
    (port fedele di `compaction-basic/src/summarizer.ts`).
  - Test: `tests/ranges.test.ts` (5 test: empty surface, mismatch,
    head-anchored selection, full retention, snap-back),
    `tests/transaction.test.ts` (7 test: event order, busy lock, open-turn
    rejection, shrink failure, error recording, assertNoActiveCompaction).
- **Verifica:** `tsc --noEmit` verde; `vitest run` 72/72 (7 file).
- **TODO(governance):** nessuno aggiunto in questa fase.
- **Resta:** fasi 4–6 secondo `ROADMAP.md`.

---

## 2026-08-28 19:18 UTC — Fase 4 completata

- **Fase corrente:** 4 (Summarizer).
- **Fatto:**
  - `src/summarizer.ts` — summarization LLM completa:
    - `COMPACTION_INSTRUCTION` (8 sezioni, copia letterale).
    - `CHECKPOINT_PREAMBLE`, `SUMMARY_OPEN_TAG`, `SUMMARY_CLOSE_TAG`.
    - `frameSummary` (preamble + tags).
    - `summarizeWithLlm` (target resolution: configured > latest > agentTarget;
      BlockAssembler; finishError; summaryText).
    - `finishError` (error/aborted → throw; max-tokens → MAX_TOKENS).
    - `summaryText` (contentHasImage → throw; filter text blocks).
    - `BlockAssembler` minimale (block-start/text-delta/block-end/usage/finish).
  - Test: `tests/summarizer.test.ts` (9 test: frameSummary, summarizeWithLlm
    success, max-tokens, error, aborted, no-target, empty-summary,
    target precedence).
- **Verifica:** `tsc --noEmit` verde; `vitest run` 81/81 (8 file).
- **TODO(governance):** nessuno aggiunto in questa fase.
- **Resta:** fasi 5–6 secondo `ROADMAP.md`.

---

## 2026-08-28 22:55 UTC — Fase 5 completata

- **Fase corrente:** 5 (Engine).
- **Fatto:**
  - `src/engine.ts` — `BasicCompactionEngine` completo:
    - `compactIfNeeded` (pressure + context-overflow; threshold check;
      prune; retry loop; `TargetPressureConfigError`).
    - `compactRegion` (delega a `compactSurfaceRegion`).
    - `compactNow` (manual compaction; `runMaintenance`; busy/cancelled
      error handling).
    - `summarize` hook (delega a `summarizeWithLlm`).
    - `stepPressureCheck` / `recoverFromOverflow` (wrapper trigger).
    - `onAgentIdle` / `noteAssistantMessage` (overflow retry reset).
  - Test: `tests/engine.test.ts` (6 test: below threshold → null;
    above threshold → compaction; `TargetPressureConfigError`;
    `compactNow` no range → null; busy → `ManualCompactionError`;
    cancelled → throw).
- **Verifica:** `tsc --noEmit` verde; `vitest run` 87/87 (9 file).
- **TODO(governance):** nessuno aggiunto in questa fase.
- **Resta:** fase 6 secondo `ROADMAP.md`.

---

## 2026-08-28 23:40 UTC — Fase 6 completata — MODULO CHIUSO

- **Fase corrente:** 6 (Facade, pubblico, chiusura).
- **Fatto:**
  - `src/facade.ts` — `CompactionFacade` tipata sopra engine:
    - `compactIfNeeded` (delega a engine).
    - `compactRegion` (delega a engine).
    - `compactNow` (delega a engine; throw se non supportato).
  - `src/index.ts` — export pubblico completo del modulo:
    - Brand types, session vocabulary, compaction types, checkpoint,
      tool pairing, ranges, transaction, summarizer, engine, facade.
  - Test: `tests/facade.test.ts` (4 test: delegation compactIfNeeded,
    compactRegion, compactNow, unsupported compactNow),
    `tests/index.test.ts` (10 test: ogni export raggiungibile).
- **Verifica:** `tsc --noEmit` verde; `vitest run` 101/101 (11 file).
- **TODO(governance):** nessuno aperto.
- **Stato:** modulo completo, importabile come unità, suite verde.
