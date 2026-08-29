/**
 * In-memory fixtures implementing the injected seams (ISession, ITokenMeter,
 * ILLMClient) for the standalone test suite. They reproduce the dsh-session
 * contracts the compaction reads (append-only log, surface nodes,
 * `deriveEventMessage` rules) and a minimal stream-protocol LLM. Deterministic
 * and dependency-free.
 *
 * @module @test
 */

import { randomUUID } from 'node:crypto'
import { MessageId, SessionId, type SessionId as SessionIdentity, type ToolCallId } from '../src/brand.ts'
import {
  type AssistantMessage,
  type ContentBlock,
  type EpochHeader,
  type ILLMClient,
  type ISession,
  type ISessionSurface,
  type ITokenMeter,
  type LlmFailure,
  type LlmModelInfo,
  type LlmRequest,
  type Message,
  type MessageSource,
  type SessionEvent,
  type SessionEventMap,
  type SessionEventOf,
  type SessionEventType,
  type StreamChunk,
  type SurfaceEventType,
  type SurfaceIntent,
  type TokenMeasurement,
  type ToolResultMessage,
  type UserMessage,
} from '../src/session.ts'

// ---------------------------------------------------------------------------
// Message fixtures
// ---------------------------------------------------------------------------

/** Build one identified, plain user-role message. */
export function userMessage(text: string, source: MessageSource = { kind: 'user' }): UserMessage {
  return { id: MessageId(randomUUID()), role: 'user', content: [{ type: 'text', text }], source }
}

/** Build one identified assistant message (model source + content blocks). */
export function assistantMessage(
  provider: string,
  model: string,
  content: readonly ContentBlock[] = [{ type: 'text', text: 'done' }],
): AssistantMessage {
  return {
    id: MessageId(randomUUID()),
    role: 'assistant',
    content: [...content],
    source: { kind: 'model', provider, model },
  }
}

/** Build one tool-result message (user role, tool source) for `callId`. */
export function toolResultMessage(callId: string, text = 'ok'): ToolResultMessage {
  const id = callId as ToolCallId
  return {
    id: MessageId(randomUUID()),
    role: 'user',
    content: [{ type: 'tool-result', toolCallId: id, content: [{ type: 'text', text }] }],
    source: { kind: 'tool', callId: id },
  }
}

/** Build one assistant message that requested `callId` (tool-call block). */
export function assistantToolCallMessage(callId: string, name = 'fs', argumentsJson = '{}'): AssistantMessage {
  return {
    id: MessageId(randomUUID()),
    role: 'assistant',
    content: [{ type: 'tool-call', id: callId as ToolCallId, name, arguments: argumentsJson }],
    source: { kind: 'model', provider: 'p', model: 'm' },
  }
}

// ---------------------------------------------------------------------------
// FakeSession
// ---------------------------------------------------------------------------

/**
 * Append-only in-memory session with the ordered surface. The surface model
 * mirrors `dsh-session`'s replace semantics the compaction uses: a
 * `SurfaceIntent` with `surfaceOp: { op: 'replace', start, end }` removes the
 * named surface nodes and inserts this node; `replaceGeneration` increments on
 * each replace.
 */
export class FakeSession implements ISession {
  readonly id: SessionIdentity
  readonly events: SessionEvent[] = []
  // Live mutable surface the `nodes`/`replaceGeneration` getters read.
  private readonly surfaceNodes: number[] = []
  private surfaceReplaces = 0

  // Accepts a raw id (mints the brand) or an already-branded one.
  constructor(id: string = 'fake-0001', private readonly header?: EpochHeader) {
    this.id = SessionId(id)
  }

  get surface(): ISessionSurface {
    return { nodes: this.surfaceNodes, replaceGeneration: this.surfaceReplaces }
  }

  append<T extends SessionEventType>(
    type: T,
    data: SessionEventMap[T],
    ...opts: T extends SurfaceEventType ? [opts: SurfaceIntent] : []
  ): SessionEventOf<T> {
    const event = { type, seq: this.events.length, time: Date.now(), data } as SessionEventOf<T>
    this.events.push(event as SessionEvent)
    const surfaceEvent = opts.length > 0 ? (opts[0] as SurfaceIntent) : undefined
    if (surfaceEvent !== undefined) {
      if (surfaceEvent.surfaceOp === 'append') {
        this.surfaceNodes.push(event.seq)
      } else {
        const { start, end } = surfaceEvent.surfaceOp
        this.surfaceNodes.splice(start, end - start + 1, event.seq)
        this.surfaceReplaces += 1
      }
    }
    return event
  }

  requestHeader(): EpochHeader | undefined {
    return this.header
  }

  deriveEventMessage(event: SessionEvent): Message | null {
    switch (event.type) {
      case 'user/message':
        return event.data
      case 'assistant/message': {
        const message = event.data.message
        return message.content.length === 0 ? null : message
      }
      case 'tool/result':
        return event.data.message
      default:
        return null
    }
  }
}

// ---------------------------------------------------------------------------
// FakeMeter
// ---------------------------------------------------------------------------

/**
 * Deterministic token meter: `measure` returns a fixed `totalTokens` and one
 * node per surface node priced with `perNodeTokens` (route price = heuristic
 * price, so shadow-pricing assertions stay exact).
 */
export class FakeMeter implements ITokenMeter {
  constructor(
    private readonly totalTokens: number,
    private readonly perNodeTokens: number = 10,
  ) {}

  measure(session: ISession): TokenMeasurement {
    return {
      totalTokens: this.totalTokens,
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
      if (block.type === 'tool-result') total += block.content.length > 0 ? 2 : 0
    }
    return total
  }
}

// ---------------------------------------------------------------------------
// FakeLLM
// ---------------------------------------------------------------------------

export type ChunkScript = StreamChunk[]

/**
 * Deterministic LLM client: `stream` replays a fixed chunk script (default: a
 * single text block); `resolveModelInfo` returns a fixed
 * `context.contextWindow`. Records every request for assertions.
 */
export class FakeLLM implements ILLMClient {
  readonly requested: LlmRequest[] = []

  constructor(
    private readonly contextWindow: number = 4096,
    private readonly chunks: ChunkScript = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'Summary text' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'Summary text' } },
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ],
  ) {}

  stream(request: LlmRequest): AsyncIterable<StreamChunk> {
    this.requested.push(request)
    const signal = request.signal
    const chunkList = this.chunks
    return {
      [Symbol.asyncIterator]: async function* () {
        for (const chunk of chunkList) {
          if (signal?.aborted) throw new Error(signal.reason ?? 'aborted')
          yield chunk
        }
      },
    }
  }

  async resolveModelInfo(_provider: string, _model: string, _signal?: AbortSignal): Promise<LlmModelInfo> {
    return { context: { contextWindow: this.contextWindow } }
  }
}

/** One scripted terminal failure finish (for error-path tests). */
export function errorChunks(failure: LlmFailure, kind: 'error' | 'aborted' = 'error'): ChunkScript {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'partial' },
    { type: 'finish', reason: kind === 'error' ? { kind: 'error', failure } : { kind: 'aborted', failure } },
  ]
}
