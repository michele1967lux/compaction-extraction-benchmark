# ROADMAP — fasi numerate

Ogni fase è completa solo quando il suo deliverable verificabile è vero E
`PROGRAM_STATE.md` è stato aggiornato con l'esito. Si procede una fase alla
volta, nell'ordine sotto.

## Fase 1 — Scaffolding del progetto
- [ ] `package.json` (nome, `type: module`, devDependencies: `typescript`,
      `vitest`, `@types/node`; script `typecheck`, `test`, `build`)
- [ ] `tsconfig.json` (`strict: true`, `noImplicitAny`, `target: ES2022`,
      `module: NodeNext`, `rootDir: src`, `outDir: lib`)
- [ ] `src/` e `tests/` creati (vuoti)
- Deliverable: `npm install` completa senza errori (o annotato se la rete non
  è disponibile), `npx tsc --noEmit` gira senza errori su un progetto vuoto.

## Fase 2 — Fondamenta: `brand.ts`, `session.ts`
- [ ] `brand.ts`: primitivo `Branded<B>` + `CompactionId`, `CommandId`,
      `SessionId`, `MessageId`, `ToolCallId`, `ReasoningEffortId` (costruttori
      brandizzanti, nessuna validazione — fedele a `dsh-brand`/`dsh-compaction/brand.ts`)
- [ ] `session.ts`: vocabolario iniettato minimo —
      `SessionEventMap` (eventi generici + `compaction/*`), `SessionEvent<T>`,
      `SurfaceOp`, `SurfaceIntent`, `SessionSurface`, `EpochHeader`, `ISession`;
      `TokenMeasurement`, `TokenSurfaceNode`, `ITokenMeter`;
      `ContentBlock` (text/reasoning/image/tool-call/tool-result), `TokenUsage`,
      `ToolSchema`, `Message`/`UserMessage`/`AssistantMessage`/`ToolResultMessage`,
      `MessageSource`; `GenerateOptions`, `StreamChunk`, `FinishReason`,
      `LlmCallConfig`, `ILlmService`; helper runtime portati fedelmente:
      `deepFreeze`, `createMessage`/`createUserMessage`, `contentHasImage`,
      `errorChain`, `HarnessError`/`LlmError`, `assertNever`,
      `CONTEXT_WINDOW_EXCEEDED_CODE`.
- Deliverable: `npx tsc --noEmit` pulito sui due file.

## Fase 3 — `checkpoint.ts`, `tool-pairing.ts`, `types.ts`
- [ ] `checkpoint.ts`: porta 1:1 `compactCheckpointSource`,
      `isCompactCheckpointSource`, `CompactionCheckpointSource` dalla fonte.
- [ ] `tool-pairing.ts`: porta 1:1 `toolPairingBalancedBefore/After` e la
      cache di bilanciamento incrementale (`BalanceCache`, `extendCache`,
      `balanceCache`, `eventDelta`, `eventForSeq`, `cutBalance`).
- [ ] `types.ts`: `CompactionResult` (stessa forma della fonte).
- Deliverable: `npx tsc --noEmit` pulito. Primi test unitari per
  `tool-pairing.ts` con una `ISession` finta in-memory (bilanciamento
  prima/dopo un cut, rifiuto di sequenze fuori superficie, errore su
  tool/result senza call aperta).

## Fase 4 — `ranges.ts`, `summarizer.ts`
- [ ] `ranges.ts`: `selectCompactableRange` (retain-tail dalla coda,
      bilanciamento tool-pairing) + `validateRangeSelection` (rinominata da
      `validateSurfaceRegion` della fonte, stessa logica: bound su superficie,
      cut bilanciati a inizio/fine).
- [ ] `summarizer.ts`: `summarizeWithLlm`, `frameSummary`,
      `SummarizationInput`/`SummaryResult`, `COMPACTION_INSTRUCTION`,
      `CHECKPOINT_PREAMBLE`, tag `<compacted-summary>`, `BlockAssembler`
      (porta interna, stessa incrementale chunk→blocco), `finishError`,
      `summaryText`.
- Deliverable: `npx tsc --noEmit` pulito. Test unitari: `selectCompactableRange`
  con retainTokens variabile e superficie sbilanciata; `frameSummary` produce
  i tre blocchi attesi; `summarizeWithLlm` con un `ILlmService` finto che
  produce chunk di testo, verifica errore su max-tokens/aborted/error e su
  output vuoto.

## Fase 5 — `engine.ts` Parte A (vocabolario astratto + config)
- [ ] `ManualCompactionErrorCode`, `ManualCompactionError` (porta 1:1)
- [ ] `CompactionTrigger`
- [ ] `CompactionAgentContext`, `ManualCompactAgentContext` (adattate a
      `ISession`; `ManualCompactAgentContext` guadagna `flush?: () =>
      Promise<void>` opzionale — vedi PLAN.md divergenza #2)
- [ ] `abstract class CompactionEngine` (stessa API astratta:
      `compactIfNeeded`, `compactNow`, `compactRegion`)
- [ ] Vocabolario di configurazione portato da `compaction-basic/types.ts`:
      `CompactionPolicyConfig`, `ModelCompactPolicyConfig`,
      `BasicCompactionConfig`, `ResolvedRetention`, `ResolvedConfig`,
      `ResolvedTargetPolicy`, `ResolvedCompactSpec`
- [ ] Risoluzione configurazione portata da `compaction-basic/config.ts`
      (senza lo schema `schemastery`, che serviva solo al loader Cordis; la
      validazione manuale che la fonte esegue comunque resta intatta):
      `resolveConfig`, `resolveTargetPolicy`, `resolveCompactSpec`,
      `TargetPressureConfigError`, e gli helper di validazione privati.
- Deliverable: `npx tsc --noEmit` pulito (transaction.ts non ancora esiste,
  quindi nessun import verso di esso in questa fase). Test unitari per
  `resolveConfig`/`resolveTargetPolicy`/`resolveCompactSpec` (default,
  override per modello, rifiuto chiavi sconosciute, rifiuto retain>=threshold).

## Fase 6 — `transaction.ts`
- [ ] `compactSurfaceRegion`, `assertNoActiveCompaction` (esportate)
- [ ] Helper privati portati 1:1: `prepareCompaction`, `summarizeCompaction`,
      `assertWholeSurfaceUnchanged`, `assertSelectedSpanStable`,
      `commitCompactionBody`, `completeCompaction`, `buildSummarizationInput`,
      `inspectCompactionEntryState`, `assertCompactionInactive`,
      `throwManualFailure`, `SurfaceChangedError`, `errorChain` (locale).
- Deliverable: `npx tsc --noEmit` pulito. Test unitari: transazione
  start→summary→replace→end su una `ISession` finta; rifiuto se compaction
  già attiva; rollback/`compaction/end` con `error` su fallimento del
  summarizer; rifiuto se il riassunto non è più piccolo del contenuto
  oscurato; instabilità di superficie durante la summarizzazione asincrona
  (whole-surface vs selected-span).

## Fase 7 — `engine.ts` Parte B (`BasicCompactionEngine`)
- [ ] `routedTarget`, `conversationTarget` (helper privati)
- [ ] `summarize()` hook dinamicamente dispatchato (override point)
- [ ] `compactIfNeeded` (trigger `pressure`/`context-overflow`, soglia,
      retry, prune-hook opzionale)
- [ ] `compactRegion` (delega a `compactSurfaceRegion`)
- [ ] `compactNow` (blocco idle via `agent.runMaintenance`, mapping errori
      su `ManualCompactionError`)
- [ ] `// TODO(governance)` esplicito dove la fonte registrava gli hook
      Cordis automatici (vedi PLAN.md divergenza #1), con commento che
      descrive l'algoritmo da riprodurre lato consumer.
- Deliverable: `npx tsc --noEmit` pulito sull'intero `src/`. Test unitari:
  `compactIfNeeded` con pressure sotto/sopra soglia, retry multipli,
  `context-overflow` che ignora la soglia, propagazione di
  `TargetPressureConfigError`; `compactNow` happy-path e busy/cancelled.

## Fase 8 — `facade.ts`, `index.ts`
- [ ] `facade.ts`: wrapper operativo Cordis-free che costruisce
      `BasicCompactionEngine` con le dipendenze iniettate esplicite
      (`ISession`/`ITokenMeter`/`ILlmService`) invece di un `ctx: Context`
      Cordis, esponendo `compactIfNeeded`/`compactNow`/`compactRegion`.
- [ ] `index.ts`: barrel che ri-esporta la superficie pubblica di tutti i
      moduli sopra.
- Deliverable: `npx tsc --noEmit` pulito. Test: import dell'intero pacchetto
  da `index.ts` e uso della facade end-to-end con doppi finti.

## Fase 9 — Verifica finale
- [ ] `npx tsc --noEmit` pulito sull'intero progetto
- [ ] `npx vitest run` verde su tutta `tests/`
- [ ] Rilettura di PROGRAM_STATE.md per confermare che ogni divergenza
      dichiarata in PLAN.md è stata effettivamente rispettata nel codice
      (nessuna diventata silenziosa)
- [ ] Ultima voce di PROGRAM_STATE.md: riepilogo finale (fasi completate,
      cosa NON è stato portato e perché, self-assessment)
