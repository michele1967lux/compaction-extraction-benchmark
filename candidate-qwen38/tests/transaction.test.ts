import { describe, expect, it } from 'vitest'
import { CompactionId } from '../src/brand.ts'
import { FakeMeter, FakeSession, userMessage } from './fakes.ts'
import { assertNoActiveCompaction, compactSurfaceRegion } from '../src/transaction.ts'
import { ManualCompactionError } from '../src/types.ts'
import type { SummarizationInput, SummaryResult } from '../src/session.ts'

/** A minimal summarizer that returns a fixed summary. */
function makeSummarizer(summary: string): (input: SummarizationInput, agent: unknown, signal?: AbortSignal) => Promise<SummaryResult> {
  return async () => ({
    summary: [{ type: 'text', text: summary }],
    provider: 'p',
    model: 'm',
    rawOutput: [{ type: 'text', text: summary }],
    llmStreamCall: true,
  })
}

describe('compactSurfaceRegion', () => {
  it('appends start, summary, replace, end in order', async () => {
    const session = new FakeSession()
    session.append('turn/start', { turn: 1 })
    // 10 nodes × 100 tokens = 1000 shadowed tokens
    for (let i = 0; i < 10; i++) {
      session.append('user/message', userMessage(`message number ${i}`), { surfaceOp: 'append' })
    }

    // Custom meter: 100 tokens per node, estimateMessage returns 10 (small summary)
    const meter = {
      totalTokens: 1000,
      nodes: Array.from({ length: 10 }, (_, i) => ({ seq: i + 1, tokens: 100, heuristicTokens: 100 })),
    }
    const result = await compactSurfaceRegion(
      session, 1, 10,
      { session, options: {} },
      { owner: 'current-turn', stability: 'whole-surface' },
      undefined,
      makeSummarizer('short summary'),
      () => meter,
      () => 10, // estimateMessage: small summary
    )

    expect(result.startSeq).toBe(11)
    expect(result.summarySeq).toBe(12)
    expect(result.endSeq).toBe(14)
    expect(result.summary).toEqual([{ type: 'text', text: 'short summary' }])
    expect(result.shadowedRange).toEqual({ start: 1, end: 10 })
    expect(result.shadowedSeqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('throws busy when a compaction is already active', async () => {
    const session = new FakeSession()
    session.append('turn/start', { turn: 1 })
    session.append('user/message', userMessage('hello'), { surfaceOp: 'append' })
    // Simulate an active compaction
    session.append('compaction/start', { compactionId: CompactionId('c1'), turn: 1 })

    await expect(
      compactSurfaceRegion(
        session, 1, 1,
        { session, options: {} },
        { owner: 'current-turn', stability: 'whole-surface' },
        undefined,
        makeSummarizer('s'),
        () => new FakeMeter(10, 10).measure(session),
        (msg) => new FakeMeter(10, 10).estimateMessage(msg),
      ),
    ).rejects.toThrow(ManualCompactionError)
  })

  it('throws busy for manual compaction with an open turn', async () => {
    const session = new FakeSession()
    session.append('turn/start', { turn: 1 })
    session.append('user/message', userMessage('hello'), { surfaceOp: 'append' })

    await expect(
      compactSurfaceRegion(
        session, 1, 1,
        { session, options: {} },
        { owner: null, stability: 'whole-surface' },
        undefined,
        makeSummarizer('s'),
        () => new FakeMeter(10, 10).measure(session),
        (msg) => new FakeMeter(10, 10).estimateMessage(msg),
      ),
    ).rejects.toThrow('manual compaction: the session already has an open turn')
  })

  it('throws when the summary is not smaller', async () => {
    const session = new FakeSession()
    session.append('turn/start', { turn: 1 })
    session.append('user/message', userMessage('hi'), { surfaceOp: 'append' })

    // FakeMeter estimates 2 tokens for 'hi', but the summary is longer
    const meter = new FakeMeter(2, 2)
    await expect(
      compactSurfaceRegion(
        session, 1, 1,
        { session, options: {} },
        { owner: 'current-turn', stability: 'whole-surface' },
        undefined,
        makeSummarizer('a much longer summary that exceeds the original'),
        () => meter.measure(session),
        (msg) => meter.estimateMessage(msg),
      ),
    ).rejects.toThrow('summary is not smaller than the shadowed content')
  })

  it('records the error in compaction/end on failure', async () => {
    const session = new FakeSession()
    session.append('turn/start', { turn: 1 })
    session.append('user/message', userMessage('hello'), { surfaceOp: 'append' })

    const failingSummarizer = async () => { throw new Error('summarizer failed') }
    await expect(
      compactSurfaceRegion(
        session, 1, 1,
        { session, options: {} },
        { owner: 'current-turn', stability: 'whole-surface' },
        undefined,
        failingSummarizer,
        () => new FakeMeter(10, 10).measure(session),
        (msg) => new FakeMeter(10, 10).estimateMessage(msg),
      ),
    ).rejects.toThrow('summarizer failed')

    // The last event should be compaction/end with the error
    const lastEvent = session.events[session.events.length - 1]
    if (lastEvent === undefined) throw new Error('no events')
    expect(lastEvent.type).toBe('compaction/end')
    if (lastEvent.type === 'compaction/end') {
      expect(lastEvent.data.error).toContain('summarizer failed')
    }
  })
})

describe('assertNoActiveCompaction', () => {
  it('throws when a compaction is active', () => {
    const session = new FakeSession()
    session.append('compaction/start', { compactionId: CompactionId('c1'), turn: null })
    expect(() => assertNoActiveCompaction(session, 'test')).toThrow(
      'test: compaction already in progress',
    )
  })

  it('does not throw when no compaction is active', () => {
    const session = new FakeSession()
    expect(() => assertNoActiveCompaction(session, 'test')).not.toThrow()
  })
})
