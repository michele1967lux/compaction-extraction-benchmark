/**
 * Phase 1 seams: the ported utilities (deepFreeze, errorChain,
 * contentHasImage, assertNever, createUserMessage) and the in-memory fixtures
 * (FakeSession surface + replace, FakeMeter, FakeLLM script replay).
 */
import { describe, expect, it } from 'vitest'
import { SessionId, ToolCallId } from '../src/brand.ts'
import {
  type ContentBlock,
  assertNever,
  contentHasImage,
  createUserMessage,
  deepFreeze,
  errorChain,
} from '../src/session.ts'
import { assistantMessage, assistantToolCallMessage, FakeLLM, FakeMeter, FakeSession, toolResultMessage, userMessage } from './fakes.ts'

describe('createUserMessage', () => {
  it('freezes the message, its content, and its source', () => {
    const message = createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } })
    expect(Object.isFrozen(message)).toBe(true)
    expect(Object.isFrozen(message.content)).toBe(true)
    expect(Object.isFrozen(message.content[0]!)).toBe(true)
    expect(message.role).toBe('user')
    expect(typeof message.id).toBe('string')
  })
})

describe('deepFreeze', () => {
  it('freezes nested object graphs and skips AbortSignal instances', () => {
    const signal = new AbortController().signal
    const graph: { inner: { deep: string }; signal?: AbortSignal } = deepFreeze({ inner: { deep: 'x' }, signal })
    expect(Object.isFrozen(graph)).toBe(true)
    expect(Object.isFrozen(graph.inner)).toBe(true)
    expect(graph.inner.deep).toBe('x')
  })

  it('does not freeze the same node twice (cycles terminate)', () => {
    const holder: { self?: object } = {}
    holder.self = holder
    const frozen = deepFreeze(holder)
    expect(Object.isFrozen(frozen)).toBe(true)
    expect(frozen.self).toBe(holder)
  })
})

describe('errorChain', () => {
  it('renders the outermost message first with causes chained', () => {
    const inner = new Error('inner')
    const outer = new Error('outer', { cause: inner })
    expect(errorChain(outer)).toBe('outer: inner')
  })

  it('skips causes that repeat the wrapper message verbatim', () => {
    const outer = new Error('same', { cause: new Error('same') })
    expect(errorChain(outer)).toBe('same')
  })

  it('renders an empty Error message via its name', () => {
    expect(errorChain(new TypeError(''))).toBe('TypeError')
  })

  it('brackets and joins AggregateError members', () => {
    const aggregate = new AggregateError([new Error('a'), new Error('b')], 'wrap')
    expect(errorChain(aggregate)).toBe('wrap [a; b]')
  })

  it('falls back to String for non-Error values', () => {
    expect(errorChain('plain')).toBe('plain')
    expect(errorChain(42)).toBe('42')
  })
})

describe('contentHasImage', () => {
  it('is false for text-only blocks', () => {
    expect(contentHasImage([{ type: 'text', text: 't' }])).toBe(false)
  })

  it('is true for a top-level image block', () => {
    expect(contentHasImage([{ type: 'image' }])).toBe(true)
  })

  it('recurses into tool-result content', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool-result', toolCallId: 'c' as ToolCallId, content: [{ type: 'image' }] },
    ]
    expect(contentHasImage(blocks)).toBe(true)
  })
})

describe('assertNever', () => {
  it('throws with the rendered value', () => {
    // Deliberately widened to exercise the control-flow backstop.
    expect(() => assertNever('x' as never)).toThrow('unreachable')
    expect(() => assertNever('x' as never, 'ctx')).toThrow('ctx: unreachable')
  })
})

describe('FakeSession', () => {
  it('assigns contiguous seqs and records surface appends', () => {
    const session = new FakeSession('s-1')
    const first = session.append('turn/start', { turn: 1 })
    const second = session.append('user/message', userMessage('hi'), { surfaceOp: 'append' })
    expect(first.seq).toBe(0)
    expect(second.seq).toBe(1)
    expect(session.surface.nodes).toEqual([1])
    expect(session.surface.replaceGeneration).toBe(0)
  })

  it('replaces a surface span and bumps replaceGeneration', () => {
    const session = new FakeSession('s-2')
    session.append('turn/start', { turn: 1 })
    session.append('user/message', userMessage('a'), { surfaceOp: 'append' })
    session.append('assistant/message', { turn: 1, step: 1, message: assistantMessage('p', 'm') }, { surfaceOp: 'append' })
    session.append('tool/result', { turn: 1, step: 1, message: toolResultMessage('c1') }, { surfaceOp: 'append' })

    const replace = session.append('user/message', userMessage('checkpoint'), {
      surfaceOp: { op: 'replace', start: 0, end: 1 },
      sourceEventSeqs: [1, 2],
    })

    // Surface before: [1, 2, 3]; replace positions 0..1 with the new node.
    expect(session.surface.nodes).toEqual([replace.seq, 3])
    expect(session.surface.replaceGeneration).toBe(1)
  })

  it('derives messages with the dsh-session rules', () => {
    const session = new FakeSession('s-3')
    const turn = session.append('turn/start', { turn: 1 })
    const user = session.append('user/message', userMessage('hi'), { surfaceOp: 'append' })
    const assistant = session.append('assistant/message', { turn: 1, step: 1, message: assistantMessage('p', 'm') }, { surfaceOp: 'append' })
    const tool = session.append('tool/result', { turn: 1, step: 1, message: toolResultMessage('c1') }, { surfaceOp: 'append' })
    const emptyAssistant = session.append('assistant/message', { turn: 1, step: 2, message: assistantMessage('p', 'm', []) }, { surfaceOp: 'append' })

    expect(session.deriveEventMessage(turn)).toBeNull()
    expect(session.deriveEventMessage(user)).toBe(user.data)
    expect(session.deriveEventMessage(assistant)).toBe(assistant.data.message)
    expect(session.deriveEventMessage(tool)).toBe(tool.data.message)
    expect(session.deriveEventMessage(emptyAssistant)).toBeNull()
  })

  it('keeps the events log append-only (no mutation of recorded events)', () => {
    const session = new FakeSession('s-4')
    const event = session.append('user/message', userMessage('hi'), { surfaceOp: 'append' })
    expect(session.events[0]).toBe(event)
    // The session never mutates a recorded event: same reference throughout.
    expect(session.events[0]?.data).toBe(event.data)
  })
})

describe('FakeMeter', () => {
  it('prices surface nodes and estimates messages', () => {
    const session = new FakeSession('s-5')
    session.append('user/message', userMessage('a'), { surfaceOp: 'append' })
    session.append('user/message', userMessage('bb'), { surfaceOp: 'append' })
    const meter = new FakeMeter(100, 10)

    const measurement = meter.measure(session)
    expect(measurement.totalTokens).toBe(100)
    expect(measurement.nodes.map(node => node.seq)).toEqual(session.surface.nodes)
    expect(measurement.nodes.every(node => node.tokens === 10 && node.heuristicTokens === 10)).toBe(true)

    expect(meter.estimateMessage(userMessage('abcd'))).toBe(4)
    expect(meter.estimateMessage(assistantToolCallMessage('c1'))).toBe(5)
  })
})

describe('FakeLLM', () => {
  it('replays the default chunk script through the stream protocol', async () => {
    const llm = new FakeLLM(8192)
    const chunks = []
    for await (const chunk of llm.stream({ provider: 'p', model: 'm', messages: [] })) {
      chunks.push(chunk)
    }
    expect(chunks[chunks.length - 1]?.type).toBe('finish')

    const info = await llm.resolveModelInfo('p', 'm')
    expect(info.context?.contextWindow).toBe(8192)
  })

  it('records the request including purpose, maxTokens, and sessionId', async () => {
    const sessionId = SessionId('session-9')
    const llm = new FakeLLM()
    for await (const _chunk of llm.stream({
      provider: 'p',
      model: 'm',
      messages: [userMessage('x')],
      maxTokens: 4096,
      sessionId,
      purpose: 'compaction',
    })) {}
    const request = llm.requested[0]
    expect(request?.purpose).toBe('compaction')
    expect(request?.maxTokens).toBe(4096)
    expect(request?.sessionId).toBe(sessionId)
    expect(request?.messages?.[0]?.content[0]?.type).toBe('text')
  })
})
