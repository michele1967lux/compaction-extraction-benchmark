# PLAN — estrazione del sistema di compaction di DeepSeek Harness in un modulo isolato

## Obiettivo

Estrarre il sistema di compaction di DeepSeek Harness in un modulo TypeScript
isolato, **importabile e testabile senza Cordis** e senza alcun import da
`@deepseek-ai/dsh-*`, dentro questa cartella. La logica (tool-pairing,
selezione del range, transazione start → summary → replace → end,
summarization via LLM) è un **porto fedele** della fonte; le uniche
dipendenze esterne (session, token meter, LLM) sono iniettate via interfacce
minime definite in `src/session.ts`.

Fonte studiata (cartella `/home/lux-ai/Scaricati/deepseek-harness/`):

| Sorgente | Ruolo |
| --- | --- |
| `packages/compaction/compaction/src/{index,types,brand,checkpoint,tool-pairing}.ts` | seam `@deepseek-ai/dsh-compaction`: `CompactionEngine` astratta, `ManualCompactionError`, `CompactionId` branded, checkpoint source, balance del tool-pairing, eventi `compaction/*` |
| `packages/compaction/compaction-basic/src/{index,region,summarizer,config,types}.ts` | backend `@deepseek-ai/dsh-compaction-basic`: transazione `compactSurfaceRegion`, `selectCompactableRange`, `assertNoActiveCompaction`, check di stabilità, summarizer one-shot con riuso del prefisso KV-cache, risoluzione config |
| `packages/compaction/compaction-tool-result-pruner/src/*.ts` | companion **opzionale** (pruning model-free, evento `compaction/prune`) — non estratto (vedi divergenza D5) |
| `packages/compaction/compaction-extracted/` | tentativo esistente nel repo: solo **ri-esport** dei pacchetti workspace — NON soddisfa il requisito "senza Cordis"; non è la base di questa estrazione |
| `packages/core/session/src/{types,surface,index}.ts` | forma di `Session`/`SessionEvent`/`SessionSurface` da cui deriva `ISession` |
| `packages/llm/llm/src/{types,message,assembler,error,never}.ts` | vocab `dsh-llm` (ContentBlock, StreamChunk, FinishReason, Message, BlockAssembler, `deepFreeze`, `errorChain`, `assertNever`) |
| `packages/llm/token-meter/src/{types,index}.ts` | `TokenMeasurement`/`TokenSurfaceNode` da cui derivano `ITokenMeasurement`/`ITokenMeter` |

## Principi di fedeltà

1. Gli algoritmi sono coperti **come sono nella fonte**: balance incrementale
   del tool-pairing (`balanceCache`, `extendCache`, `cutBalance`),
   `selectCompactableRange` (accumulo dal tail + snap sulla boundary balanceata),
   transazione (`validateSurfaceRegion` → `compaction/start` → prepare → summarize
   → check di stabilità → `compaction/summary` + `user/message` con
   `surfaceOp: replace` → `compaction/end`; ogni fallimento chiude esattamente
   con un `compaction/end` con `error`), errori manuali classificati
   (`busy|cancelled|changed|summary|commit|persistence`), summarizer
   (istruzione finale + prefisso riusato, `frameSummary`, `finishError`,
   proiezione text-only `summaryText`, check shrink), risoluzione config
   (`resolveConfig`, `resolveTargetPolicy`, `resolveCompactSpec`,
   `TargetPressureConfigError`).
2. Nessun stub silenzioso: ogni parte semplificata o non ancora reale è
   marcata `// TODO(governance): ...` nel codice E annotata in
   `PROGRAM_STATE.md`.
3. Ogni divergenza dalla fonte è documentata in `PROGRAM_STATE.md` **prima**
   di scriverla nel codice.

## Divergenze deliberate (nessuna altera la logica di compaction)

- **D1 — Nessun Cordis.** `CompactionEngine` non estende `Service`; non ci sono
  `declare module '@deepseek-ai/cordis'` né merge su `SessionEventMap` di
  `dsh-session`. La mappa degli eventi `compaction/*` diventa un tipo locale
  (`CompactionEventMap`) in `src/types.ts`; `ISession.append` la accetta.
- **D2 — Vocab `dsh-llm` minimale.** I tipi di contenuto/flux (`ContentBlock`,
  `StreamChunk`, `FinishReason`, `TokenUsage`, `ToolSchema`, `Message`,
  `MessageSource`) sono ridefinizioni strutturali minime in `src/session.ts`,
  limitate ai campi che la compaction legge. Il blocco `image` porta solo il
  tag `type` (la compaction lo usa solo come discriminante
  `contentHasImage`, mai il payload). `BlockAssembler` è un port minimale
  locale in `src/summarizer.ts` (solo `push`/`blocks`/`usage`/`finish`,
  incluse le stesse regole di assemblaggio e il drop dei tool-call su
  `max-tokens`); `replayState`/`interruptedBlocks`/`message()` sono esclusi
  perché la compaction non li usa.
- **D3 — Event wiring estratto in metodi.** Nel repo, l'automatismo
  (registrato da `BasicCompactionEngine._registerAutomaticCompaction` via
  `ctx.on('agent/pre-step')`, `ctx.on('agent/request-error')`,
  `ctx.on('agent/status')`, `ctx.on('session/event')`) dipende dal loop
  Cordis. La stessa logica, con le stesse guardie (abort check, soppressione
   dei warning ripetuti per target, contatori `overflowRetries`, reset su
  `assistant/message` e su status idle, confronto `replaceGeneration`,
  `CONTEXT_WINDOW_EXCEEDED_CODE`) è esposta come metodi chiamabili
  dell'engine (`stepPressureCheck`, `recoverFromOverflow`, `onAgentIdle`,
  `noteAssistantMessage`); chi integra nel proprio loop decide la chiamata
  (waterfall `next()` inclusa: il metodo ritorna un oggetto decisione,
  non chiama alcun listener).
- **D4 — Dipendenze iniettate.** `tokenMeter` → `ITokenMeter`; `ctx.llm`
  (`stream`/`resolveModelInfo`) → `ILLMClient`; `ctx.sessions.flush(session)`
  → `options.flush`; `ctx.get('toolResultPruner')` → `dependencies.pruner`
  opzionale (la logica `if (prune !== undefined)` è intatta); `ctx.logger`
  → optional `logger` nel dipendenze (null-safe).
- **D5 — Pruner companion non estratto** (TASK.md: "companion, opzionale").
  L'evento `compaction/prune` resta nella mappa per fedeltà del protocollo
  shadow-price; l'engine accetta un pruner iniettato di forma
  `{ pruneSession(session): unknown }`. Implementazione del pruner: fuori
  scope, documentato.
- **D6 — Schemastery/zod non necessari.** La validazione config della fonte
  (`config.ts`) è già runtime-pura (funzioni `assertX`, nessuna dipendenza da
  `z`); la si porta per intero. Lo schema `static Config` (solo per il
  loader cordis) viene omesso: non è logica di compaction.
- **D7 — Facade.** Il `compaction-extracted` del repo è un re-export
  tipizzato-`any`. Il nostro `src/facade.ts` è un layer operazionale **tipato**
  (nessun `any`) sopra engine + dipendenzi, con `maybeCompact` e `compactNow`
  deleganti. È l'unico file senza corrispondenza 1:1 nella fonte —
  dichiarato come tale.

## File prodotto e dipendenze

Ordine di dipendenza (i livelli possono essere scritti in questo ordine):

| # | File | Proviene da (fonte) | Dipende da |
| --- | --- | --- | --- |
| 1 | `package.json` | — (solo devDep: typescript, vitest) | — |
| 2 | `tsconfig.json` | repo `strict: true` | — |
| 3 | `src/brand.ts` | `dsh-compaction/brand.ts` + `dsh-brand` (`Branded`) + `dsh-commands/brand` (`CommandId`) | — |
| 4 | `src/session.ts` | tipi minimi da `dsh-session` (Session/SessionEvent/SessionSurface), `dsh-llm` (vocab + `deepFreeze`/`errorChain`/`contentHasImage`/`assertNever`/`createUserMessage`), `dsh-token-meter` (TokenMeasurement/Node, `estimateMessage`), `dsh-agent` (Agent/`runMaintenance`) | brand.ts, session.ts stesso |
| 5 | `src/types.ts` | `dsh-compaction/src/{index,types}.ts` (vocab + `CompactionEngine` astratta + `ManualCompactionError`) + `compaction-basic/src/{types,config}.ts` (vocab config + risoluzione) | brand.ts, session.ts |
| 6 | `src/checkpoint.ts` | `dsh-compaction/checkpoint.ts` (1:1) | brand.ts, session.ts |
| 7 | `src/tool-pairing.ts` | `dsh-compaction/tool-pairing.ts` (1:1, adattato a `ISession`) | session.ts |
| 8 | `src/ranges.ts` | `compaction-basic/region.ts`: `selectCompactableRange` + `validateSurfaceRegion`→`validateRangeSelection` | session.ts, tool-pairing.ts |
| 9 | `src/summarizer.ts` | `compaction-basic/summarizer.ts` (1:1 su `ILLMClient`) + port BlockAssembler minimale | session.ts |
| 10 | `src/transaction.ts` | `compaction-basic/region.ts`: `compactSurfaceRegion` + `assertNoActiveCompaction` + stabilità + commit + entry-state | brand, session, types, checkpoint, tool-pairing, summarizer |
| 11 | `src/engine.ts` | `compaction-basic/index.ts`: `BasicCompactionEngine` (compactIfNeeded/compactRegion/compactNow + metodi automatico-equivalenti) | transaction, ranges, summarizer, types |
| 12 | `src/facade.ts` | layer operazionale nuovo (D7), sopra engine | engine |
| 13 | `src/index.ts` | pubblico del modulo (specifica: `dsh-compaction/src/index.ts` esclusioni cordis) | tutti |
| 14 | `tests/` | spec di comportamento (fakes: FakeSession/FakeMeter/FakeLLM), scenario alla fonte | tutti |

## Strategia di verifica (ad ogni fase)

- `npx tsc --noEmit` (strict) sul modulo, prima di dichiarare la fase fatta.
- `vitest run` sui test scritti finoaquel punto; ogni fase aggiunge i test
  dei file che introduce.
- `PROGRAM_STATE.md` aggiornato **dopo** ogni fase, con timestamp, cosa fatto,
  cosa resta, problemi/aperture.

## Strategia di test (casi chiave)

- tool-pairing: surface miste, balance prima/dopo, seq assente, result orfana.
- range: retainTokens, snap su boundary, null se tutto è da retain.
- transazione: ordine durabile start→summary→user/message(replace)→end,
  `sourceEventSeqs`, lock su start mancata (busy), stabilità
  whole-surface vs selected-span, shrink fallito, end con `error` su fallimento,
  flush failure → ManualCompactionError('persistence').
- summarizer: chunks → block, `max-tokens` → errore fail-closed, output image
  rifiutata, `frameSummary` tag, target risoltione (config > last routed >
  options).
- engine: soglia pressione (sotto/oltre), overflow forzato, retries,
  `TargetPressureConfigError` senza contextWindow, `compactNow` null senza
  range, busy/cancelled.
- facade: delega engine/dipendenzi.
