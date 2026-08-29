# PLAN — estrazione del sistema di compaction di DeepSeek Harness

## Fonte studiata

Letti per intero prima di scrivere questo piano:

- `packages/compaction/compaction/src/{index,types,checkpoint,tool-pairing,brand}.ts`
- `packages/compaction/compaction-basic/src/{index,region,summarizer,config,types}.ts`
- `packages/compaction/compaction-tool-result-pruner/src/index.ts` (companion, opzionale)
- Dipendenze minime necessarie a capire le interfacce iniettate:
  - `packages/util/brand/src/index.ts` (`Branded<B>`)
  - `packages/interaction/commands/src/brand.ts` (`CommandId`)
  - `packages/core/session/src/index.ts` e `surface.ts` (classe `Session`: `events`,
    `surface.{nodes,replaceGeneration}`, `append()`, `requestHeader()`,
    `deriveEventMessage()`, `id`) e `types.ts` (`SessionEvent`, `SessionEventMap`,
    `SurfaceOp`, `SurfaceIntent`, `EpochHeader`)
  - `packages/llm/token-meter/src/{index,types}.ts` (`TokenMeter.measure()`,
    `.estimateMessage()`, `TokenMeasurement`, `TokenSurfaceNode`)
  - `packages/llm/llm/src/{types,message,content,assembler,error,call-config,never}.ts`
    (`ContentBlock*`, `Message*`, `MessageSource`, `GenerateOptions`, `StreamChunk`,
    `FinishReason`, `LlmCallConfig`, `BlockAssembler`, `errorChain`, `LlmError`/
    `HarnessError`, `deepFreeze`, `assertNever`, `CONTEXT_WINDOW_EXCEEDED_CODE`)
  - `packages/compaction/compaction-extracted/src/{index,facade}.ts` — un tentativo
    GIÀ presente nel repo reale che re-esporta le classi Cordis-based dietro una
    `CompactionFacade`. Letto per contesto, ma **non è la fonte da seguire**: il
    suo `facade.ts` prende ancora un `ctx: Context` di Cordis nel costruttore
    (`new BasicCompactionEngine(ctx, engineConfig)`), quindi non soddisfa il
    requisito del task ("importabile e testabile senza Cordis"). Diverge da
    questo tentativo deliberatamente: le interfacce iniettate (`ISession`,
    `ITokenMeter`, `ILlmService`) sono la fonte di verità qui, non
    `compaction-extracted`.

## Approccio

Portare fedelmente la logica di dominio (tool-pairing, selezione range,
transazione start→summary→replace→end, summarizzazione LLM one-shot,
risoluzione configurazione) rimuovendo SOLO l'accoppiamento a Cordis
(`Service`, `Context`, `ctx.on(...)`, `ctx.get(...)`, `static inject`,
`z.object(...)` schemastery) e a `dsh-session`/`dsh-llm`/`dsh-token-meter`
concreti, sostituendoli con interfacce minime iniettate (`ISession`,
`ITokenMeter`, `ILlmService`) che riproducono ESATTAMENTE la superficie che
il codice di compaction usa realmente (verificato leggendo ogni call site).

Non si inventa logica alternativa: ogni funzione pubblica del modulo estratto
ha una funzione sorgente 1:1 identificabile in uno dei file sopra, con lo
stesso algoritmo. Le uniche differenze intenzionali sono elencate sotto
"Divergenze esplicite dalla fonte" e verranno ripetute in PROGRAM_STATE.md
nella fase in cui vengono introdotte.

## Divergenze esplicite dalla fonte (dichiarate PRIMA di scrivere codice)

1. **Wiring automatico Cordis-based rimosso.**
   `BasicCompactionEngine._registerAutomaticCompaction()` (in
   `compaction-basic/src/index.ts`) sottoscrive `ctx.on('agent/pre-step', ...)`,
   `ctx.on('agent/status', ...)`, `ctx.on('session/event', ...)`,
   `ctx.on('agent/request-error', ...)` sull'event bus di Cordis. Non esiste
   un equivalente Cordis-free praticabile senza inventare un event bus non
   presente nella fonte. L'algoritmo di DECISIONE (quando compattare, quanti
   retry, come reagire a `CONTEXT_WINDOW_EXCEEDED_CODE`) resta interamente
   portato in `compactIfNeeded`/`compactNow`/`compactRegion`; a mancare è SOLO
   il punto di aggancio automatico agli eventi dell'agent loop. Il consumer
   del modulo estratto deve chiamare `compactIfNeeded(...)` esplicitamente dal
   proprio pre-step hook e dal proprio gestore di request-error, seguendo
   l'algoritmo documentato in ROADMAP.md/PROGRAM_STATE.md alla fase in cui
   `engine.ts` viene scritto. Il campo di configurazione `auto` resta nel tipo
   per fedeltà di forma ma è inerte (marcato `// TODO(governance)`), e
   `maxOverflowRetries` resta nel tipo risolto ma nessun loop nel modulo lo
   consuma automaticamente.

2. **`compactNow`'s `flush` non viene più da `ctx.sessions.flush(session)`.**
   Nella fonte, `compactNow` passa
   `flush: async () => { await this.ctx.sessions.flush(agent.session) }` alla
   transazione. Senza un `SessionStore` Cordis, il meccanismo di transazione
   resta IDENTICO (`options.flush?: () => Promise<void>` già disaccoppiato
   nella fonte stessa), ma la sorgente del callback diventa un campo opzionale
   `flush?: () => Promise<void>` su `ManualCompactAgentContext` iniettato dal
   chiamante, invece di essere ricavato da un servizio Cordis globale.

3. **Consolidamento di più package sorgente in meno file.** La fonte reale
   divide i tipi/brand tra 4 package (`dsh-brand`, `dsh-llm/brand`,
   `dsh-commands/brand`, `dsh-compaction/brand`) e la vocabolario
   session/LLM tra `dsh-session`, `dsh-llm`, `dsh-token-meter`. Qui, essendo
   un modulo isolato monopackage, tutti i brand confluiscono in `brand.ts` e
   tutta la vocabolario iniettata (session/token-meter/LLM/messaggi/content
   block) confluisce in `session.ts`, come richiesto esplicitamente dal
   deliverable del task ("interfacce minime ISession/ITokenMeter ecc.").
   Nessuna logica cambia: è solo riorganizzazione fisica dei file dettata
   dall'assenza di un sistema multi-package.
   Analogamente, il pruner di tool-result (`compaction-tool-result-pruner`)
   resta ESPLICITAMENTE fuori dal deliverable richiesto (non è nell'elenco
   file atteso di TASK.md) — è citato come "companion, opzionale" nella
   fonte stessa. `engine.ts` mantiene il punto di estensione (hook
   `summarize()` dinamicamente dispatchato, oltre a un parametro opzionale
   iniettabile per un futuro pruner) ma non porta l'implementazione del
   pruner.

4. **La deduplicazione di declaration-merging non è portabile 1:1.** La
   fonte usa TypeScript declaration merging cross-package
   (`declare module '@deepseek-ai/dsh-session/types' { interface
   SessionEventMap { 'compaction/start': ... } }`) per aggiungere gli eventi
   di compaction al log di sessione reale. Qui non esiste un secondo
   package `dsh-session` da "riaprire": `SessionEventMap` è definita una
   sola volta in `session.ts`, già comprensiva sia degli eventi di sessione
   generici sia degli eventi `compaction/*`, con le stesse identiche forme
   di payload della fonte.

## File da produrre e dipendenze tra loro

```
brand.ts        -> (nessuna dipendenza interna)
session.ts       -> brand.ts
checkpoint.ts     -> brand.ts, session.ts
tool-pairing.ts   -> session.ts
types.ts          -> brand.ts, session.ts
ranges.ts         -> session.ts, tool-pairing.ts
summarizer.ts     -> session.ts
engine.ts         -> brand.ts, session.ts, types.ts, ranges.ts, summarizer.ts, transaction.ts
transaction.ts    -> brand.ts, session.ts, checkpoint.ts, tool-pairing.ts, ranges.ts,
                     summarizer.ts, types.ts, engine.ts (solo per ManualCompactionError,
                     import ciclico risolto: usato solo dentro corpi di funzione, mai a
                     top-level di modulo — pattern ESM sicuro)
facade.ts         -> engine.ts, session.ts
index.ts          -> re-esporta tutto quanto sopra
tests/*.spec.ts    -> src/* (con implementazioni finte/in-memory di ISession,
                     ITokenMeter, ILlmService)
```

## Divisione in fasi (dettaglio in ROADMAP.md)

Ogni fase produce file che compilano (`tsc --noEmit`) prima di passare alla
successiva; `engine.ts` viene scritto in due passate (Parte A: vocabolario
astratto + config; Parte B: `BasicCompactionEngine` concreto, dopo che
`transaction.ts` esiste) perché `transaction.ts` dipende dalla Parte A e
`engine.ts` Parte B dipende da `transaction.ts`.
