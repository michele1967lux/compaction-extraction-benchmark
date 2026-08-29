# PROGRAM_STATE — log di stato (append-only)

Regola: ogni voce si AGGIUNGE in fondo al file. Non si modifica né si
cancella una voce precedente; una correzione si registra come nuova voce che
la richiama.

---

## 2026-08-28T00:00Z — Fase 0: lettura fonte e governance

**Fatto:**
- Letto `TASK.md` in questa cartella.
- Letti per intero: `packages/compaction/compaction/src/{index,types,checkpoint,tool-pairing,brand}.ts`,
  `packages/compaction/compaction-basic/src/{index,region,summarizer,config,types}.ts`,
  `packages/compaction/compaction-tool-result-pruner/src/index.ts`.
- Letti quanto necessario per capire le dipendenze iniettabili:
  `packages/util/brand/src/index.ts`, `packages/interaction/commands/src/brand.ts`,
  `packages/core/session/src/{index.ts (righe 395-780), surface.ts (righe 1-170), types.ts (righe 180-420)}`,
  `packages/llm/token-meter/src/{index.ts (righe 80-190), types.ts}`,
  `packages/llm/llm/src/{types.ts, message.ts, content.ts (parziale), assembler.ts, error.ts, call-config.ts}`.
- Letto anche `packages/compaction/compaction-extracted/src/{index,facade}.ts` — un
  tentativo GIÀ presente nel repo reale (non uno degli altri tentativi
  `extracted-compaction-*` fuori scope: è dentro `packages/compaction/`, quindi
  è "codice sorgente reale" secondo il vincolo 2 del task). Verificato che
  QUEL facade prende ancora `ctx: Context` di Cordis nel costruttore — non è
  Cordis-free. Deciso di NON seguirlo come riferimento per `facade.ts`: si
  useranno le interfacce minime iniettate come richiesto da TASK.md, non il
  suo pattern (che passa ancora `Context`).
- Scritti `PLAN.md` e `ROADMAP.md` con la progettazione completa del modulo:
  elenco file, dipendenze tra loro, 9 fasi numerate con deliverable
  verificabili, e 4 divergenze esplicite dalla fonte dichiarate PRIMA di
  scrivere qualsiasi file in `src/` (vedi PLAN.md § "Divergenze esplicite
  dalla fonte" per il testo completo):
  1. Wiring automatico Cordis (`ctx.on('agent/pre-step', ...)` ecc.) non
     portato — troppo accoppiato all'event bus di Cordis, che non esiste in
     un contesto Cordis-free. L'algoritmo di decisione resta portato per
     intero in `compactIfNeeded`/`compactNow`/`compactRegion`; manca solo
     l'aggancio automatico agli eventi dell'agent loop.
  2. `compactNow`'s `flush` non viene più da un servizio Cordis
     (`ctx.sessions.flush`) ma da un campo opzionale iniettato dal chiamante.
  3. Consolidamento fisico di più package sorgente (`dsh-brand`,
     `dsh-llm/brand`, `dsh-commands/brand`, `dsh-compaction/brand` →
     `brand.ts`; `dsh-session`+`dsh-llm`+`dsh-token-meter` → `session.ts`).
  4. Declaration merging cross-package non portabile 1:1: `SessionEventMap`
     unica in `session.ts`, comprensiva sia degli eventi generici sia di
     `compaction/*`.
- Deciso ESPLICITAMENTE di non portare `compaction-tool-result-pruner`
  (citato in TASK.md come "companion, opzionale", assente dall'elenco file
  atteso del deliverable finale).

**Resta da fare:** tutto `src/` e `tests/`, seguendo ROADMAP.md una fase alla
volta.

**Problemi/semplificazioni aperte:** nessuna nel codice ancora (nessun
codice scritto). Le 4 divergenze sopra sono progettuali, dichiarate PRIMA di
scrivere codice come richiesto dalla regola di governance del task.

---

## 2026-08-28T00:10Z — Fase 1: scaffolding — COMPLETATA

**Fatto:**
- `package.json` creato (`type: module`, devDependencies `typescript`,
  `vitest`, `@types/node`, script `typecheck`/`build`/`test`).
- `tsconfig.json` creato (`strict: true`, `noImplicitAny: true`,
  `noUncheckedIndexedAccess: true`, `module`/`moduleResolution: NodeNext`,
  `rootDir: .`, `outDir: lib`).
- `src/` e `tests/` creati (vuoti).
- `npm install` eseguito con successo (rete disponibile): 47 pacchetti
  installati, nessun errore. `npm audit` segnala 5 vulnerabilità nelle
  transitive dev-dependency di `vitest`/`esbuild`— non rilevante per un
  modulo isolato/non pubblicato, non affrontato.
- Verificato che `npx tsc --noEmit` legge correttamente `tsconfig.json`
  (fallisce solo per "no inputs" con `src/` vuoto, come atteso — non un
  errore di configurazione).

**Deliverable verificato:** sì — `npm install` pulito, config tsc valida.

**Resta da fare:** Fase 2 (`brand.ts`, `session.ts`).

**Problemi/semplificazioni aperte:** nessuna.

---

## 2026-08-28T00:25Z — Fase 2: `brand.ts`, `session.ts` — COMPLETATA

**Fatto:**
- `src/brand.ts`: `Branded<B>` + `CompactionId`, `CommandId`, `SessionId`,
  `MessageId`, `ToolCallId`, `ReasoningEffortId`. Porta verbatim dei
  costruttori branding della fonte (cast puro, nessuna validazione).
- `src/session.ts`: tutta la vocabolario iniettata — content block family,
  `TokenUsage`, `ToolSchema`, message family (`Message`/`UserMessage`/
  `AssistantMessage`/`ToolResultMessage`/`MessageSource`) con
  `createMessage`/`createUserMessage`/`freezeMessage`/`deepFreeze` portati
  verbatim; `contentHasImage` verbatim; `HarnessError`/`LlmError`/
  `errorChain`/`CONTEXT_WINDOW_EXCEEDED_CODE`/`assertNever` verbatim;
  vocabolario di chiamata LLM (`LlmCallConfig`, `GenerateOptions`,
  `StreamChunk`, `FinishReason`, `ILlmService` con `stream()`/
  `resolveModelInfo()`); vocabolario di sessione (`SessionEventMap` —
  ristretto ai soli tipi di evento che compaction legge/scrive, più i 4
  eventi `compaction/*` fusi nella stessa mappa per la ragione spiegata in
  PLAN.md divergenza #4 — `SessionEvent<T>`, `SurfaceOp`, `SurfaceIntent`,
  `SessionSurface`, `EpochHeader`, `ISession`); metering
  (`TokenMeasurement`, `TokenSurfaceNode`, `ITokenMeter`).

**Decisione tecnica non prevista nel PLAN, annotata qui:** gli import
relativi nella fonte reale usano l'estensione letterale `.ts`
(`from './brand.ts'`), risolvibile perché il repo reale compila con
`tsdown`/`tsx` e un tsconfig con `allowImportingTsExtensions` (che richiede
`noEmit`). Questo modulo standalone usa invece `tsc` per emettere `lib/`
tramite lo script `build`, quindi gli import relativi usano l'estensione
`.js` (convenzione standard `NodeNext`: lo specificatore `.js` risolve al
sorgente `.ts` durante il type-check e al file emesso durante la build).
Nessuna differenza di logica — solo una differenza di toolchain dovuta
all'assenza di `tsdown` in questo modulo isolato.

**Deliverable verificato:** sì — `npx tsc --noEmit` pulito su
`brand.ts` + `session.ts` (nessun altro file esiste ancora in `src/`).

**Resta da fare:** Fase 3 (`checkpoint.ts`, `tool-pairing.ts`, `types.ts`).

**Problemi/semplificazioni aperte:** nessuna.

---

## 2026-08-28T00:40Z — Fase 3: `checkpoint.ts`, `tool-pairing.ts`, `types.ts` — COMPLETATA

**Fatto:**
- `src/checkpoint.ts`: porta 1:1 di `compactCheckpointSource`,
  `isCompactCheckpointSource`, `CompactionCheckpointSource`.
- `src/tool-pairing.ts`: porta 1:1 di `toolPairingBalancedBefore/After` e
  della cache incrementale di bilanciamento (`BalanceCache`, `extendCache`,
  `balanceCache`, `eventDelta`, `eventForSeq`, `cutBalance`), adattata a
  `ISession`/`SessionEvent` iniettati invece della classe `Session` reale.
- `src/types.ts`: `CompactionResult`, identico alla fonte.
- `tests/fake-session.ts`: doppio di test per `ISession` — log append-only +
  bookkeeping di superficie (append in coda, replace di uno span inclusivo
  con bump di `replaceGeneration`), che riproduce la stessa transizione di
  superficie di `SurfaceManager` reale (`packages/core/session/src/surface.ts`)
  per quanto serve ai test di compaction — non una porta completa della
  classe `Session` (niente persistenza, niente validazione JSON-serializzabilità,
  niente fold dell'header): dichiarato nel commento di testa del file, non
  silenzioso.
- `tests/tool-pairing.spec.ts`: 5 test — cut bilanciati su surface senza call
  aperte, cut sbilanciato tra call aperta e risultato, errore su tool/result
  orfano, errore su seq fuori superficie, invalidazione della cache dopo una
  replace di compaction (il seq oscurato non è più risolvibile, il nodo di
  rimpiazzo sì).
- `vitest.config.ts` aggiunto (non previsto esplicitamente in PLAN.md, ma
  necessario): senza un config locale esplicito, Vitest risaliva le
  directory e trovava `deepseek-harness/vitest.config.ts` (root del repo
  reale), che referenzia `vite-tsconfig-paths` — un plugin del workspace non
  presente in questo modulo isolato — facendo fallire l'avvio. Il config
  locale fissa `root: __dirname` e `include: ['tests/**/*.spec.ts']` così il
  runner resta confinato a questa cartella.

**Deliverable verificato:** sì — `npx tsc --noEmit` pulito su tutto `src/` +
`tests/`; `npx vitest run` verde, 5/5 test passati (nessun test rosso da
correggere: il codice portato ha replicato correttamente il comportamento
atteso al primo tentativo, verificato leggendo l'algoritmo della fonte prima
di scrivere ogni asserzione).

**Resta da fare:** Fase 4 (`ranges.ts`, `summarizer.ts`).

**Problemi/semplificazioni aperte:** nessuna nella logica portata. Il solo
elemento non-1:1 è `tests/fake-session.ts`, che è un doppio di test (non fa
parte della superficie pubblica del modulo) e la sua natura parziale è
dichiarata nel suo stesso commento di testa.

---

## 2026-08-28T01:00Z — Fase 4: `ranges.ts`, `summarizer.ts` — COMPLETATA

**Fatto:**
- `src/session.ts` (modifica additiva, non è più "fase chiusa" ma la fase 2
  resta valida: nessuna riga precedente è stata alterata in modo
  incompatibile): aggiunta l'interfaccia `CompactionAgentContext` nella
  sezione "Agent context". Decisione di design non anticipata nel PLAN.md
  originale nel dettaglio implementativo (ma coerente con la sua intenzione):
  nella fonte reale `CompactionAgentContext` è dichiarata in
  `compaction/src/index.ts` (quello che qui diventa `engine.ts`), ma
  `compaction-basic/src/summarizer.ts` la usa (tramite il tipo più ampio
  `Agent`) SENZA che `dsh-compaction-basic` dipenda da un file "engine"
  proprio — la dipendenza nella fonte è verso il PACKAGE `dsh-compaction`,
  non circolare perché sono due package distinti. Qui, con un solo package,
  mettere `CompactionAgentContext` in `engine.ts` avrebbe reso `summarizer.ts`
  dipendente da `engine.ts`, invertendo la direzione di dipendenza dichiarata
  in PLAN.md (`engine.ts -> summarizer.ts`). Spostata quindi in `session.ts`
  (dipendenza zero), con `engine.ts` che la re-esporterà con lo stesso nome
  della fonte. Nessuna differenza di forma o di campi rispetto alla fonte.
- `src/ranges.ts`: `selectCompactableRange` (porta 1:1) e
  `validateRangeSelection` (porta 1:1 di `validateSurfaceRegion`, rinominata
  come da elenco file atteso di TASK.md), con l'interfaccia `SurfaceSelection`
  esportata per essere riusata da `transaction.ts` nella fase 6.
- `src/summarizer.ts`: `summarizeWithLlm`, `frameSummary`,
  `SummarizationInput`/`SummaryResult`, il prompt `COMPACTION_INSTRUCTION`
  verbatim, `CHECKPOINT_PREAMBLE`, tag `<compacted-summary>`, `finishError`,
  `summaryText`; `BlockAssembler` portata verbatim e inclusa nel file (unico
  consumer nel modulo estratto).
- `tests/fake-token-meter.ts`: doppio di test per `ITokenMeter` (prezzo per
  seq configurabile, default 10 token; `estimateMessage` euristico sulla
  lunghezza JSON) — dichiarato non fedele alla vera euristica del token
  meter reale (che non serve qui: ai test interessa solo che i confronti di
  soglia/retention si comportino correttamente con prezzi noti).
- `tests/ranges.spec.ts` (9 test): superficie vuota, selezione testa con coda
  trattenuta, nessun range quando la retention copre tutta la superficie,
  arretramento del cutoff fino al confine bilanciato più vicino quando cade
  dentro una coppia tool-call/risultato; validazione: range bilanciato
  sull'intera superficie, start/end fuori superficie, start dopo end, range
  che spezza una coppia tool-call/risultato.
  **Un test inizialmente sbagliato** (non il codice): il primo tentativo del
  test "arretramento del cutoff" usava `retainTokens=10`, che con i prezzi
  scelti non attivava affatto il ramo di arretramento (containment naturale
  del nodo di coda bastava). Il test è stato corretto a `retainTokens=15`
  dopo aver ritracciato l'algoritmo a mano; il codice sorgente in
  `ranges.ts` NON è stato toccato per farlo passare — era corretto, era
  l'aspettativa del test a essere calcolata male.
- `tests/summarizer.spec.ts` (7 test): `frameSummary` produce i 3 blocchi
  attesi; `summarizeWithLlm` — chiamata one-shot con istruzione di
  compaction in coda, fallback su header di richiesta instradata quando la
  config di summarization è vuota, errore quando nessun target è
  disponibile, errore `MAX_TOKENS` su troncamento, errore su output
  solo-whitespace, propagazione di un finish `error` dell'adapter.

**Deliverable verificato:** sì — `npx tsc --noEmit` pulito su tutto
`src/`+`tests/`; `npx vitest run` verde, 21/21 test passati su 3 file.

**Resta da fare:** Fase 5 (`engine.ts` Parte A: vocabolario astratto +
config).

**Problemi/semplificazioni aperte:** nessuna nella logica portata.

---

## 2026-08-28T01:30Z — Fasi 5+6: `engine.ts` + `transaction.ts` — COMPLETATE (verificate insieme)

**Deviazione dal meccanismo di fase pianificato, dichiarata qui:** ROADMAP.md
prevedeva `engine.ts` in due passate separate (Parte A prima di
`transaction.ts`, Parte B dopo) per poter verificare Parte A da sola con
`tsc --noEmit` prima che `transaction.ts` esistesse. In pratica ho scritto
`engine.ts` per intero in un solo passaggio (vocabolario astratto + config +
`BasicCompactionEngine` concreta), perché la classe concreta è corta da
scrivere subito dopo aver già in testa tutto l'algoritmo letto dalla fonte,
e poi ho scritto `transaction.ts` subito dopo. Il risultato verificabile è
lo stesso: entrambi i file sono stati verificati con `tsc --noEmit` e con i
test PRIMA di essere dichiarati completi, quindi nessuna fase è stata
dichiarata "fatta" senza controllo — cambia solo l'ORDINE meccanico di
scrittura dei due file, non il criterio di completamento. Annotato qui
esplicitamente invece di lasciarlo silenzioso.

**Fatto — `src/engine.ts`:**
- Vocabolario astratto (porta 1:1 da `compaction/src/index.ts`):
  `ManualCompactionErrorCode`, `ManualCompactionError`, `CompactionTrigger`,
  `abstract class CompactionEngine` (senza `extends Service` di Cordis).
  `CompactionAgentContext` è ri-esportata da `session.ts` (vedi nota fase 4);
  `ManualCompactAgentContext` estende `CompactionAgentContext` con
  `runMaintenance` (1:1) più il campo opzionale `flush?: () => Promise<void>`
  (divergenza #2 di PLAN.md, commentato nel codice).
- Vocabolario di configurazione (porta 1:1 da `compaction-basic/src/types.ts`):
  `CompactionPolicyConfig`, `ModelCompactPolicyConfig`, `BasicCompactionConfig`,
  `ResolvedRetention`, `ResolvedConfig`, `ResolvedTargetPolicy`,
  `ResolvedCompactSpec`. Sui campi `auto` e `maxOverflowRetries` (gli unici
  due letti SOLO dal wiring automatico non portato) ho aggiunto commenti
  `// TODO(governance): ...` che spiegano perché il campo è validato/risolto
  ma resta inerte in questo modulo — non lasciato come se fosse pienamente
  operativo.
- Risoluzione configurazione (porta 1:1 da `compaction-basic/src/config.ts`,
  meno lo schema `schemastery` parallelo — usato nella fonte solo per il
  loader/UI di configurazione Cordis, non per la validazione effettiva, che
  resta tutta nelle funzioni `validate*`/`assert*` qui portate identiche):
  `resolveConfig`, `resolveTargetPolicy`, `resolveCompactSpec`,
  `TargetPressureConfigError`, tutti gli helper privati di validazione.
- `BasicCompactionEngine` (porta 1:1 da `compaction-basic/src/index.ts`, con
  UNA sola omissione dichiarata): costruttore che riceve `ITokenMeter` e
  `ILlmService` iniettati invece di `ctx: Context`; hook `summarize()`
  dinamicamente dispatchato; `compactIfNeeded` (soglia, retry, prune-hook
  RIMOSSO — vedi nota sotto); `compactRegion`; `compactNow`. **Omesso
  esplicitamente e commentato con `// TODO(governance)` nel doc-comment
  della classe:** il metodo `_registerAutomaticCompaction()` della fonte
  (sottoscrizioni `ctx.on('agent/pre-step'|'agent/status'|'session/event'|
  'agent/request-error', ...)`) — PLAN.md divergenza #1. Il commento della
  classe riporta l'algoritmo COMPLETO che un consumer deve riprodurre nel
  proprio agent loop per riottenere lo stesso comportamento automatico
  (quando chiamare `compactIfNeeded`, come contare i retry di overflow, come
  resettare il contatore).
- **Ulteriore omissione dichiarata qui, non prevista esplicitamente nel PLAN
  originale ma conseguente alla #1:** `compactIfNeeded` nella fonte invoca
  anche il pruner opzionale di tool-result (`this.ctx.get('toolResultPruner')`)
  prima di rimisurare. Poiché `compaction-tool-result-pruner` è stato
  deliberatamente escluso dal deliverable (vedi fase 0), quella chiamata di
  prune opzionale è assente da `compactIfNeeded` qui — la soglia/retry
  restano identici, cambia solo che nessun prune model-free avviene prima
  della selezione del range. Nessun impatto sulla CORRETTEZZA della logica
  portata: nella fonte stessa il pruner è opzionale (`prune !== undefined`
  check) e la sua assenza è un percorso già previsto e testato dalla fonte.

**Fatto — `src/transaction.ts`:**
- Porta 1:1 di `compactSurfaceRegion`, `assertNoActiveCompaction`, e tutti
  gli helper privati (`prepareCompaction`, `summarizeCompaction`,
  `assertWholeSurfaceUnchanged`, `assertSelectedSpanStable`,
  `commitCompactionBody`, `completeCompaction`, `buildSummarizationInput`,
  `inspectCompactionEntryState`, `assertCompactionInactive`,
  `throwManualFailure`, `SurfaceChangedError`), usando `validateRangeSelection`
  da `ranges.ts` (fase 4) al posto della funzione privata equivalente della
  fonte. `errorChain` non duplicata: importata da `session.ts` (avevo
  inizialmente scritto una copia locale per fedeltà letterale alla struttura
  a file della fonte, ma è ridondante dato che `session.ts` già la esporta
  identica — corretto durante questa stessa fase, prima di dichiararla
  completa, non lasciato come duplicato silenzioso).
- Import ciclico `engine.ts <-> transaction.ts` (per `ManualCompactionError`)
  verificato sicuro: entrambi i moduli usano il binding dell'altro solo
  dentro corpi di funzione/metodo, mai a livello di valutazione del modulo;
  `tsc --noEmit` e i test a runtime confermano che funziona.

**Test aggiunti:**
- `tests/engine-config.spec.ts` (12 test): default di `resolveConfig`,
  rifiuto chiave sconosciuta, rifiuto `retainRatio >= thresholdRatio`,
  rifiuto `retainRatio`+`retainTokens` insieme, rifiuto coppia di
  summarization incompleta, rifiuto policy duplicate, rifiuto policy senza
  provider/model; `resolveTargetPolicy` — eredita i default, applica
  l'override esatto; `resolveCompactSpec` — scala i rapporti in token
  concreti, rifiuta `contextWindow` non positivo, rifiuta
  `retainTokens >= thresholdTokens` dopo lo scaling.
- `tests/transaction.spec.ts` (13 test): transazione completa
  start→summary→replace→end con verifica dell'ordine esatto degli eventi
  loggati e della superficie risultante; rifiuto compaction automatica senza
  turno aperto; rifiuto compaction manuale con turno aperto; rifiuto quando
  già attiva; `compaction/end` con `error` e propagazione quando il
  summarizer fallisce (con verifica che il lock si liberi comunque);
  classificazione dell'errore manuale come `ManualCompactionError('summary')`;
  rifiuto quando il riassunto non è più piccolo del contenuto oscurato;
  rifiuto quando l'intera superficie cambia durante la summarizzazione
  (stabilità whole-surface); tolleranza alla crescita della coda non
  correlata sotto stabilità selected-span; esecuzione del callback `flush`
  opzionale dopo un commit riuscito e propagazione del suo fallimento come
  `ManualCompactionError('persistence')`; `assertNoActiveCompaction` — nessun
  lancio senza storia di compaction, lancio con `compaction/start` non
  accoppiato, nessun lancio dopo `compaction/end`.
  **3 test inizialmente sbagliati** (non il codice): i primi tentativi
  usavano prezzi per-nodo troppo bassi (40 token) rispetto al costo fisso
  del framing del checkpoint (`CHECKPOINT_PREAMBLE` + tag, che nella
  `FakeTokenMeter` euristica arriva a ~108 "token" stimati), facendo
  scattare il rifiuto reale "summary is not smaller than the shadowed
  content" anche nei test che non lo stavano testando. Misurato il costo
  reale del framing con uno script Node ad-hoc, corretti i prezzi finti a
  200/nodo nei test che non riguardano quel rifiuto specifico (lasciato a 1
  nel test che LO testa deliberatamente). Un quarto test aveva
  un'aspettativa dell'ordine eventi incompleta (mancava `compaction/end`
  finale nell'array atteso) — corretta allo stesso modo. In nessun caso è
  stato toccato il codice sorgente per far passare i test: ogni correzione è
  stata nell'aspettativa del test, verificata ritracciando a mano
  l'algoritmo di `transaction.ts`.

**Deliverable verificato:** sì — `npx tsc --noEmit` pulito su tutto
`src/`+`tests/` (con `noUnusedLocals`/`noUnusedParameters` aggiunti al
`tsconfig.json` durante questa fase per catturare import morti — hanno
trovato e fatto correggere due casi reali: import di `toolPairingBalancedAfter/
Before` rimasti in `transaction.ts` dopo lo spostamento della validazione in
`ranges.ts`, e il campo `_replayState` di `BlockAssembler` mai letto dopo
aver tolto il getter `replayState`/`interruptedBlocks()` non usati da
`summarizeWithLlm`, quest'ultimo dichiarato esplicitamente nel commento della
classe). `npx vitest run` verde, 46/46 test passati su 5 file.

**Resta da fare:** Fase 8 (`facade.ts`, `index.ts`) — la fase 7 del
ROADMAP.md originale (`engine.ts` Parte B) è stata assorbita in questa voce
per la ragione spiegata sopra.

**Aggiunta alla stessa voce — test di `BasicCompactionEngine` (ciò che
ROADMAP.md chiamava "fase 7"):** scritto `tests/engine.spec.ts` (11 test):
`compactIfNeeded` — `null` senza richiesta instradata, `null` sotto soglia,
compatta quando la pressione supera la soglia e ricade sotto di essa,
propaga `TargetPressureConfigError` quando il target non ha `contextWindow`
configurato, `context-overflow` ignora la soglia normale, `context-overflow`
restituisce `null` quando non c'è nulla da compattare; `compactNow` —
compatta l'intera sessione, `null` quando non c'è nulla da compattare,
agente occupato classificato `ManualCompactionError('busy')`, segnale già
abortito, esecuzione del `flush` iniettato dopo un commit riuscito.
**2 classi di errore nei primi tentativi dei test, non nel codice:**
1. Avevo scritto `await expect(engine.compactNow(...)).rejects...` per i
   casi "agente occupato" e "segnale già abortito", ma `compactNow` non è
   una funzione `async` (porta fedele della fonte, che dichiara
   esplicitamente "`@throws synchronously when the agent is already
   active`"): un lancio sincrono dentro una funzione non-`async` è un lancio
   sincrono della chiamata stessa, non una promise rifiutata. La chiamata
   quindi lanciava PRIMA che `expect()` potesse anche solo essere invocato,
   facendo fallire il test con l'errore "grezzo" invece che con un'asserzione
   fallita. Corretto usando `expect(() => engine.compactNow(...)).toThrow(...)`
   (che invoca la funzione dentro `expect` e cattura il lancio sincrono),
   verificato ritracciando a mano il corpo non-`async` di `compactNow` in
   `engine.ts`.
2. `selectCompactableRange` con `retainTokens: 0` NON compatta l'intera
   superficie a un solo nodo: il ciclo di accumulo dalla coda processa
   SEMPRE almeno un nodo prima di controllare la condizione di uscita, quindi
   l'ultimo nodo di superficie resta sempre trattenuto per costruzione
   (comportamento della fonte, portato fedelmente in `ranges.ts` alla fase
   4). I test che assumevano "retainTokens:0 su 3 nodi → 1 nodo finale"
   avevano un'aspettativa sbagliata; corretta a 2 nodi finali (l'ultimo nodo
   originale + il nuovo nodo di riassunto) con un commento che spiega il
   perché, dopo aver ritracciato l'algoritmo passo-passo. Due test avevano
   anche dimenticato di instradare una richiesta (`session.setRequestHeader`)
   prima di chiamare `compactNow`, facendo fallire la summarizzazione con
   "no provider/model available" per una ragione indipendente dal codice
   sotto test — aggiunto l'header mancante.
- `npx tsc --noEmit` pulito, `npx vitest run` verde: **57/57 test passati su
  6 file**.

---

## 2026-08-28T02:00Z — Fase 8: `facade.ts`, `index.ts` — COMPLETATA

**Fatto:**
- `src/facade.ts`: `CompactionFacade`, un wrapper operativo che costruisce
  `BasicCompactionEngine` da dipendenze iniettate esplicite
  (`ITokenMeter`/`ILlmService`) ed espone `compactIfNeeded`/`compactNow`/
  `compactRegion`. Non è una porta di
  `packages/compaction/compaction-extracted/src/facade.ts` (quel file, letto
  in fase 0, prende ancora `ctx: Context` di Cordis — deliberatamente non
  seguito, vedi PLAN.md); è costruito sullo stesso intento operativo
  (un oggetto istanziabile direttamente) applicato al VERO motore
  Cordis-free di questo modulo. Dichiarato esplicitamente nel commento di
  testa del file per evitare che sembri una porta 1:1 quando non lo è.
- `src/index.ts`: barrel che ri-esporta l'intera superficie pubblica di
  tutti i moduli (`brand`, `session`, `checkpoint`, `tool-pairing`, `types`,
  `ranges`, `summarizer`, `transaction`, `engine`, `facade`).
- `tests/index.spec.ts` (3 test): import dell'intera superficie pubblica da
  un solo barrel; `CompactionFacade.compactNow` end-to-end (superficie finta
  di 3 messaggi → compattazione riuscita, riassunto presente, superficie
  ridotta); `CompactionFacade.compactIfNeeded` sotto soglia → `null`.
- **Problema di build scoperto e corretto durante questa fase (non un bug di
  logica, un problema di packaging):** `tsc` con `rootDir: "."` (necessario
  per far tipizzare `tests/` nello stesso programma di `src/`) emette sotto
  `lib/src/*` e `lib/tests/*`, non sotto `lib/*` come dichiarato in origine
  in `package.json` (`main`/`exports` puntavano a `lib/index.js`, inesistente).
  Verificato con una build reale (`npx tsc`, non solo `--noEmit`) e
  un'importazione Node ESM diretta del pacchetto compilato
  (`import('./lib/src/index.js')`, costruzione di `CompactionFacade` con
  doppi minimi), che falliva con `ERR_MODULE_NOT_FOUND` prima della
  correzione. Corretto `package.json` (`main`/`types`/`exports` →
  `lib/src/index.{js,d.ts}`). Questo è l'unico modo in cui ho verificato
  DAVVERO il requisito "modulo isolato, importabile... senza Cordis" del
  task a livello di pacchetto compilato, non solo a livello di sorgente
  TypeScript — la build di prova è stata rimossa (`rm -rf lib`) dopo la
  verifica per non lasciare artefatti nella cartella consegnata.

**Deliverable verificato:** sì — `npx tsc --noEmit` pulito su tutto
`src/`+`tests/`; `npx vitest run` verde, **60/60 test passati su 7 file**;
build reale (`npx tsc`) verificata e il pacchetto compilato importato con
successo da uno script Node puro (nessun Cordis, nessun `dsh-*` nel
`node_modules` di questa cartella — solo `typescript`/`vitest`/`@types/node`).

**Resta da fare:** Fase 9 (verifica finale: rilettura delle divergenze
dichiarate contro il codice reale, riepilogo finale).

**Problemi/semplificazioni aperte:** le stesse 3 già annotate alla voce
precedente (fasi 5+6), nessuna nuova introdotta in questa fase.

---

## 2026-08-28T02:20Z — Fase 9: verifica finale — COMPLETATA

**Bug reale trovato e corretto durante questa fase (non logico, ma
d'integrità del file):** cercando ogni marcatore `// TODO(governance)` nel
codice per riverificarli uno a uno contro PLAN.md, `grep`/`ugrep` segnalava
`src/engine.ts` come "file binario" e non trovava nulla. Investigato con
`file(1)` e uno script Python: il file conteneva UN byte NUL letterale
(0x00) a metà della riga `const key = \`${source.provider} ${source.model}\``
dentro `resolveModelPolicies` — quello che nella fonte
(`compaction-basic/src/config.ts`) è testo sorgente per la sequenza di
escape JS ` ` (sei caratteri ASCII: backslash, u, 0, 0, 0, 0) era stato
scritto in questa porta come un vero byte NUL, quasi certamente per un
incidente di codifica durante la scrittura del file con lo strumento Write.
Il file passava comunque `tsc --noEmit` e `vitest run` (Node/V8 tollerano un
NUL dentro un template-literal), quindi il problema non era mai emerso nei
controlli di fase precedenti basati solo su compilazione/test — è stato
trovato SOLO perché la fase 9 richiede esplicitamente di ri-verificare i
marcatori di governance con una ricerca testuale sul codice. Corretto
sostituendo il byte NUL con la sequenza di escape testuale ` ` (stessa
rappresentazione letterale della fonte); verificato con uno script Python
che nessun altro file in `src/`/`tests/` ha lo stesso problema; rilanciato
`tsc --noEmit` e `vitest run` dopo la correzione — entrambi ancora puliti
(60/60 test verdi, nessuna regressione).

**Rilettura delle 4 divergenze dichiarate in PLAN.md contro il codice reale:**
1. Wiring automatico Cordis non portato — confermato: `// TODO(governance)`
   presente in `src/engine.ts` alle righe del doc-comment del modulo, del
   campo `maxOverflowRetries`, del campo `auto`, e del doc-comment della
   classe `BasicCompactionEngine` (che riporta l'algoritmo completo da
   riprodurre lato consumer). Aggiunto in questa fase un quinto punto non
   preventivato esplicitamente nel PLAN ma conseguente al #1: un
   `// TODO(governance)` inline dentro `compactIfNeeded`, nel punto esatto
   in cui la fonte chiamava il pruner opzionale prima della selezione del
   range — mancava un riferimento a livello di codice (solo
   PROGRAM_STATE.md lo documentava finora), corretto per non lasciarlo
   silenzioso nel file sorgente stesso.
2. `flush` iniettato al posto di `ctx.sessions.flush` — confermato: campo
   `flush?` documentato su `ManualCompactAgentContext` in `engine.ts`, letto
   in `compactNow` (`...agent.flush === undefined ? {} : { flush: agent.flush }`).
3. Consolidamento fisico di più package in `brand.ts`/`session.ts` —
   confermato nei commenti di testa di entrambi i file.
4. `SessionEventMap` unica invece di declaration merging cross-package —
   confermato nel commento di testa della sezione in `session.ts`.
   Nessuna divergenza dichiarata risulta contraddetta dal codice; nessuna
   nuova semplificazione silenziosa trovata oltre al bug del byte NUL sopra
   (che non era una semplificazione di logica, solo un difetto di codifica
   del file, ora corretto).

**Verifica finale end-to-end (ripetuta da zero):**
- `rm -rf node_modules lib && npm install` → pulito.
- `npx tsc --noEmit` → pulito.
- `npx tsc` (build reale, non solo `--noEmit`) → pulito; pacchetto compilato
  sotto `lib/src/` importato con successo da uno script Node ESM puro
  (nessuna dipendenza `@deepseek-ai/*`/Cordis in `node_modules` di questa
  cartella — solo `typescript`, `vitest`, `@types/node`), `CompactionFacade`
  istanziata e usabile.
- `npx vitest run` → verde, **60/60 test passati su 7 file**
  (`tool-pairing.spec.ts` 5, `ranges.spec.ts` 9, `summarizer.spec.ts` 7,
  `engine-config.spec.ts` 12, `transaction.spec.ts` 13, `engine.spec.ts` 11,
  `index.spec.ts` 3).
- Artefatto di build (`lib/`) rimosso dopo la verifica per non lasciare
  output generato nella cartella consegnata.
- Elenco file prodotto in `src/` confrontato 1:1 con l'elenco atteso di
  TASK.md: `brand.ts`, `types.ts`, `checkpoint.ts`, `session.ts`,
  `tool-pairing.ts`, `ranges.ts`, `transaction.ts`, `summarizer.ts`,
  `engine.ts`, `facade.ts`, `index.ts` — tutti presenti, nessuno mancante,
  nessuno extra.

## Riepilogo finale

**Fasi completate:** tutte e 9 (le fasi 5-6-7 del ROADMAP.md originale sono
state eseguite e verificate come un unico blocco per la ragione dichiarata
nella loro voce di log, non saltate).

**Cosa NON è stato portato, e perché (tutto dichiarato PRIMA di scrivere
codice in PLAN.md, poi rispettato):**
1. Il wiring automatico Cordis (`ctx.on('agent/pre-step'|'agent/status'|
   'session/event'|'agent/request-error', ...)`) — non esiste un event bus
   equivalente Cordis-free nella fonte da portare fedelmente; la logica di
   DECISIONE che quegli hook chiamavano è però interamente portata e
   direttamente richiamabile (`compactIfNeeded`), con l'algoritmo esatto da
   ri-cablare documentato nel doc-comment di `BasicCompactionEngine`.
2. Il companion `compaction-tool-result-pruner` — esplicitamente opzionale
   in TASK.md e assente dal suo elenco file atteso; l'unico punto
   d'estensione perso è la chiamata di prune facoltativa dentro
   `compactIfNeeded`, ora marcata inline.
3. `ctx.sessions.flush` sostituito da un campo iniettato
   (`ManualCompactAgentContext.flush`) — il meccanismo di transazione
   (`options.flush?: () => Promise<void>`) era già disaccoppiato nella
   fonte stessa; cambia solo la provenienza del callback.
4. Lo schema di validazione `schemastery` parallelo di `compaction-basic` —
   serviva solo al loader/UI di configurazione di Cordis; la validazione
   REALE (le funzioni `assert*`/`validate*` che la fonte chiama comunque) è
   portata identica.

**Tempo impiegato:** una sessione di lavoro continua (circa 9 fasi, lettura
approfondita della fonte prima di ogni file, scrittura, verifica
`tsc`+`vitest` ad ogni fase, correzioni quando i test iniziali avevano
aspettative sbagliate).

**Self-assessment onesto:**
- *Fedeltà alla fonte:* alta. Ogni funzione pubblica del modulo estratto ha
  una controparte 1:1 identificabile nella fonte, con lo stesso algoritmo;
  le uniche divergenze sono le 4 dichiarate esplicitamente in PLAN.md PRIMA
  di scrivere codice (mai emerse a sorpresa durante l'implementazione), più
  una quinta conseguenza minore (omissione della chiamata al pruner) anch'essa
  dichiarata.
- *Correttezza:* alta ma non certificata da un confronto diretto con un
  processo `dsh` reale (non richiesto dal task, e comunque impossibile
  restando Cordis-free) — la garanzia qui è "stesso algoritmo, stessi
  branch, stesse condizioni di errore", verificata a mano riga per riga
  durante il porting e poi con 60 test unitari propri (non portati dalla
  fonte, scritti da zero contro le interfacce iniettate). Diversi test hanno
  rivelato ERRORI DI ASPETTATIVA nei test stessi durante la scrittura (mai
  nel codice sorgente portato) — ogni caso è stato ritracciato a mano
  sull'algoritmo prima di correggere il test, mai il codice per "far
  passare" un test.
- *Limite più importante:* la sezione "wiring automatico" non è testabile
  come tale (perché non esiste), quindi la fedeltà lì si ferma
  necessariamente alla documentazione dell'algoritmo nel commento della
  classe — un consumer reale dovrà implementare quel pezzo e verificarlo
  contro il proprio agent loop, cosa che questo modulo isolato non può fare
  al posto suo.
- *Incidente di processo degno di nota:* il bug del byte NUL (vedi sopra) è
  la prova che un controllo positivo (compilazione+test verdi) non basta da
  solo a garantire l'integrità letterale di un file generato per parti da
  uno strumento di editing — la fase di verifica finale esplicitamente
  dedicata alla rilettura dei marcatori di governance lo ha intercettato
  prima della consegna.

---

**Problemi/semplificazioni aperte:**
1. `auto`/`maxOverflowRetries` inerti (PLAN.md divergenza #1), marcati
   `// TODO(governance)` nel codice.
2. `compactIfNeeded` non chiama un pruner opzionale (conseguenza
   dell'esclusione dichiarata del companion `compaction-tool-result-pruner`).
3. `ManualCompactAgentContext.flush` sostituisce `ctx.sessions.flush`
   (PLAN.md divergenza #2), marcato nel doc-comment dell'interfaccia.

---
