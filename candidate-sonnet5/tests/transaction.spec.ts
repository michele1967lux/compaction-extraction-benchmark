import { describe, expect, it, vi } from 'vitest'
import { assertNoActiveCompaction, compactSurfaceRegion } from '../src/transaction.js'
import type { RegionDependencies } from '../src/transaction.js'
import { ManualCompactionError } from '../src/engine.js'
import type { SummaryResult } from '../src/summarizer.js'
import { FakeSession } from './fake-session.js'
import { FakeTokenMeter } from './fake-token-meter.js'

function stubSummary(text: string): SummaryResult {
  return { summary: [{ type: 'text', text }], provider: 'p', model: 'm' }
}

function deps(meter: FakeTokenMeter, summarize: RegionDependencies['summarize']): RegionDependencies {
  return { meter, summarize }
}

describe('compactSurfaceRegion', () => {
  it('runs start -> summary -> replace -> end for an automatic (current-turn) compaction', async () => {
    const session = new FakeSession()
    session.append('turn/start', { turn: 0 })
    const a = session.appendUserText('long message one').seq
    const b = session.appendUserText('long message two').seq
    const meter = new FakeTokenMeter(new Map([[a, 200], [b, 200]]))
    const agent = { session, options: {} }

    const result = await compactSurfaceRegion(
      deps(meter, async () => stubSummary('condensed')),
      session,
      a,
      b,
      agent,
      { owner: 'current-turn', stability: 'whole-surface' },
    )

    expect(result.shadowedSeqs).toEqual([a, b])
    expect(result.shadowedRange).toEqual({ start: a, end: b })
    expect(result.summary).toEqual([{ type: 'text', text: 'condensed' }])

    const types = session.events.map(event => event.type)
    expect(types).toEqual(['turn/start', 'user/message', 'user/message', 'compaction/start', 'compaction/summary', 'user/message', 'compaction/end'])
    expect(session.surface.nodes).toHaveLength(1)
    expect(session.surface.replaceGeneration).toBe(1)
  })

  it('rejects a current-turn compaction with no open turn', async () => {
    const session = new FakeSession()
    const a = session.appendUserText('x').seq
    const meter = new FakeTokenMeter(new Map([[a, 200]]))
    const agent = { session, options: {} }

    await expect(compactSurfaceRegion(
      deps(meter, async () => stubSummary('y')),
      session,
      a,
      a,
      agent,
      { owner: 'current-turn', stability: 'whole-surface' },
    )).rejects.toThrow(/no open turn/)
  })

  it('rejects a manual compaction while a turn is open', async () => {
    const session = new FakeSession()
    session.append('turn/start', { turn: 0 })
    const a = session.appendUserText('x').seq
    const meter = new FakeTokenMeter(new Map([[a, 200]]))
    const agent = { session, options: {} }

    await expect(compactSurfaceRegion(
      deps(meter, async () => stubSummary('y')),
      session,
      a,
      a,
      agent,
      { owner: null, stability: 'selected-span' },
    )).rejects.toThrow(ManualCompactionError)
  })

  it('rejects when a compaction is already active (unmatched compaction/start)', async () => {
    const session = new FakeSession()
    session.append('turn/start', { turn: 0 })
    const a = session.appendUserText('x').seq
    session.append('compaction/start', { compactionId: 'existing' as never, turn: 0 })
    const meter = new FakeTokenMeter(new Map([[a, 200]]))
    const agent = { session, options: {} }

    await expect(compactSurfaceRegion(
      deps(meter, async () => stubSummary('y')),
      session,
      a,
      a,
      agent,
      { owner: 'current-turn', stability: 'whole-surface' },
    )).rejects.toThrow(/already in progress/)
  })

  it('appends compaction/end with an error and rethrows when the summarizer fails', async () => {
    const session = new FakeSession()
    session.append('turn/start', { turn: 0 })
    const a = session.appendUserText('x').seq
    const meter = new FakeTokenMeter(new Map([[a, 200]]))
    const agent = { session, options: {} }

    await expect(compactSurfaceRegion(
      deps(meter, async () => { throw new Error('summarizer boom') }),
      session,
      a,
      a,
      agent,
      { owner: 'current-turn', stability: 'whole-surface' },
    )).rejects.toThrow('summarizer boom')

    const endEvent = session.events.at(-1)!
    expect(endEvent.type).toBe('compaction/end')
    expect((endEvent.data as { error?: string }).error).toContain('summarizer boom')
    // The lock must be released even after failure.
    expect(() => assertNoActiveCompaction(session, 'next attempt')).not.toThrow()
  })

  it('classifies a failed manual compaction as ManualCompactionError("summary")', async () => {
    const session = new FakeSession()
    const a = session.appendUserText('x').seq
    const meter = new FakeTokenMeter(new Map([[a, 200]]))
    const agent = { session, options: {} }

    const error = await compactSurfaceRegion(
      deps(meter, async () => { throw new Error('boom') }),
      session,
      a,
      a,
      agent,
      { owner: null, stability: 'selected-span' },
    ).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ManualCompactionError)
    expect((error as InstanceType<typeof ManualCompactionError>).code).toBe('summary')
  })

  it('rejects a summary that is not smaller than the shadowed content', async () => {
    const session = new FakeSession()
    session.append('turn/start', { turn: 0 })
    const a = session.appendUserText('x').seq
    // A tiny shadowed price (1 token) that no framed summary can beat.
    const meter = new FakeTokenMeter(new Map([[a, 1]]))
    const agent = { session, options: {} }

    await expect(compactSurfaceRegion(
      deps(meter, async () => stubSummary('this summary is definitely not smaller than one token')),
      session,
      a,
      a,
      agent,
      { owner: 'current-turn', stability: 'whole-surface' },
    )).rejects.toThrow(/not smaller than the shadowed content/)
  })

  it('rejects when the whole surface changed during summarization (whole-surface stability)', async () => {
    const session = new FakeSession()
    session.append('turn/start', { turn: 0 })
    const a = session.appendUserText('x').seq
    const meter = new FakeTokenMeter(new Map([[a, 200]]))
    const agent = { session, options: {} }

    await expect(compactSurfaceRegion(
      deps(meter, async () => {
        // Simulate a concurrent append landing while summarization is in flight.
        session.appendUserText('surprise')
        return stubSummary('condensed')
      }),
      session,
      a,
      a,
      agent,
      { owner: 'current-turn', stability: 'whole-surface' },
    )).rejects.toThrow(/session surface changed during summarization/)
  })

  it('tolerates unrelated tail growth under selected-span stability', async () => {
    const session = new FakeSession()
    const a = session.appendUserText('x').seq
    const meter = new FakeTokenMeter(new Map([[a, 200]]))
    const agent = { session, options: {} }

    const result = await compactSurfaceRegion(
      deps(meter, async () => {
        session.appendUserText('unrelated but appended after the selected span')
        return stubSummary('condensed')
      }),
      session,
      a,
      a,
      agent,
      { owner: null, stability: 'selected-span' },
    )
    expect(result.shadowedSeqs).toEqual([a])
  })

  it('runs the optional flush callback after a successful commit and surfaces its failure', async () => {
    const session = new FakeSession()
    const a = session.appendUserText('x').seq
    const meter = new FakeTokenMeter(new Map([[a, 200]]))
    const agent = { session, options: {} }
    const flush = vi.fn().mockRejectedValue(new Error('disk full'))

    const error = await compactSurfaceRegion(
      deps(meter, async () => stubSummary('condensed')),
      session,
      a,
      a,
      agent,
      { owner: null, stability: 'selected-span', flush },
    ).catch((caught: unknown) => caught)

    expect(flush).toHaveBeenCalledOnce()
    expect(error).toBeInstanceOf(ManualCompactionError)
    expect((error as InstanceType<typeof ManualCompactionError>).code).toBe('persistence')
  })
})

describe('assertNoActiveCompaction', () => {
  it('does not throw on a session with no compaction history', () => {
    const session = new FakeSession()
    expect(() => assertNoActiveCompaction(session, 'probe')).not.toThrow()
  })

  it('throws while a compaction/start has no matching compaction/end', () => {
    const session = new FakeSession()
    session.append('compaction/start', { compactionId: 'x' as never, turn: null })
    expect(() => assertNoActiveCompaction(session, 'probe')).toThrow(/already in progress/)
  })

  it('does not throw once compaction/end has landed', () => {
    const session = new FakeSession()
    session.append('compaction/start', { compactionId: 'x' as never, turn: null })
    session.append('compaction/end', { compactionId: 'x' as never, turn: null })
    expect(() => assertNoActiveCompaction(session, 'probe')).not.toThrow()
  })
})
