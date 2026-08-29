import { describe, expect, it } from 'vitest'
import { MessageId, ToolCallId } from '../src/brand.ts'
import { FakeMeter, FakeSession, userMessage } from './fakes.ts'
import { selectCompactableRange } from '../src/ranges.ts'

describe('selectCompactableRange', () => {
  it('returns null for an empty surface', () => {
    const session = new FakeSession()
    const meter = new FakeMeter(0, 10)
    expect(selectCompactableRange(session, meter.measure(session), 100)).toBeNull()
  })

  it('throws when the meter surface does not match the session surface', () => {
    const session = new FakeSession()
    session.append('user/message', userMessage('hello'), { surfaceOp: 'append' })
    // FakeMeter with a different node count
    const mismatchedMeter = {
      totalTokens: 100,
      nodes: [{ seq: 999, tokens: 10, heuristicTokens: 10 }],
    }
    expect(() => selectCompactableRange(session, mismatchedMeter, 10)).toThrow(
      'compaction: token-meter surface does not match the current session surface',
    )
  })

  it('selects the head-anchored range retaining the priced tail', () => {
    const session = new FakeSession()
    // 5 nodes, each 10 tokens
    for (let i = 0; i < 5; i++) {
      session.append('user/message', userMessage(`msg ${i}`), { surfaceOp: 'append' })
    }
    const meter = new FakeMeter(50, 10)
    const range = selectCompactableRange(session, meter.measure(session), 20)
    // retainTokens=20 → keep last 2 nodes (idx 3,4) → compact idx 0..2
    expect(range).toEqual({ start: 0, end: 2 })
  })

  it('returns null when the entire surface must be retained', () => {
    const session = new FakeSession()
    session.append('user/message', userMessage('hello'), { surfaceOp: 'append' })
    const meter = new FakeMeter(10, 10)
    // retainTokens=10 → keep the only node → nothing to compact
    expect(selectCompactableRange(session, meter.measure(session), 10)).toBeNull()
  })

  it('snaps back to a balanced boundary when needed', () => {
    const session = new FakeSession()
    // user, assistant(tool-call), tool-result → 3 nodes
    session.append('user/message', userMessage('do it'), { surfaceOp: 'append' })
    session.append('assistant/message', {
      turn: 1, step: 0,
      message: {
        id: MessageId('m1'), role: 'assistant',
        content: [{ type: 'tool-call', id: ToolCallId('c1'), name: 'bash', arguments: '{}' }],
        source: { kind: 'model', provider: 'p', model: 'm' },
      },
    }, { surfaceOp: 'append' })
    session.append('tool/result', {
      turn: 1, step: 0,
      message: {
        id: MessageId('m2'), role: 'user',
        content: [{ type: 'tool-result', toolCallId: ToolCallId('c1'), content: [{ type: 'text', text: 'ok' }] }],
        source: { kind: 'tool', callId: ToolCallId('c1') },
      },
    }, { surfaceOp: 'append' })
    const meter = new FakeMeter(30, 10)
    // retainTokens=10 → keep last 1 node (idx 2) → compact idx 0..1
    // But idx 1 is an open tool-call → snap back to idx 0 → compact idx 0..0
    const range = selectCompactableRange(session, meter.measure(session), 10)
    expect(range).toEqual({ start: 0, end: 0 })
  })
})
