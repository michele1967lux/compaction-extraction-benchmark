import { describe, expect, it } from 'vitest'
import { toolPairingBalancedAfter, toolPairingBalancedBefore } from '../src/tool-pairing.js'
import { MessageId, ToolCallId } from '../src/brand.js'
import type { AssistantMessage, ToolResultMessage } from '../src/session.js'
import { FakeSession } from './fake-session.js'

function assistantWithToolCall(id: string): AssistantMessage {
  return {
    id: MessageId(`asst-${id}`),
    role: 'assistant',
    content: [{ type: 'tool-call', id: ToolCallId(id), name: 'read_file', arguments: '{}' }],
    source: { kind: 'model', provider: 'p', model: 'm' },
  }
}

function toolResult(callId: string): ToolResultMessage {
  return {
    id: MessageId(`tool-${callId}`),
    role: 'user',
    content: [{ type: 'tool-result', toolCallId: ToolCallId(callId), content: [{ type: 'text', text: 'ok' }] }],
    source: { kind: 'tool', callId: ToolCallId(callId) },
  }
}

describe('tool-pairing', () => {
  it('every cut is balanced when the surface has no open tool calls', () => {
    const session = new FakeSession()
    session.appendUserText('hello')
    const assistant = session.append(
      'assistant/message',
      { turn: 0, step: 0, message: assistantWithToolCall('call-1') },
      { surfaceOp: 'append' },
    )
    session.appendToolResult(0, 0, toolResult('call-1'))

    expect(toolPairingBalancedBefore(session, session.surface.nodes[0]!)).toBe(true)
    expect(toolPairingBalancedAfter(session, assistant.seq)).toBe(false)
    expect(toolPairingBalancedBefore(session, assistant.seq)).toBe(true)
    const lastSeq = session.surface.nodes.at(-1)!
    expect(toolPairingBalancedAfter(session, lastSeq)).toBe(true)
  })

  it('a cut between an open tool call and its result is unbalanced', () => {
    const session = new FakeSession()
    const assistant = session.append(
      'assistant/message',
      { turn: 0, step: 0, message: assistantWithToolCall('call-2') },
      { surfaceOp: 'append' },
    )
    session.appendToolResult(0, 0, toolResult('call-2'))
    // The cut right after the tool-call (before its result) must be unbalanced.
    expect(toolPairingBalancedAfter(session, assistant.seq)).toBe(false)
  })

  it('throws when a tool/result has no preceding open call (corrupt surface)', () => {
    const session = new FakeSession()
    session.appendToolResult(0, 0, toolResult('orphan'))
    expect(() => toolPairingBalancedBefore(session, 0)).toThrow(/no matching tool-call/)
  })

  it('throws when the seq is not on the current surface', () => {
    const session = new FakeSession()
    session.appendUserText('hi')
    expect(() => toolPairingBalancedBefore(session, 999)).toThrow(/not found/)
  })

  it('rebuilds the balance cache after a surface replacement (compaction) and rejects the shadowed seq', () => {
    const session = new FakeSession()
    const first = session.appendUserText('a')
    const second = session.appendUserText('b')
    expect(toolPairingBalancedBefore(session, second.seq)).toBe(true)

    // Simulate a compaction replace: shadow [first, second] with one new node.
    session.append(
      'user/message',
      { id: MessageId('summary'), role: 'user', content: [{ type: 'text', text: 'summary' }], source: { kind: 'plugin', plugin: 'compact' } },
      { surfaceOp: { op: 'replace', start: first.seq, end: second.seq }, sourceEventSeqs: [first.seq, second.seq] },
    )
    expect(() => toolPairingBalancedBefore(session, second.seq)).toThrow(/not found/)
    const replacementSeq = session.surface.nodes[0]!
    expect(toolPairingBalancedBefore(session, replacementSeq)).toBe(true)
    expect(toolPairingBalancedAfter(session, replacementSeq)).toBe(true)
  })
})
