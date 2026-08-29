import { describe, expect, it } from 'vitest'
import { BasicCompactionEngine, ManualCompactionError } from '../src/engine.js'
import type { ManualCompactAgentContext } from '../src/engine.js'
import type { GenerateOptions, ILlmService, LlmResolvedModelInfo, StreamChunk } from '../src/session.js'
import { FakeSession } from './fake-session.js'
import { FakeTokenMeter } from './fake-token-meter.js'

// A summary long enough (after checkpoint framing) to stay below whatever
// shadowed-content price the test sets up, so the transaction's shrink check
// never fires accidentally. See PROGRAM_STATE.md's fase 5+6 entry for the
// measured ~108-"token" fixed floor of the checkpoint framing under
// `FakeTokenMeter`'s heuristic.
function textStream(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

class FakeLlm implements ILlmService {
  callCount = 0
  constructor(private readonly contextWindow: number, private readonly summaryText = 'condensed checkpoint') {}

  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.callCount += 1
    for (const chunk of textStream(this.summaryText)) yield chunk
  }

  async resolveModelInfo(): Promise<LlmResolvedModelInfo> {
    return { provider: 'p', id: 'm', name: 'm', context: { contextWindow: this.contextWindow } }
  }
}

function routedSession(nodeCount: number, tokensPerNode: number): { session: FakeSession; meter: FakeTokenMeter } {
  const session = new FakeSession()
  session.append('turn/start', { turn: 0 })
  session.setRequestHeader({ config: { provider: 'p', model: 'm' } })
  const seqs: number[] = []
  for (let i = 0; i < nodeCount; i += 1) seqs.push(session.appendUserText(`message ${i}`).seq)
  const meter = new FakeTokenMeter(new Map(seqs.map(seq => [seq, tokensPerNode])), tokensPerNode)
  return { session, meter }
}

describe('BasicCompactionEngine.compactIfNeeded', () => {
  it('returns null when no request has routed yet (no requestHeader)', async () => {
    const session = new FakeSession()
    const meter = new FakeTokenMeter()
    const llm = new FakeLlm(1000)
    const engine = new BasicCompactionEngine(meter, llm)
    const result = await engine.compactIfNeeded({ session, options: {} }, 'pressure', new AbortController().signal)
    expect(result).toBeNull()
  })

  it('returns null when pressure is below threshold', async () => {
    const { session, meter } = routedSession(3, 10) // 30 tokens total
    const llm = new FakeLlm(1000) // threshold = 800
    const engine = new BasicCompactionEngine(meter, llm)
    const result = await engine.compactIfNeeded({ session, options: {} }, 'pressure', new AbortController().signal)
    expect(result).toBeNull()
    expect(llm.callCount).toBe(0)
  })

  it('compacts once pressure crosses threshold and drops back below it', async () => {
    // contextWindow 100 -> thresholdTokens = 80, default retainRatio 0.16 -> retainTokens = 16.
    const { session, meter } = routedSession(10, 30) // 300 tokens total, well above 80
    const llm = new FakeLlm(100)
    const engine = new BasicCompactionEngine(meter, llm, { retainTokens: 0, compactionRetries: 5 })
    const result = await engine.compactIfNeeded({ session, options: {} }, 'pressure', new AbortController().signal)
    expect(result).not.toBeNull()
    expect(llm.callCount).toBeGreaterThan(0)
    // After compacting, remeasure: the fake meter prices the surviving nodes
    // at the configured per-seq cost (untouched for the retained tail) plus
    // the fake replacement message at its default cost.
    const finalMeasurement = meter.measure(session)
    expect(finalMeasurement.totalTokens).toBeLessThan(80)
  })

  it('throws when the routed target has no configured context capacity', async () => {
    const { session, meter } = routedSession(3, 100)
    const llm: ILlmService = {
      async *stream() { /* never called */ },
      async resolveModelInfo(): Promise<LlmResolvedModelInfo> {
        return { provider: 'p', id: 'm', name: 'm' } // no `context`
      },
    }
    const engine = new BasicCompactionEngine(meter, llm)
    await expect(engine.compactIfNeeded({ session, options: {} }, 'pressure', new AbortController().signal))
      .rejects.toThrow(/no context capacity/)
  })

  it('context-overflow ignores the normal threshold and compacts down to the retained tail', async () => {
    // Per-node cost high enough that the shadowed span's price clears the
    // checkpoint framing's fixed floor (~110 "tokens" under FakeTokenMeter's
    // heuristic; see PROGRAM_STATE.md's fase 5+6 entry).
    const { session, meter } = routedSession(3, 200)
    const llm = new FakeLlm(1000)
    const engine = new BasicCompactionEngine(meter, llm, { retainTokens: 0 })
    const result = await engine.compactIfNeeded({ session, options: {} }, 'context-overflow', new AbortController().signal)
    expect(result).not.toBeNull()
    // `selectCompactableRange`'s tail-accumulation loop always processes at
    // least one node before checking `retainTokens`, so even `retainTokens: 0`
    // leaves the last surface node untouched: one pass over 3 nodes replaces
    // the first 2 with a summary and keeps the 3rd, landing 2 surface nodes.
    expect(session.surface.nodes).toHaveLength(2)
  })

  it('returns null for context-overflow when nothing is left to compact', async () => {
    const session = new FakeSession()
    session.setRequestHeader({ config: { provider: 'p', model: 'm' } })
    const meter = new FakeTokenMeter()
    const llm = new FakeLlm(1000)
    const engine = new BasicCompactionEngine(meter, llm)
    const result = await engine.compactIfNeeded({ session, options: {} }, 'context-overflow', new AbortController().signal)
    expect(result).toBeNull()
  })
})

describe('BasicCompactionEngine.compactNow', () => {
  function idleAgent(session: FakeSession, extra: Partial<ManualCompactAgentContext> = {}): ManualCompactAgentContext {
    return {
      session,
      options: {},
      async runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
        return task(new AbortController().signal)
      },
      ...extra,
    }
  }

  it('compacts the whole session down to one checkpoint and returns the result', async () => {
    const session = new FakeSession()
    // A summarization target must be resolvable somehow; here via the
    // routed request header (matches `summarizeWithLlm`'s fallback order).
    session.setRequestHeader({ config: { provider: 'p', model: 'm' } })
    const seqs = [0, 1, 2].map(() => session.appendUserText('long enough message to be worth compacting').seq)
    const meter = new FakeTokenMeter(new Map(seqs.map(seq => [seq, 200])))
    const llm = new FakeLlm(1000)
    const engine = new BasicCompactionEngine(meter, llm)

    const result = await engine.compactNow(idleAgent(session), new AbortController().signal)
    expect(result).not.toBeNull()
    // Same reasoning as the context-overflow test above: `compactNow` also
    // selects with `retainTokens: 0`, which still keeps the last node.
    expect(session.surface.nodes).toHaveLength(2)
  })

  it('returns null when there is nothing to compact', async () => {
    const session = new FakeSession()
    const meter = new FakeTokenMeter()
    const llm = new FakeLlm(1000)
    const engine = new BasicCompactionEngine(meter, llm)
    const result = await engine.compactNow(idleAgent(session), new AbortController().signal)
    expect(result).toBeNull()
  })

  it('wraps a busy agent (runMaintenance throws synchronously) as ManualCompactionError("busy")', () => {
    // `compactNow` is itself synchronous (matches the source: "@throws
    // synchronously when the agent is already active"), so a busy
    // `runMaintenance` makes `compactNow` throw synchronously too — not a
    // rejected promise. Assert on the synchronous call, not `.rejects`.
    const session = new FakeSession()
    session.appendUserText('x')
    const meter = new FakeTokenMeter()
    const llm = new FakeLlm(1000)
    const engine = new BasicCompactionEngine(meter, llm)
    const agent: ManualCompactAgentContext = {
      session,
      options: {},
      runMaintenance() {
        throw new Error('agent is busy')
      },
    }
    expect(() => engine.compactNow(agent, new AbortController().signal)).toThrow(ManualCompactionError)
    try {
      engine.compactNow(agent, new AbortController().signal)
      expect.unreachable('compactNow should have thrown')
    } catch (error) {
      expect((error as ManualCompactionError).code).toBe('busy')
    }
  })

  it('rejects synchronously on an already-aborted signal', () => {
    // `signal.throwIfAborted()` runs before any `await`, so this is a
    // synchronous throw from `compactNow` itself, same reasoning as above.
    const session = new FakeSession()
    const meter = new FakeTokenMeter()
    const llm = new FakeLlm(1000)
    const engine = new BasicCompactionEngine(meter, llm)
    const controller = new AbortController()
    controller.abort()
    expect(() => engine.compactNow(idleAgent(session), controller.signal)).toThrow()
  })

  it('runs the injected flush after a successful manual commit', async () => {
    const session = new FakeSession()
    session.setRequestHeader({ config: { provider: 'p', model: 'm' } })
    const seqs = [0, 1].map(() => session.appendUserText('message worth compacting, long enough').seq)
    const meter = new FakeTokenMeter(new Map(seqs.map(seq => [seq, 200])))
    const llm = new FakeLlm(1000)
    const engine = new BasicCompactionEngine(meter, llm)
    let flushed = false
    const agent = idleAgent(session, { flush: async () => { flushed = true } })
    await engine.compactNow(agent, new AbortController().signal)
    expect(flushed).toBe(true)
  })
})
