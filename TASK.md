> **Experimental artifact**
>
> This is the original task exactly as delivered to the candidates.
> It is preserved verbatim in Italian to maintain the integrity and
> reproducibility of the experiment. See `TRANSLATION_POLICY.md`.

# Task: estrarre il sistema di compaction di DeepSeek Harness in un modulo isolato

## Obiettivo

Estrai il sistema di compaction di DeepSeek Harness (repo sorgente:
`/home/lux-ai/Scaricati/deepseek-harness/packages/compaction/`) in un modulo
TypeScript isolato, importabile e testabile senza Cordis, dentro questa
cartella (`extracted-compaction-sonnet5/`).

Fedeltà alla fonte: studia come deepseek-harness implementa OGGI tool-pairing,
selezione del range compattabile, la transazione di compaction (start →
summary → replace → end) e la summarization via LLM — non inventare una logica
alternativa. Se una parte della fonte non può essere seguita fedelmente
(troppo accoppiata a Cordis, a `dsh-session`, ecc.), fermati e scrivilo
esplicitamente in `PROGRAM_STATE.md` prima di divergere — mai in silenzio.

File sorgente di riferimento (leggili prima di scrivere codice):
- `packages/compaction/compaction/src/index.ts`, `types.ts`, `checkpoint.ts`,
  `tool-pairing.ts`, `brand.ts`
- `packages/compaction/compaction-basic/src/index.ts`, `region.ts`,
  `summarizer.ts`, `config.ts`, `types.ts`
- `packages/compaction/compaction-tool-result-pruner/` (companion, opzionale)

## Regole di governance minime (obbligatorie, in quest'ordine)

1. **Prima di scrivere qualsiasi file in `src/`**, crea questi tre file nella
   root di questa cartella:
   - `PLAN.md` — approccio, elenco dei file che produrrai, dipendenze tra
     loro, come dividerai il lavoro in fasi.
   - `ROADMAP.md` — fasi numerate, ciascuna con obiettivo e deliverable
     verificabile (checklist).
   - `PROGRAM_STATE.md` — log di stato, **append-only**: ogni voce ha
     timestamp, fase corrente, cosa hai fatto, cosa resta, eventuali problemi
     o semplificazioni lasciate aperte.

2. **Una fase per volta.** Non passare alla fase successiva finché la
   precedente non è completa e annotata in `PROGRAM_STATE.md`.

3. **Niente stub silenziosi.** Se una parte della logica è semplificata o non
   ancora reale (es. un conteggio finto, un valore hardcoded al posto di una
   misura reale), va segnata esplicitamente con `// TODO(governance): ...` nel
   codice E annotata in `PROGRAM_STATE.md` come incompleta — mai lasciata come
   se fosse finita e corretta.

4. **Un file, una responsabilità coerente con la fonte.** Se riscrivi un file
   già esistente, SOSTITUISCI il contenuto vecchio per intero — non appenderlo
   sotto quello nuovo (niente contenuto duplicato/concatenato).

5. **Verifica prima di dichiarare una fase completa.** Controlla la coerenza
   dei tipi tra i file toccati (idealmente con `tsc --noEmit`, se disponibile)
   prima di segnare una fase come fatta in `PROGRAM_STATE.md`.

6. Aggiorna `PROGRAM_STATE.md` ad ogni passo significativo, non solo a fine
   lavoro — è il file che verrà letto per controllare i tuoi progressi.

## Deliverable finale atteso

```
PLAN.md
ROADMAP.md
PROGRAM_STATE.md
package.json
src/
  brand.ts
  types.ts
  checkpoint.ts
  session.ts          # interfacce minime ISession/ITokenMeter ecc.
  tool-pairing.ts
  ranges.ts            # selectCompactableRange, validateRangeSelection
  transaction.ts       # compactSurfaceRegion, assertNoActiveCompaction
  summarizer.ts
  engine.ts
  facade.ts
  index.ts
tests/
```

Il modulo deve rimanere importabile senza Cordis: tutte le dipendenze esterne
(session, token meter, LLM) vanno iniettate via interfacce minime, non
importate direttamente dal core di deepseek-harness.
