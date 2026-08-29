import { describe, expect, it } from 'vitest'
import { FakeLLM, FakeMeter, FakeSession, userMessage } from './fakes.ts'
import { BasicCompactionEngine } from '../src/engine.ts'
import { CompactionFacade } from '../src/facade.ts'
import type { CompactionAgentContext, ManualCompactAgentContext } from '../src/session.ts'

function makeAgent(session: FakeSession): CompactionAgentContext {
  return { session, options: {} }
}

function makeManualAgent(session: FakeSession): ManualCompactAgentContext {
  return {
    session,
    options: {},
    runMaintenance: async (task) => task(new AbortController().signal),
  }
}

describe('CompactionFacade', () => {
  it('delegates compactIfNeeded to the engine', async () => {
    const session = new FakeSession('fake-0001', { config: { provider: 'p', model: 'm' } })
    session.append('user/message', userMessage('hello'), { surfaceOp: 'append' })

    const engine = new BasicCompactionEngine({
      config: { thresholdRatio: 0.8, retainRatio: 0.5 },
      meter: new FakeMeter(10, 10),
      llm: new FakeLLM(1000),
    })
    const facade = new CompactionFacade(engine)

    const result = await facade.compactIfNeeded('pressure', makeAgent(session), new AbortController().signal)
    expect(result).toBeNull()
  })

  it('delegates compactRegion to the engine', async () => {
    const session = new FakeSession('fake-0001', { config: { provider: 'p', model: 'm' } })
    session.append('turn/start', { turn: 1 })
    for (let i = 0; i < 5; i++) {
      session.append('user/message', userMessage(`msg ${i}`), { surfaceOp: 'append' })
    }

    const engine = new BasicCompactionEngine({
      config: { thresholdRatio: 0.8, retainRatio: 0.5, summarizationProvider: 'p', summarizationModel: 'm' },
      meter: new FakeMeter(100, 500),
      llm: new FakeLLM(1000, [
        { type: 'block-start', index: 0, blockType: 'text' },
        { type: 'text-delta', index: 0, text: 's' },
        { type: 'block-end', index: 0, block: { type: 'text', text: 's' } },
        { type: 'finish', reason: { kind: 'stop' } },
      ]),
    })
    const facade = new CompactionFacade(engine)

    // Surface nodes are seqs 1-5 (the user messages), so compact 1-3
    const result = await facade.compactRegion(1, 3, makeAgent(session), new AbortController().signal)
    expect(result).not.toBeNull()
    expect(result?.summary).toEqual([{ type: 'text', text: 's' }])
  })

  it('delegates compactNow to the engine', async () => {
    const session = new FakeSession('fake-0001', { config: { provider: 'p', model: 'm' } })
    session.append('user/message', userMessage('hello'), { surfaceOp: 'append' })

    const engine = new BasicCompactionEngine({
      meter: new FakeMeter(0, 10),
      llm: new FakeLLM(1000),
    })
    const facade = new CompactionFacade(engine)

    const result = await facade.compactNow(makeManualAgent(session), new AbortController().signal)
    expect(result).toBeNull()
  })

  it('throws when engine does not support compactNow', async () => {
    const engine = {
      compactIfNeeded: async () => null,
      compactRegion: async () => { throw new Error('not implemented') },
    }
    const facade = new CompactionFacade(engine)

    const session = new FakeSession()
    await expect(
      facade.compactNow(makeManualAgent(session), new AbortController().signal),
    ).rejects.toThrow('engine does not support compactNow')
  })
})
