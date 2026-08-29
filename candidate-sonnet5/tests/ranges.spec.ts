import { describe, expect, it } from 'vitest'
import { selectCompactableRange, validateRangeSelection } from '../src/ranges.js'
import { FakeSession } from './fake-session.js'
import { FakeTokenMeter } from './fake-token-meter.js'

describe('selectCompactableRange', () => {
  it('returns null on an empty surface', () => {
    const session = new FakeSession()
    const meter = new FakeTokenMeter()
    expect(selectCompactableRange(session, meter.measure(session), 0)).toBeNull()
  })

  it('selects the head range while retaining the priced tail', () => {
    const session = new FakeSession()
    const seqs = [0, 1, 2, 3, 4].map(() => session.appendUserText('x').seq)
    const meter = new FakeTokenMeter(new Map(seqs.map(seq => [seq, 10])))
    // Retain the last two nodes (20 tokens): range should cover the first three.
    const range = selectCompactableRange(session, meter.measure(session), 20)
    expect(range).toEqual({ start: seqs[0], end: seqs[2] })
  })

  it('returns null when nothing is left to compact after retention', () => {
    const session = new FakeSession()
    session.appendUserText('a')
    session.appendUserText('b')
    const meter = new FakeTokenMeter()
    // Retaining more than the whole surface leaves nothing to compact.
    expect(selectCompactableRange(session, meter.measure(session), 1000)).toBeNull()
  })

  it('walks the cutoff back to the nearest balanced boundary', () => {
    const session = new FakeSession()
    const first = session.appendUserText('a').seq
    const assistant = session.append(
      'assistant/message',
      {
        turn: 0,
        step: 0,
        message: {
          id: 'asst' as never,
          role: 'assistant',
          content: [{ type: 'tool-call', id: 'call-1' as never, name: 'x', arguments: '{}' }],
          source: { kind: 'model', provider: 'p', model: 'm' },
        },
      },
      { surfaceOp: 'append' },
    ).seq
    const toolResult = session.append(
      'tool/result',
      {
        turn: 0,
        step: 0,
        message: {
          id: 'tool' as never,
          role: 'user',
          content: [{ type: 'tool-result', toolCallId: 'call-1' as never, content: [{ type: 'text', text: 'ok' }] }],
          source: { kind: 'tool', callId: 'call-1' as never },
        },
      },
      { surfaceOp: 'append' },
    ).seq
    const tail = session.appendUserText('after').seq

    // retainTokens = 15 pulls in [toolResult, tail] (20 tokens) from the tail,
    // so the cutoff lands right before toolResult — between the tool-call and
    // its own result, which is unbalanced — and must walk back to before the
    // assistant tool-call.
    const meter = new FakeTokenMeter(new Map([[first, 10], [assistant, 10], [toolResult, 10], [tail, 10]]))
    const range = selectCompactableRange(session, meter.measure(session), 15)
    expect(range).toEqual({ start: first, end: first })
  })
})

describe('validateRangeSelection', () => {
  it('accepts a balanced range spanning the whole surface', () => {
    const session = new FakeSession()
    const a = session.appendUserText('a').seq
    const b = session.appendUserText('b').seq
    const selection = validateRangeSelection(session, a, b)
    expect(selection).toEqual({ start: a, end: b, startIdx: 0, endIdx: 1, shadowedSeqs: [a, b] })
  })

  it('rejects a start seq not on the surface', () => {
    const session = new FakeSession()
    session.appendUserText('a')
    expect(() => validateRangeSelection(session, 999, 0)).toThrow(/start seq 999 not found/)
  })

  it('rejects end seq not on the surface', () => {
    const session = new FakeSession()
    const a = session.appendUserText('a').seq
    expect(() => validateRangeSelection(session, a, 999)).toThrow(/end seq 999 not found/)
  })

  it('rejects start after end', () => {
    const session = new FakeSession()
    const a = session.appendUserText('a').seq
    const b = session.appendUserText('b').seq
    expect(() => validateRangeSelection(session, b, a)).toThrow(/is after end seq/)
  })

  it('rejects a range that splits a tool-call/result pair', () => {
    const session = new FakeSession()
    const assistant = session.append(
      'assistant/message',
      {
        turn: 0,
        step: 0,
        message: {
          id: 'asst' as never,
          role: 'assistant',
          content: [{ type: 'tool-call', id: 'call-1' as never, name: 'x', arguments: '{}' }],
          source: { kind: 'model', provider: 'p', model: 'm' },
        },
      },
      { surfaceOp: 'append' },
    ).seq
    session.append(
      'tool/result',
      {
        turn: 0,
        step: 0,
        message: {
          id: 'tool' as never,
          role: 'user',
          content: [{ type: 'tool-result', toolCallId: 'call-1' as never, content: [{ type: 'text', text: 'ok' }] }],
          source: { kind: 'tool', callId: 'call-1' as never },
        },
      },
      { surfaceOp: 'append' },
    )
    // end = the tool-call itself, splitting it from its result.
    expect(() => validateRangeSelection(session, assistant, assistant)).toThrow(/not a balanced boundary/)
  })
})
