/**
 * A small in-memory `ISession` implementation for tests: an append-only log
 * plus the same ordered-surface bookkeeping the real `Session`/`SurfaceManager`
 * perform (`packages/core/session/src/surface.ts`) — append to the tail, or
 * replace an inclusive positional span with one new node and bump
 * `replaceGeneration`. Not a port of the full `Session` class (persistence,
 * header folding, seed validation, JSON-serializability checks are out of
 * scope for a test double) — just enough of the real surface-transition
 * semantics for the compaction logic under test to observe the same surface
 * shape it would see from the real session.
 */

import type {
  AssistantMessage,
  EpochHeader,
  ISession,
  Message,
  SessionEvent,
  SessionEventMap,
  SessionEventType,
  SessionSurface,
  SurfaceEventType,
  SurfaceIntent,
  ToolResultMessage,
  UserMessage,
} from '../src/session.js'
import { SessionId } from '../src/brand.js'

const SURFACE_EVENT_TYPES = new Set<string>(['user/message', 'assistant/message', 'tool/result'])

function deriveEventMessage(event: SessionEvent): Message | null {
  switch (event.type) {
    case 'user/message':
      return event.data as UserMessage
    case 'assistant/message': {
      const data = event.data as SessionEventMap['assistant/message']
      if (data.message.content.length === 0) return null
      return data.message
    }
    case 'tool/result': {
      const data = event.data as SessionEventMap['tool/result']
      return data.message
    }
    default:
      return null
  }
}

export class FakeSession implements ISession {
  readonly id = SessionId('fake-session')

  private log: SessionEvent[] = []
  private nodes: number[] = []
  private replaceGeneration = 0
  private header: EpochHeader | undefined

  get events(): readonly SessionEvent[] {
    return this.log
  }

  get surface(): SessionSurface {
    return { nodes: this.nodes, replaceGeneration: this.replaceGeneration }
  }

  /** Test setup helper: install the latest request header directly (no event fold). */
  setRequestHeader(header: EpochHeader): void {
    this.header = header
  }

  requestHeader(): EpochHeader | undefined {
    return this.header
  }

  deriveEventMessage(event: SessionEvent): Message | null {
    return deriveEventMessage(event)
  }

  append<T extends SessionEventType>(
    type: T,
    data: SessionEventMap[T],
    ...opts: T extends SurfaceEventType ? [opts: SurfaceIntent] : []
  ): SessionEvent<T> {
    const surfaceOpts = opts[0] as SurfaceIntent | undefined
    const seq = this.log.length
    const event = {
      type,
      seq,
      time: Date.now(),
      data,
      ...surfaceOpts?.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: surfaceOpts.sourceEventSeqs },
      ...surfaceOpts?.surfaceOp === undefined ? {} : { surfaceOp: surfaceOpts.surfaceOp },
    } as SessionEvent<T>
    this.log.push(event as SessionEvent)

    if (SURFACE_EVENT_TYPES.has(type) && surfaceOpts !== undefined) {
      const op = surfaceOpts.surfaceOp
      if (op === 'append') {
        this.nodes.push(seq)
      } else {
        const startIdx = this.nodes.indexOf(op.start)
        const endIdx = this.nodes.indexOf(op.end)
        if (startIdx === -1 || endIdx === -1) {
          throw new Error(`FakeSession: replace range [${op.start}, ${op.end}] not found on surface`)
        }
        this.nodes.splice(startIdx, endIdx - startIdx + 1, seq)
        this.replaceGeneration += 1
      }
    }
    return event
  }

  // --- test-only convenience builders -------------------------------------

  /** Append a plain user-role text message onto the surface tail. */
  appendUserText(text: string): SessionEvent<'user/message'> {
    const message: UserMessage = {
      id: `msg-${this.log.length}` as UserMessage['id'],
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    }
    return this.append('user/message', message, { surfaceOp: 'append' })
  }

  /** Append an assistant text message (optionally carrying tool calls) onto the surface tail. */
  appendAssistant(turn: number, step: number, message: AssistantMessage): SessionEvent<'assistant/message'> {
    return this.append('assistant/message', { turn, step, message }, { surfaceOp: 'append' })
  }

  /** Append a tool-result message onto the surface tail. */
  appendToolResult(turn: number, step: number, message: ToolResultMessage): SessionEvent<'tool/result'> {
    return this.append('tool/result', { turn, step, message }, { surfaceOp: 'append' })
  }
}
