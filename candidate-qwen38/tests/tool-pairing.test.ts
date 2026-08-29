import { describe, expect, it } from 'vitest'
import { ToolCallId } from '../src/brand.ts'
import {
  toolPairingBalancedAfter,
  toolPairingBalancedBefore,
} from '../src/tool-pairing.ts'
import type {
  AssistantMessage,
  ContentBlock,
  ToolResultMessage,
  UserMessage,
} from '../src/session.ts'
import {
  assistantMessage,
  assistantToolCallMessage,
  FakeSession,
  toolResultMessage,
  userMessage,
} from './fakes.ts'

/** Append one surface event with the plain `append` surface op. */
function appendSurface(
  session: FakeSession,
  type: 'user/message' | 'assistant/message' | 'tool/result',
  data: UserMessage | { turn: number; step: number; message: AssistantMessage } | { turn: number; step: number; message: ToolResultMessage },
): void {
  session.append(type, data, { surfaceOp: 'append' })
}

describe('toolPairingBalancedBefore/After', () => {
  it('reports the cuts around a single text node as balanced', () => {
    const session = new FakeSession()
    appendSurface(session, 'user/message', userMessage('hello'))
    expect(toolPairingBalancedBefore(session, 0)).toBe(true)
    expect(toolPairingBalancedAfter(session, 0)).toBe(true)
  })

  it('keeps a tool-call/result pair balanced on both sides', () => {
    const session = new FakeSession()
    appendSurface(session, 'user/message', userMessage('do it'))
    appendSurface(session, 'assistant/message', {
      turn: 1,
      step: 0,
      message: assistantToolCallMessage('call-1', 'bash', '{"command":"ls"}'),
    })
    appendSurface(session, 'tool/result', {
      turn: 1,
      step: 0,
      message: toolResultMessage('call-1', 'ok'),
    })
    // Cuts: before user (0), before assistant (1), before tool/result (2), after tail (3).
    expect(toolPairingBalancedBefore(session, 0)).toBe(true)
    expect(toolPairingBalancedBefore(session, 1)).toBe(true)
    expect(toolPairingBalancedBefore(session, 2)).toBe(false) // open call crosses
    expect(toolPairingBalancedAfter(session, 0)).toBe(true)
    expect(toolPairingBalancedAfter(session, 1)).toBe(false) // open call crosses
    expect(toolPairingBalancedAfter(session, 2)).toBe(true)
  })

  it('reports an unbalanced cut after an open tool call', () => {
    const session = new FakeSession()
    appendSurface(session, 'assistant/message', {
      turn: 1,
      step: 0,
      message: assistantToolCallMessage('call-1', 'bash', '{}'),
    })
    expect(toolPairingBalancedBefore(session, 0)).toBe(true)
    expect(toolPairingBalancedAfter(session, 0)).toBe(false)
  })

  it('counts multiple tool calls in one assistant message', () => {
    const session = new FakeSession()
    const base = assistantMessage('p', 'm')
    const content: ContentBlock[] = [
      { type: 'tool-call', id: ToolCallId('call-1'), name: 'a', arguments: '{}' },
      { type: 'tool-call', id: ToolCallId('call-2'), name: 'b', arguments: '{}' },
    ]
    const twoCalls = { ...base, content }
    appendSurface(session, 'assistant/message', { turn: 1, step: 0, message: twoCalls })
    appendSurface(session, 'tool/result', { turn: 1, step: 0, message: toolResultMessage('call-1') })
    // One call still open after the first result.
    expect(toolPairingBalancedAfter(session, 1)).toBe(false)
    appendSurface(session, 'tool/result', { turn: 1, step: 0, message: toolResultMessage('call-2') })
    expect(toolPairingBalancedAfter(session, 2)).toBe(true)
  })

  it('throws for a tool result with no preceding open call', () => {
    const session = new FakeSession()
    appendSurface(session, 'tool/result', {
      turn: 1,
      step: 0,
      message: toolResultMessage('orphan'),
    })
    expect(() => toolPairingBalancedBefore(session, 0)).toThrow(
      'tool-pairing balance: tool/result at surface seq 0 has no matching tool-call (corrupt surface)',
    )
  })

  it('throws for a seq absent from the current surface', () => {
    const session = new FakeSession()
    appendSurface(session, 'user/message', userMessage('hello'))
    expect(() => toolPairingBalancedBefore(session, 99)).toThrow(
      'tool-pairing balance: surface seq 99 not found',
    )
    expect(() => toolPairingBalancedAfter(session, 99)).toThrow(
      'tool-pairing balance: surface seq 99 not found',
    )
  })

  it('rebuilds the cache when the surface generation changes', () => {
    const session = new FakeSession()
    appendSurface(session, 'user/message', userMessage('one'))
    appendSurface(session, 'assistant/message', {
      turn: 1,
      step: 0,
      message: assistantToolCallMessage('call-1', 'bash', '{}'),
    })
    appendSurface(session, 'tool/result', { turn: 1, step: 0, message: toolResultMessage('call-1') })
    expect(toolPairingBalancedAfter(session, 2)).toBe(true)

    // A replace bumps the generation and shrinks the surface to one node.
    session.append(
      'user/message',
      userMessage('summary'),
      { surfaceOp: { op: 'replace', start: 0, end: 2 }, sourceEventSeqs: [0, 1, 2] },
    )
    expect(session.surface.nodes).toEqual([3])
    expect(session.surface.replaceGeneration).toBe(1)
    expect(toolPairingBalancedBefore(session, 3)).toBe(true)
    expect(toolPairingBalancedAfter(session, 3)).toBe(true)
    // The old seqs are no longer in the rebuilt cache.
    expect(() => toolPairingBalancedBefore(session, 0)).toThrow(
      'tool-pairing balance: surface seq 0 not found',
    )
  })

  it('extends the cache incrementally as the surface grows', () => {
    const session = new FakeSession()
    appendSurface(session, 'user/message', userMessage('a'))
    expect(toolPairingBalancedAfter(session, 0)).toBe(true)
    appendSurface(session, 'user/message', userMessage('b'))
    expect(toolPairingBalancedAfter(session, 1)).toBe(true)
    expect(toolPairingBalancedBefore(session, 1)).toBe(true)
  })

  it('keeps per-session caches independent', () => {
    const a = new FakeSession()
    const b = new FakeSession()
    appendSurface(a, 'assistant/message', {
      turn: 1,
      step: 0,
      message: assistantToolCallMessage('call-a', 'bash', '{}'),
    })
    appendSurface(b, 'user/message', userMessage('quiet'))
    expect(toolPairingBalancedAfter(a, 0)).toBe(false)
    expect(toolPairingBalancedAfter(b, 0)).toBe(true)
  })
})
