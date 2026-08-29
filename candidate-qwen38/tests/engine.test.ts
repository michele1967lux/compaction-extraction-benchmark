import { describe, expect, it } from 'vitest'
import { FakeLLM, FakeMeter, FakeSession, userMessage } from './fakes.ts'
import { BasicCompactionEngine } from '../src/engine.ts'
import { ManualCompactionError } from '../src/types.ts'
import type { CompactionAgentContext, ManualCompactAgentContext, ITokenMeter, TokenMeasurement, Message } from '../src/session.ts'

function makeAgent(session: FakeSession, options: { provider?: string; model?: string } = {}): CompactionAgentContext {
  return { session, options }
}

function makeManualAgent(session: FakeSession): ManualCompactAgentContext {
  return {
    session,
    options: {},
    runMaintenance: async (task) => task(new AbortController().signal),
  }
}

function makeSessionWithHeader(provider = 'p', model = 'm'): FakeSession {
  return new FakeSession('fake-0001', { config: { provider, model } })
}

/** Meter that returns a lower total after the first measure call. */
class DynamicMeter implements ITokenMeter {
  private calls = 0
  constructor(
    private readonly initialTokens: number,
    private readonly afterTokens: number,
    private readonly perNodeTokens: number = 500,
  ) {}

  measure(session: FakeSession): TokenMeasurement {
    this.calls += 1
    const total = this.calls === 1 ? this.initialTokens : this.afterTokens
    return {
      totalTokens: total,
      nodes: session.surface.nodes.map(seq => ({
        seq,
        tokens: this.perNodeTokens,
        heuristicTokens: this.perNodeTokens,
      })),
    }
  }

  estimateMessage(message: Message): number {
    let total = 0
    for (const block of message.content) {
      if (block.type === 'text' || block.type === 'reasoning') total += Math.max(1, block.text.length)
      if (block.type === 'tool-call') total += 5
      if (block.type === 'tool-result') total += 2
    }
    return total
  }
}

describe('BasicCompactionEngine', () => {
  it('returns null when below threshold', async () => {
    const session = new FakeSession()
    session.append('user/message', userMessage('hello'), { surfaceOp: 'append' })

    const engine = new BasicCompactionEngine({
      config: { thresholdRatio: 0.8, retainRatio: 0.16 },
      meter: new FakeMeter(10, 10),
      llm: new FakeLLM(1000),
    })

    const result = await engine.stepPressureCheck(makeAgent(session), new AbortController().signal)
    expect(result).toBeNull()
  })

  it('compacts when above threshold', async () => {
    const session = makeSessionWithHeader()
    session.append('turn/start', { turn: 1 })
    for (let i = 0; i < 20; i++) {
      session.append('user/message', userMessage(`msg ${i}`), { surfaceOp: 'append' })
    }

    const engine = new BasicCompactionEngine({
      config: { thresholdRatio: 0.8, retainRatio: 0.5, summarizationProvider: 'p', summarizationModel: 'm' },
      meter: new DynamicMeter(900, 100, 500),
      llm: new FakeLLM(1000, [
        { type: 'block-start', index: 0, blockType: 'text' },
        { type: 'text-delta', index: 0, text: 's' },
        { type: 'block-end', index: 0, block: { type: 'text', text: 's' } },
        { type: 'finish', reason: { kind: 'stop' } },
      ]),
    })

    const result = await engine.stepPressureCheck(makeAgent(session), new AbortController().signal)
    expect(result).not.toBeNull()
    expect(result?.summary).toEqual([{ type: 'text', text: 's' }])
  })

  it('throws TargetPressureConfigError when no context window', async () => {
    const session = makeSessionWithHeader()
    session.append('turn/start', { turn: 1 })
    session.append('user/message', userMessage('hello'), { surfaceOp: 'append' })

    const llm = {
      stream: async function* () {},
      resolveModelInfo: async () => ({}),
    }
    const engine = new BasicCompactionEngine({
      config: { thresholdRatio: 0.5, retainRatio: 0.1, summarizationProvider: 'p', summarizationModel: 'm' },
      meter: new FakeMeter(100, 10),
      llm,
    })

    await expect(
      engine.stepPressureCheck(makeAgent(session), new AbortController().signal),
    ).rejects.toThrow('no context capacity')
  })

  it('compactNow returns null when no range', async () => {
    const session = new FakeSession()
    const engine = new BasicCompactionEngine({
      meter: new FakeMeter(0, 10),
      llm: new FakeLLM(1000),
    })

    const result = await engine.compactNow(makeManualAgent(session), new AbortController().signal)
    expect(result).toBeNull()
  })

  it('compactNow throws busy when agent is not idle', async () => {
    const session = new FakeSession()
    const busyAgent: ManualCompactAgentContext = {
      session,
      options: {},
      runMaintenance: () => { throw new Error('agent is busy') },
    }

    const engine = new BasicCompactionEngine({
      meter: new FakeMeter(10, 10),
      llm: new FakeLLM(1000),
    })

    let caught: unknown
    try {
      await engine.compactNow(busyAgent, new AbortController().signal)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ManualCompactionError)
    expect((caught as Error).message).toContain('manual compaction requires an idle agent')
  })

  it('compactNow throws cancelled when aborted', async () => {
    const session = new FakeSession()
    session.append('user/message', userMessage('hello'), { surfaceOp: 'append' })

    const controller = new AbortController()
    controller.abort()

    const engine = new BasicCompactionEngine({
      meter: new FakeMeter(10, 10),
      llm: new FakeLLM(1000),
    })

    let caught: unknown
    try {
      await engine.compactNow(makeManualAgent(session), controller.signal)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeDefined()
  })
})
