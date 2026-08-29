import { describe, expect, it } from 'vitest'
import {
  CompactionFacade,
  compactCheckpointSource,
  isCompactCheckpointSource,
} from '../src/index.js'
import type { GenerateOptions, ILlmService, LlmResolvedModelInfo, StreamChunk } from '../src/index.js'
import { FakeSession } from './fake-session.js'
import { FakeTokenMeter } from './fake-token-meter.js'

class FakeLlm implements ILlmService {
  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'condensed via facade' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'condensed via facade' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }

  async resolveModelInfo(): Promise<LlmResolvedModelInfo> {
    return { provider: 'p', id: 'm', name: 'm', context: { contextWindow: 1000 } }
  }
}

describe('package entry point (index.ts)', () => {
  it('imports the whole public surface from one barrel', () => {
    expect(typeof CompactionFacade).toBe('function')
    expect(typeof compactCheckpointSource).toBe('function')
    expect(typeof isCompactCheckpointSource).toBe('function')
  })

  it('CompactionFacade drives a full manual compaction end to end', async () => {
    const session = new FakeSession()
    session.setRequestHeader({ config: { provider: 'p', model: 'm' } })
    const seqs = [0, 1, 2].map(() => session.appendUserText('a message worth compacting, long enough to price well').seq)
    const meter = new FakeTokenMeter(new Map(seqs.map(seq => [seq, 200])))
    const llm = new FakeLlm()

    const facade = new CompactionFacade(meter, llm)
    const result = await facade.compactNow(
      {
        session,
        options: {},
        async runMaintenance(task) {
          return task(new AbortController().signal)
        },
      },
      new AbortController().signal,
    )

    expect(result).not.toBeNull()
    expect(result?.summary).toEqual([{ type: 'text', text: 'condensed via facade' }])
    expect(session.surface.nodes.length).toBeLessThan(3)
  })

  it('CompactionFacade.compactIfNeeded returns null below pressure threshold', async () => {
    const session = new FakeSession()
    session.setRequestHeader({ config: { provider: 'p', model: 'm' } })
    session.appendUserText('short')
    const meter = new FakeTokenMeter(new Map(), 5)
    const facade = new CompactionFacade(meter, new FakeLlm())
    const result = await facade.compactIfNeeded({ session, options: {} }, 'pressure', new AbortController().signal)
    expect(result).toBeNull()
  })
})
