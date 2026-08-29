/**
 * Minimal injected vocabulary and interfaces the compaction module depends
 * on: the session/surface/event-log shape (`ISession`), the token-pressure
 * measurement shape (`ITokenMeter`), the LLM call shape (`ILlmService`), the
 * message/content-block vocabulary they all share, and the handful of small
 * runtime helpers (`deepFreeze`, `createUserMessage`, `contentHasImage`,
 * `errorChain`, `LlmError`, `assertNever`, …) that the ported compaction
 * logic calls directly.
 *
 * Source fidelity: every type and function below is a verbatim port of the
 * matching declaration in `packages/core/session/src/{index,surface,types}.ts`,
 * `packages/llm/token-meter/src/{index,types}.ts`, or
 * `packages/llm/llm/src/{types,message,content,assembler,error,call-config,never}.ts`
 * — same field names, same shapes, same algorithms. The only change is
 * PHYSICAL consolidation: the real harness spreads this vocabulary across
 * three packages (`dsh-session`, `dsh-llm`, `dsh-token-meter`) that the
 * concrete `Session`/`TokenMeter`/`LlmRuntime` classes implement; this
 * extracted module instead declares the same surface as three minimal
 * interfaces (`ISession`, `ITokenMeter`, `ILlmService`) that any concrete
 * implementation — Cordis-based or not — can satisfy, per TASK.md's explicit
 * requirement ("le dipendenze esterne vanno iniettate via interfacce
 * minime"). Declared as PLAN.md divergence #3/#4.
 *
 * @module session
 */

import { randomUUID } from 'node:crypto'
import {
  CompactionId,
  CommandId,
  MessageId,
  ToolCallId,
  type ReasoningEffortId,
  type SessionId,
} from './brand.js'

// ---------------------------------------------------------------------------
// Content blocks (verbatim port of dsh-llm/src/types.ts ContentBlock family)
// ---------------------------------------------------------------------------

/** Plain text visible to the end user. */
export interface TextBlock {
  type: 'text'
  text: string
}

/** Reasoning / thinking content, distinct from visible text. */
export interface ReasoningBlock {
  type: 'reasoning'
  text: string
}

/**
 * Durable normalized-image reference metadata. A minimal, self-contained
 * stand-in for `dsh-attachment`'s `ImageAttachmentRef`: compaction only ever
 * tests `block.type === 'image'` (`contentHasImage`) and never reads these
 * fields itself, so the attachment service's full byte-storage machinery is
 * intentionally not pulled into this Cordis-free module.
 */
export interface ImageAttachmentRef {
  attachmentId: string
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  bytes: number
  width: number
  height: number
  name?: string
}

/**
 * A durable raster image reference, valid in user or assistant content.
 */
export interface ImageBlock {
  type: 'image'
  attachment: ImageAttachmentRef
}

/** A tool invocation requested by the model. */
export interface ToolCallBlock {
  type: 'tool-call'
  /** Provider-issued call id; correlates with the matching tool result. */
  id: ToolCallId
  name: string
  /** Raw JSON string as produced by the model. */
  arguments: string
}

/** The result of a tool invocation, sent back to the model. */
export interface ToolResultBlock {
  type: 'tool-result'
  toolCallId: ToolCallId
  content: ContentBlock[]
  isError?: boolean
}

/** Merge-extensible content blocks keyed by `type`. */
export interface ContentBlockMap {
  'text': TextBlock
  'reasoning': ReasoningBlock
  'image': ImageBlock
  'tool-call': ToolCallBlock
  'tool-result': ToolResultBlock
}

/** The block `type` tag vocabulary. */
export type ContentBlockType = keyof ContentBlockMap
/** Any known content block; switch on `type`. */
export type ContentBlock = ContentBlockMap[ContentBlockType]

// ---------------------------------------------------------------------------
// Token accounting and tool schemas
// ---------------------------------------------------------------------------

/**
 * Token accounting for one model call. Counts are DISJOINT: `inputTokens` is
 * uncached input only; cached input is reported separately.
 */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

/** JSON-schema description of a tool, as sent to the model. */
export interface ToolSchema {
  name: string
  description: string
  /** JSON Schema object for the arguments. */
  parameters: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Messages (verbatim port of dsh-llm/src/message.ts)
// ---------------------------------------------------------------------------

/** Provider/model identity for an assistant message. */
export interface AssistantProvenance {
  provider: string
  model: string
  replayState?: unknown
}

/** Required source of an assistant message produced by a routed model. */
export interface ModelMessageSource extends AssistantProvenance {
  kind: 'model'
}

/** Required source of a user-role message carrying one tool result. */
export interface ToolMessageSource {
  kind: 'tool'
  callId: ToolCallId
}

/** Where a message (or injected content) came from. Merge-extensible sum type. */
export interface MessageSourceMap {
  user: { kind: 'user' }
  plugin: { kind: 'plugin'; plugin: string }
  model: ModelMessageSource
  tool: ToolMessageSource
}

/** Any known message source; switch on `kind` and fall through unknowns. */
export type MessageSource = MessageSourceMap[keyof MessageSourceMap]

/** One immutable message representation shared by delivery, durable history, and model requests. */
export interface Message {
  readonly id: MessageId
  readonly role: 'system' | 'user' | 'assistant'
  readonly content: ContentBlock[]
  readonly source: MessageSource
}

/** A user-role specialization of the shared message representation. */
export interface UserMessage extends Message {
  readonly role: 'user'
}

/** A model-produced assistant specialization of the shared message representation. */
export interface AssistantMessage extends Message {
  readonly role: 'assistant'
  readonly source: ModelMessageSource
}

/** A tool-result specialization whose model-facing block retains call correlation. */
export interface ToolResultMessage extends Message {
  readonly role: 'user'
  readonly content: [ToolResultBlock]
  readonly source: ToolMessageSource
}

type NewMessage = Omit<Message, 'id'>
type NewUserMessage = Omit<UserMessage, 'id' | 'role'>

/**
 * Deep-freeze a value in place with an iterative traversal, guarding cycles.
 * {@link AbortSignal} objects are skipped because freezing them breaks abort.
 * Verbatim port of `dsh-llm/src/call-config.ts#deepFreeze`.
 * @param value - the value to freeze in place.
 * @returns the same value, frozen.
 */
export function deepFreeze<T>(value: T): T {
  const seen = new WeakSet<object>()
  const pending: (
    | { kind: 'visit'; node: unknown }
    | { kind: 'property'; source: Record<string, unknown>; key: string }
  )[] = [{ kind: 'visit', node: value }]
  while (pending.length > 0) {
    const task = pending.pop()
    if (task === undefined) continue
    if (task.kind === 'property') {
      pending.push({ kind: 'visit', node: task.source[task.key] })
      continue
    }
    const node = task.node
    if (node === null || typeof node !== 'object') continue
    if (node instanceof AbortSignal) continue
    if (seen.has(node)) continue
    seen.add(node)
    Object.freeze(node)
    const keys = Object.keys(node)
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index]
      if (key === undefined) continue
      pending.push({ kind: 'property', source: node as Record<string, unknown>, key })
    }
  }
  return value
}

/**
 * Detach and deep-freeze a message whose identity already exists.
 * @param message - complete message, including its stable identity.
 * @returns an immutable snapshot that preserves the identity.
 */
export function freezeMessage<T extends Message>(message: T): T {
  return deepFreeze(structuredClone(message))
}

/**
 * Create one identified message and freeze it before publication.
 * @param input - complete role, content, and source for a new message.
 * @returns an immutable message with a fresh stable identity.
 */
export function createMessage<T extends NewMessage>(
  input: T & { readonly id?: never },
): T & Pick<Message, 'id'> {
  return freezeMessage({
    ...input,
    id: MessageId(randomUUID()),
  })
}

/**
 * Create one identified user-role message and freeze it before publication.
 * @param input - complete content and source for a new user message.
 * @returns an immutable user message with a fresh stable identity.
 */
export function createUserMessage<T extends NewUserMessage>(
  input: T & { readonly id?: never; readonly role?: never },
): T & Pick<UserMessage, 'id' | 'role'> {
  return createMessage({
    ...input,
    role: 'user',
  })
}

/**
 * True when typed model content contains an image block, walking nested
 * tool-result content. Verbatim port of `dsh-llm/src/content.ts#contentHasImage`.
 * @param content - typed model content blocks.
 * @returns whether any nested block is an image.
 */
export function contentHasImage(content: readonly ContentBlock[]): boolean {
  return content.some(block => block.type === 'image'
    || (block.type === 'tool-result' && contentHasImage(block.content)))
}

// ---------------------------------------------------------------------------
// Error vocabulary (verbatim port of dsh-llm/src/error.ts)
// ---------------------------------------------------------------------------

/** Base class for module errors. Carries a stable machine-routable `code`. */
export class HarnessError extends Error {
  readonly code: string

  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, options)
    this.code = code
    this.name = new.target.name
  }
}

/** Structured provider facts and cause accepted by {@link LlmError}. */
export interface LlmErrorOptions extends ErrorOptions {
  status?: number
  providerRetryAfterMs?: number
  requestId?: string
}

/** Typed error for LLM-related failures. */
export class LlmError extends HarnessError {
  constructor(message: string, code: string, options?: LlmErrorOptions) {
    super(message, code, options)
    this.name = 'LlmError'
  }
}

/** Canonical provider-neutral code for a model request rejected because its context window was exceeded. */
export const CONTEXT_WINDOW_EXCEEDED_CODE = 'CONTEXT_WINDOW_EXCEEDED'

/**
 * Render a thrown value with its full `cause` chain and `AggregateError`
 * members. Verbatim port of `dsh-llm/src/error.ts#errorChain`.
 * @param value - the caught value (`unknown` in catch clauses).
 * @returns the outermost message first, each cause appended with `: `.
 */
export function errorChain(value: unknown): string {
  const path = new Set<unknown>()
  const render = (current: unknown): string => {
    if (path.has(current)) return '<circular cause>'
    path.add(current)
    try {
      if (!(current instanceof Error)) {
        if (typeof current === 'object' && current !== null) {
          const descriptor = Object.getOwnPropertyDescriptor(current, 'message')
          if (descriptor !== undefined && 'value' in descriptor && typeof descriptor.value === 'string') {
            return descriptor.value
          }
        }
        return String(current)
      }
      const message = current.message === '' ? current.name : current.message
      const members = current instanceof AggregateError && current.errors.length > 0
        ? ` [${current.errors.map(render).join('; ')}]`
        : ''
      const causeText = current.cause === undefined || current.cause === null
        ? ''
        : render(current.cause)
      const cause = causeText === '' || causeText === message ? '' : `: ${causeText}`
      return `${message}${members}${cause}`
    } catch {
      return '<unrenderable value>'
    } finally {
      path.delete(current)
    }
  }
  return render(value)
}

/**
 * Exhaustiveness helper for closed unions. Call at a `default` branch so an
 * unhandled new variant fails to compile.
 * Verbatim port of `dsh-llm/src/never.ts#assertNever`.
 * @param value - the value the compiler has narrowed to `never`.
 * @param context - label included in the runtime diagnostic.
 * @throws always; only reachable if a new union member was added without a matching branch.
 */
export function assertNever(value: never, context?: string): never {
  throw new Error(`unreachable case${context === undefined ? '' : ` (${context})`}: ${JSON.stringify(value)}`)
}

// ---------------------------------------------------------------------------
// LLM call vocabulary (verbatim port of dsh-llm/src/{types,call-config}.ts)
// ---------------------------------------------------------------------------

/** Provider, model, reasoning effort, and sampling scalars of one conversation's requests. */
export interface LlmCallConfig {
  provider: string
  model: string
  reasoningEffort?: ReasoningEffortId
  temperature?: number
  maxTokens?: number
  stop?: string[]
}

/** Why a model response stopped. Merge-extensible so adapters can surface provider-specific reasons. */
export interface FinishReasonMap {
  'stop': { kind: 'stop' }
  'tool-calls': { kind: 'tool-calls' }
  'max-tokens': { kind: 'max-tokens' }
  'aborted': { kind: 'aborted'; failure: LlmFailure }
  'error': { kind: 'error'; failure: LlmFailure }
}

/** Any known finish reason; switch on `kind`. */
export type FinishReason = FinishReasonMap[keyof FinishReasonMap]

/** Human-readable provider or transport failure. */
export interface LlmFailure {
  readonly message: string
  readonly code: string
  readonly status?: number
  readonly providerRetryAfterMs?: number
  readonly requestId?: string
}

/**
 * Adapter-private lossless-JSON state for replaying a successful response,
 * carried by a terminal `finish` chunk.
 */
export interface ReplayEnvelope {
  response: unknown
  blocks?: readonly unknown[]
}

/** Raw streaming protocol emitted by adapters. */
export type StreamChunk =
  | { type: 'block-start'; index: number; blockType: ContentBlockType }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: ToolCallId; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: ContentBlock }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'finish'; reason: FinishReason; replayState?: ReplayEnvelope }

/** A single model request, fully assembled. */
export interface GenerateOptions {
  provider: string
  model: string
  reasoningEffort?: ReasoningEffortId
  messages: Message[]
  /** System prompt text. */
  system?: string
  tools?: ToolSchema[]
  temperature?: number
  maxTokens?: number
  stop?: string[]
  signal?: AbortSignal
  /** Session identity stamped for request routing/replay. */
  sessionId?: SessionId
  /** Provider-neutral classification for an auxiliary model call. */
  purpose?: 'compaction' | 'session-title'
}

/** Provider-owned context capacity for one exact provider/model route. */
export interface LlmModelContext {
  /** Maximum combined request and response context in tokens. */
  contextWindow: number
}

/** Exact-route model metadata resolved by its owning adapter. */
export interface LlmResolvedModelInfo {
  provider: string
  id: string
  name: string
  /** Provider-owned context capacity when known. */
  context?: LlmModelContext
}

/**
 * Minimal LLM capability the compaction module needs: stream one model call,
 * and resolve exact-route model metadata (context window) for pressure
 * pricing. A verbatim-shaped subset of `LlmRuntime`
 * (`packages/llm/llm/src/index.ts`)'s public `stream()`/`resolveModelInfo()`.
 */
export interface ILlmService {
  /**
   * Dispatch one model call and stream its raw chunks.
   * @param options - fully assembled request.
   * @returns the raw provider chunk stream.
   */
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>

  /**
   * Resolve all metadata from the adapter that owns one exact route.
   * @param provider - registered provider route to inspect.
   * @param model - exact model id passed to the adapter.
   * @param signal - optional cancellation for adapter-owned asynchronous lookup.
   * @returns exact model identity plus available context metadata.
   */
  resolveModelInfo(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo>
}

// ---------------------------------------------------------------------------
// Session event log and surface (verbatim port of dsh-session/src/{types,surface}.ts)
// ---------------------------------------------------------------------------

/** JSON-serializable value; matches the `tool/result` event's opaque `meta` payload. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

/**
 * Logged request state outside derived history: call config, system prompt,
 * and tools. The latest full snapshot reconstructs it.
 */
export interface EpochHeader {
  /** The conversation's call configuration (provider, model, …). */
  config: LlmCallConfig
  /** Rendered system prompt text; absent for a system-less request. */
  system?: string
  /** Assembled tool schemas; absent for a tool-less request. */
  tools?: ToolSchema[]
}

/**
 * The merge-extensible, append-only source of truth for an agent
 * interaction, restricted to the event types the compaction module reads or
 * writes. The real `SessionEventMap` (`dsh-session/src/types.ts`) carries
 * many more event types (`step/start`, `request/header`, …); this module
 * never appends or inspects them, so they are intentionally absent here —
 * `ISession.requestHeader()` exposes the one derived fact compaction needs
 * from that wider vocabulary as a first-class method instead.
 *
 * The four `compaction/*` entries are ported from `dsh-compaction/src/types.ts`,
 * where the real source adds them to `dsh-session`'s map via cross-package
 * TypeScript declaration merging
 * (`declare module '@deepseek-ai/dsh-session/types' { interface SessionEventMap {...} }`).
 * There is no second package to reopen here, so they are declared directly
 * as part of this one map (PLAN.md divergence #4) — same field names, same
 * shapes.
 */
export interface SessionEventMap {
  /** Opens turn `turn`. */
  'turn/start': { turn: number }
  /**
   * Closes turn `turn`. `reason` is a merge-extensible tag in the real
   * source (`TurnEndReason`); compaction never reads its value, only the
   * event's presence, so it is typed loosely here.
   */
  'turn/end': { turn: number; reason: string }
  /** A user-role message on the model-visible surface. */
  'user/message': UserMessage
  /** Assembled assistant message for one step. */
  'assistant/message': { turn: number; step: number; message: AssistantMessage; usage?: TokenUsage; interrupted?: true }
  /** A completed tool call's model-facing result. */
  'tool/result': { turn: number; step: number; message: ToolResultMessage; error?: { name: string; code: string }; meta?: JsonValue }
  /** Marks the end of a constructor seed (resume/fork/replay boundary). */
  'session/end-seed': Record<string, never>
  /** Marks the start of a compaction — log-only, holds the lock until `compaction/end`. */
  'compaction/start': { compactionId: CompactionId; sourceCommandId?: CommandId; turn: number | null }
  /** Completed summary, its inputs, and its model call facts — log-only. */
  'compaction/summary': {
    compactionId: CompactionId
    sourceCommandId?: CommandId
    summary: ContentBlock[]
    shadowedRange: { start: number; end: number }
    shadowedSeqs: number[]
    shadowedTokenCount: number
    provider: string
    model: string
    maxTokens?: number
    usage?: TokenUsage
  } & (
    | { rawOutput: ContentBlock[]; llmStreamCall: true }
    | { rawOutput?: ContentBlock[]; llmStreamCall?: never }
  )
  /** Marks the end of a compaction — log-only, releases the lock. */
  'compaction/end': { compactionId: CompactionId; sourceCommandId?: CommandId; turn: number | null; error?: string }
  /** Shadow price of one model-free prune replacement — log-only. */
  'compaction/prune': {
    shadowedRange: { start: number; end: number }
    shadowedSeqs: number[]
    shadowedTokenCount: number
  }
}

/** The appendable event-type keys of {@link SessionEventMap}. */
export type SessionEventType = keyof SessionEventMap

/** The subset of {@link SessionEventType} values whose events produce LLM messages and join the surface. */
export type SurfaceEventType =
  | 'user/message'
  | 'assistant/message'
  | 'tool/result'

/** How a session event entered the ordered surface. */
export type SurfaceOp =
  | 'append'
  | { op: 'replace'; start: number; end: number }

/** Surface placement and cited source-event seqs for {@link ISession.append}. */
export interface SurfaceIntent {
  surfaceOp: SurfaceOp
  sourceEventSeqs?: number[]
}

/** One immutable entry in the session log. */
export type SessionEvent<T extends SessionEventType = SessionEventType> = {
  [K in SessionEventType]: {
    type: K
    /** Monotonic sequence number within the session. */
    seq: number
    /** Unix epoch milliseconds. */
    time: number
    data: SessionEventMap[K]
  } & (K extends SurfaceEventType ? {
    sourceEventSeqs?: number[]
    surfaceOp?: SurfaceOp
  } : object)
}[T]

/** Readonly live projection of the message-producing session events. */
export interface SessionSurface {
  /** Current surface event sequences in model-visible order. */
  readonly nodes: readonly number[]
  /** Monotonic count of committed positional replacements. */
  readonly replaceGeneration: number
}

/**
 * Minimal session capability the compaction module needs: an append-only
 * event log, its derived ordered surface, the latest request header, and
 * per-node message projection. A verbatim-shaped subset of `Session`
 * (`packages/core/session/src/index.ts`)'s public API — same method names,
 * same contracts (append validates and freezes; `events`/`surface` are live
 * read-only views).
 */
export interface ISession {
  /** The session identity. */
  readonly id: SessionId
  /** The ordered surface over this session's event log. */
  readonly surface: SessionSurface
  /** An immutable snapshot of the append-only event log. */
  readonly events: readonly SessionEvent[]

  /**
   * Append one typed event to the log.
   * @param type - the event type.
   * @param data - the event payload.
   * @param opts - surface metadata; required for {@link SurfaceEventType} events.
   * @returns the logged event, with its assigned `seq`/`time`.
   */
  append<T extends SessionEventType>(
    type: T,
    data: SessionEventMap[T],
    ...opts: T extends SurfaceEventType ? [opts: SurfaceIntent] : []
  ): SessionEvent<T>

  /**
   * The {@link EpochHeader} in force after the log's last header event.
   * @returns the folded header, or undefined before the first snapshot.
   */
  requestHeader(): EpochHeader | undefined

  /**
   * Project one event into the LLM message it derives to.
   * @param event - the event to project.
   * @returns the derived message, or null when the event produces none.
   */
  deriveEventMessage(event: SessionEvent): Message | null
}

// ---------------------------------------------------------------------------
// Agent context
// ---------------------------------------------------------------------------

/**
 * Minimal agent context compaction needs, decoupled from any concrete agent
 * package: the session being compacted, and the caller's current routing
 * options (used as a summarization-target fallback when no request routed
 * one yet). Verbatim-shaped port of `CompactionAgentContext`
 * (`packages/compaction/compaction/src/index.ts`).
 *
 * Declared here, in the shared vocabulary module, rather than in `engine.ts`
 * (where the real source declares it) so `summarizer.ts` can depend on this
 * shape without depending on `engine.ts` — this module's dependency graph
 * has `engine.ts` depend on `summarizer.ts`, never the reverse (see
 * PLAN.md's file-dependency list). `engine.ts` re-exports this same type
 * under its source name and extends it for `ManualCompactAgentContext`.
 */
export interface CompactionAgentContext {
  readonly session: ISession
  readonly options: { readonly provider?: string; readonly model?: string }
}

// ---------------------------------------------------------------------------
// Token metering (verbatim port of dsh-token-meter/src/{index,types}.ts)
// ---------------------------------------------------------------------------

/** One token-priced node in the current ordered session surface. */
export interface TokenSurfaceNode {
  /** Durable sequence number of the surface event. */
  readonly seq: number
  /** Request-pressure tokens for the exact message projected by this node under the measured route. */
  readonly tokens: number
  /** Fixed-heuristic tokens for the same message, independent of any route. */
  readonly heuristicTokens: number
}

/** Detached immutable request-pressure and surface snapshot at one consumed log revision. */
export interface TokenMeasurement {
  /** Non-negative current request-and-response pressure. */
  readonly totalTokens: number
  /** Current surface nodes in positional head-to-tail order. */
  readonly nodes: readonly TokenSurfaceNode[]
}

/**
 * Minimal token-pressure capability the compaction module needs: measure a
 * session's current surface, and price one hand-built message the same way.
 * A verbatim-shaped subset of `TokenMeter` (`packages/llm/token-meter/src/index.ts`).
 */
export interface ITokenMeter {
  /**
   * Measure current request-and-response pressure and per-node prices.
   * @param session - session whose current surface is measured.
   * @returns the detached pressure snapshot.
   */
  measure(session: ISession): TokenMeasurement

  /**
   * Price one hand-built message under the fixed heuristic estimator.
   * @param message - the message to price.
   * @returns the estimated token count.
   */
  estimateMessage(message: Message): number
}
