/**
 * Minimal injected dependency vocabulary for the extracted compaction module.
 *
 * The DeepSeek Harness compaction reads exactly four external surfaces: the
 * event log plus the ordered surface (`dsh-session`), model messages, content
 * blocks, and the stream protocol (`dsh-llm`), per-node token pricing
 * (`dsh-token-meter`), and the LLM call seam. This module ports the minimal
 * faithful subset of each that that logic reads as local types and injectable
 * interfaces, so the module imports no `@deepseek-ai/*` and no Cordis.
 *
 * Ports, verbatim where the logic reads their behavior:
 * - `deepFreeze` from `dsh-llm/src/call-config.ts`
 * - `errorChain`   from `dsh-llm/src/error.ts`
 * - `contentHasImage` from `dsh-llm/src/content.ts`
 * - `assertNever`  from `dsh-llm/src/never.ts`
 * - `createUserMessage` from `dsh-llm/src/message.ts`
 * - `SessionSurface`/`SurfaceOp`/`SurfaceIntent` from `dsh-session/src/types.ts`
 * - `TokenMeasurement`/`TokenSurfaceNode` from `dsh-token-meter/src/types.ts`
 * - compaction event payloads from `dsh-compaction/src/types.ts`
 *
 * Minimalizations, each documented at its use site (PLAN.md divergences):
 * - `ImageBlock` keeps only the discriminant (the extracted logic checks
 *   `contentHasImage`, never image payload fields).
 * - `StreamChunk` drops the `finish` chunk's `replayState` (adapter-private
 *   replay metadata the compaction never consumes).
 * - `TokenMeasurement` keeps the two fields the compaction reads
 *   (`totalTokens`, `nodes`); the full `dsh-token-meter` type also records
 *   `logRevision`, `baseline`, `surfaceDeltaTokens`, and `surfaceTokens`.
 * - `turn/end` drops the full `TurnEndReason` union (the compaction reads only
 *   `turn`), and the surface-conditional `surfaceOp`/`sourceEventSeqs` event
 *   fields are not modeled on `SessionEvent` (the compaction reads event
 *   `data` only; surface placement travels on the `SurfaceIntent` argument).
 * - `EpochHeader` keeps the fields the summarizer reads (`config`, `system`,
 *   `tools`); the full `dsh-session` header also records `adapterDefaults`.
 *
 * @module ./session
 */

import { randomUUID } from 'node:crypto'
import {
  type CommandId as CommandIdentity,
  type CompactionId as CompactionIdentity,
  MessageId,
  SessionId,
  type ToolCallId as ToolCallIdentity,
} from './brand.ts'

/** The branded ids the session vocabulary carries (factories live in `./brand.ts`). */
export type { SessionId, ToolCallId } from './brand.ts'

// ---------------------------------------------------------------------------
// LLM failure and streaming vocabulary
// ---------------------------------------------------------------------------

/**
 * A serializable provider or transport failure.
 *
 * Minimal subset of `dsh-llm`'s `LlmFailure`: the compaction reads `message`
 * and `code` (terminal `error`/`aborted` finish reasons); `dsh-llm` also
 * carries optional `status`, `providerRetryAfterMs`, and `requestId`.
 */
export interface LlmFailure {
  /** Human-readable provider or transport failure. */
  readonly message: string
  /** Stable provider-neutral machine-routing code. */
  readonly code: string
}

/** Plain text visible to the end user. */
export interface TextBlock { readonly type: 'text'; readonly text: string }
/** Model internal reasoning text. */
export interface ReasoningBlock { readonly type: 'reasoning'; readonly text: string }
/**
 * Image produced by the model or sent in the request.
 *
 * Minimal: `dsh-llm`'s `ImageBlock` carries an `attachment` reference the
 * compaction never reads.
 */
export interface ImageBlock { readonly type: 'image' }
/**
 * A tool invocation requested by the model. `arguments` is
 * provider-raw JSON text that may be empty and is not parsed into a
 * provider-specific shape.
 */
export interface ToolCallBlock {
  readonly type: 'tool-call'
  readonly id: ToolCallIdentity
  readonly name: string
  readonly arguments: string
}
/** A tool-result payload correlated by `toolCallId`; content is model-visible. */
export interface ToolResultBlock {
  readonly type: 'tool-result'
  readonly toolCallId: ToolCallIdentity
  readonly content: readonly ContentBlock[]
  readonly isError?: boolean
}

/** One provider-neutral typed content block. */
export type ContentBlock =
  | TextBlock
  | ReasoningBlock
  | ImageBlock
  | ToolCallBlock
  | ToolResultBlock

/**
 * Map from finish-reason key to variant for merge extension; new variants
 * add entries.
 */
export interface FinishReasonMap {
  'stop': { kind: 'stop' }
  'tool-calls': { kind: 'tool-calls' }
  'max-tokens': { kind: 'max-tokens' }
  'aborted': { kind: 'aborted'; failure: LlmFailure }
  'error': { kind: 'error'; failure: LlmFailure }
}

/** Any known finish reason, derived from {@link FinishReasonMap}. */
export type FinishReason = FinishReasonMap[keyof FinishReasonMap]

/**
 * Token accounting for one model call.
 *
 * Counts are DISJOINT: `inputTokens` is uncached input only; cached input is
 * reported separately as `cacheReadTokens`/`cacheWriteTokens` (billed input =
 * sum of the three). `totalTokens` is omitted when unavailable or inconsistent.
 */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

/**
 * Raw streaming protocol emitted by the injected LLM.
 * Block indexes correlate interleaved deltas, and `block-end` carries the
 * assembled block. Adapters emit usage before the terminal finish and nothing
 * afterward.
 *
 * Minimal: the `finish` chunk's adapter-private `replayState` is not
 * modeled (the extracted assembler never consumes it).
 */
export type StreamChunk =
  | { readonly type: 'block-start'; readonly index: number; readonly blockType: string }
  | { readonly type: 'text-delta'; readonly index: number; readonly text: string }
  | { readonly type: 'reasoning-delta'; readonly index: number; readonly text: string }
  | { readonly type: 'tool-call-delta'; readonly index: number; readonly id: ToolCallIdentity; readonly name?: string; readonly argumentsDelta: string }
  | { readonly type: 'block-end'; readonly index: number; readonly block: ContentBlock }
  | { readonly type: 'usage'; readonly usage: TokenUsage }
  | { readonly type: 'finish'; readonly reason: FinishReason }

/** JSON-schema description of a tool, as sent to the model. */
export interface ToolSchema {
  name: string
  description: string
  /** JSON Schema object for the arguments. */
  parameters: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/**
 * Where a message (or injected content) came from.
 *
 * Faithful sum of the four `dsh-llm` kinds: a plain user message, one
 * synthesized by a named plugin (compaction checkpoints add fields to this
 * kind), the producing model route, or a tool result correlated by
 * `callId`.
 */
export interface MessageSourceMap {
  user: { kind: 'user' }
  plugin: { kind: 'plugin'; plugin: string }
  model: ModelMessageSource
  tool: ToolMessageSource
}

/** Assistant-message provenance: the exact route that produced it. */
export interface ModelMessageSource { readonly kind: 'model'; readonly provider: string; readonly model: string }
/** Tool-result provenance: the correlated tool call. */
export interface ToolMessageSource { readonly kind: 'tool'; readonly callId: ToolCallIdentity }

/** Any known message source; switch on `kind` and fall through unknowns. */
export type MessageSource = MessageSourceMap[keyof MessageSourceMap]

/** One immutable message representation shared by history and model requests. */
export interface Message {
  /** Stable identity preserved across every representation boundary. */
  readonly id: ReturnType<typeof MessageId>
  /** Provider-neutral conversation role. */
  readonly role: 'user' | 'assistant'
  /** Exact model-facing blocks. */
  readonly content: readonly ContentBlock[]
  /** Required source fields supplied by the producer. */
  readonly source: MessageSource
}

/** A user-role message: direct human input or synthesized plugin content. */
export interface UserMessage extends Message { readonly role: 'user' }
/** A model-produced assistant message from the exact producing route. */
export interface AssistantMessage extends Message { readonly role: 'assistant'; readonly source: ModelMessageSource }
/**
 * The model requested one tool invocation; `callId` pairs it with its
 * `tool/result`.
 */
export interface ToolResultMessage extends UserMessage { readonly source: ToolMessageSource }

/**
 * Create one identified user-role message and freeze it before publication.
 * @param input - complete content and source for a new user message.
 * @returns an immutable user message with a fresh stable identity.
 */
export function createUserMessage(
  input: { readonly content: readonly ContentBlock[]; readonly source: MessageSource },
): UserMessage {
  return deepFreeze<UserMessage>({
    id: MessageId(randomUUID()),
    role: 'user',
    content: [...input.content],
    source: input.source,
  })
}

// ---------------------------------------------------------------------------
// Session log and surface
// ---------------------------------------------------------------------------

/** Routed model identity in a request configuration. */
export interface LlmCallConfig { readonly provider: string; readonly model: string }

/**
 * Logged request state outside derived history.
 *
 * Minimal: the full `dsh-session` header also records `adapterDefaults`.
 */
export interface EpochHeader {
  /** The conversation's call configuration (provider and model). */
  readonly config: LlmCallConfig
  /** Rendered system prompt text; absent for a system-less request. */
  readonly system?: string
  /** Assembled tool schemas; absent for a tool-less request. */
  readonly tools?: readonly ToolSchema[]
}

/**
 * Durable checkpoint summary record, logged at `compaction/summary`.
 *
 * Ported from `dsh-compaction/src/types.ts` (payloads unchanged). The
 * `llmStreamCall` marker is a separate intersection (see
 * {@link CompactionSummaryLlmMarker}) so the two provenance forms stay
 * mutually exclusive exactly as in the source.
 */
export interface CompactionSummaryData {
  compactionId: CompactionIdentity
  sourceCommandId?: CommandIdentity
  summary: readonly ContentBlock[]
  shadowedRange: { readonly start: number; readonly end: number }
  shadowedSeqs: readonly number[]
  shadowedTokenCount: number
  /** The provider route that wrote the summary. */
  provider: string
  /** The model that wrote the summary (the summarize call's envelope). */
  model: string
  /** The generation cap the summarize call sent, when one applied. */
  maxTokens?: number
  /** Provider-reported token usage for the summarization request, when emitted. */
  usage?: TokenUsage
}

/**
 * Provenance marker for a `compaction/summary` payload: exactly one call
 * through the context's LLM seam (`llmStreamCall: true`, complete
 * `rawOutput`), or an unmarked summary from another summarizer (no
 * `llmStreamCall`, optional `rawOutput`).
 *
 * Ported verbatim from `dsh-compaction/src/types.ts` (lines 53–66).
 */
export type CompactionSummaryLlmMarker =
  | {
    /** Complete provider output before the backend's safe summary projection. */
    readonly rawOutput: readonly ContentBlock[]
    /** Identifies exactly one call through this context's `ctx.llm.stream()`. */
    readonly llmStreamCall: true
  }
  | {
    /** Optional complete output from an unmarked template, remote, or other summarizer. */
    readonly rawOutput?: readonly ContentBlock[]
    /** An unmarked summary does not identify a call through this context's LLM seam. */
    readonly llmStreamCall?: never
  }

/**
 * Log-only record left after compaction. `shadowedSeqs` is the authoritative
 * record of what was removed; `shadowedRange` is the surface-position span the
 * summary replaced — positions, not seqs — and after a prior replacement
 * `start` can be greater than `end`.
 */
export interface CompactionPruneData {
  shadowedRange: { readonly start: number; readonly end: number }
  shadowedSeqs: readonly number[]
  shadowedTokenCount: number
}

/**
 * Appendable session event vocabulary read by the compaction logic.
 *
 * Subset of `dsh-session`'s `SessionEventMap` (turn/message lifecycle plus the
 * compaction/* event types) with the minimalizations listed at module level.
 * The compaction plugin's `compaction/*` types live here rather than in a
 * separate file because the `SessionEvent` union names their payloads.
 */
export interface SessionEventMap {
  /** Opens turn `turn` before the loop claims queued input or runs pre-step. */
  'turn/start': { turn: number }
  /**
   * Closes turn `turn`.
   * Minimal: `dsh-session` records `reason: TurnEndReason`; the compaction
   * reads only `turn`.
   */
  'turn/end': { turn: number }
  /** Marks the end of a constructor seed; see `dsh-session` for the contract. */
  'session/end-seed': Record<string, never>
  /** A user-role message on the model-visible surface. */
  'user/message': UserMessage
  /** Assembled assistant message for one step. */
  'assistant/message': { turn: number; step: number; message: AssistantMessage; usage?: TokenUsage }
  /** A completed tool call's model-facing result. */
  'tool/result': { turn: number; step: number; message: ToolResultMessage }
  /** Durable compaction lock. Only the most recent `compaction/start` may match. */
  'compaction/start': { compactionId: CompactionIdentity; sourceCommandId?: CommandIdentity; turn: number | null }
  /** Durable safe summary and exact shadowed set. */
  'compaction/summary': CompactionSummaryData & CompactionSummaryLlmMarker
  /** Closes its `compaction/start` exactly once. */
  'compaction/end': { compactionId: CompactionIdentity; sourceCommandId?: CommandIdentity; turn: number | null; error?: string }
  /** Log-only record left after compaction. See {@link CompactionPruneData}. */
  'compaction/prune': CompactionPruneData
}

/** The appendable event-type keys of {@link SessionEventMap}. */
export type SessionEventType = keyof SessionEventMap

/**
 * One immutable entry in the session log: a proper discriminated union over
 * `type` (distributive in `k`), so `switch (event.type)` narrows
 * `event.data` without casts.
 */
export type SessionEvent<T extends SessionEventType = SessionEventType> = {
  [K in SessionEventType]: {
    readonly type: K
    /** Monotonic sequence number within the session. */
    readonly seq: number
    /** Unix epoch milliseconds. */
    readonly time: number
    readonly data: SessionEventMap[K]
  }
}[T]

/** The event of one exact type: `SessionEvent<'user/message'>`. */
export type SessionEventOf<T extends SessionEventType> = SessionEvent<T>

/**
 * Event types whose events produce LLM messages and are eligible to appear on
 * the ordered surface; only these may carry {@link SurfaceOp}.
 */
export type SurfaceEventType = 'user/message' | 'assistant/message' | 'tool/result'

/**
 * How a session event entered the ordered surface.
 * - `'append'`: added to the tail — the normal path for messages.
 * - `{ op: 'replace', start, end }`: replaces surface nodes from `start`
 *   (inclusive) through `end` (inclusive) with this one. Compaction uses it.
 */
export type SurfaceOp = 'append' | { readonly op: 'replace'; readonly start: number; readonly end: number }

/** Surface placement and cited source-event seqs for `Session.append`. */
export interface SurfaceIntent {
  surfaceOp: SurfaceOp
  /**
   * Complete set of known source-event seqs. Absent: the event does not
   * record which earlier events produced it.
   */
  sourceEventSeqs?: number[]
}

/** The ordered surface: the seqs of the surface events, plus a replace counter. */
export interface ISessionSurface {
  /** Seqs of the surface events in order; positions are 1-based relative to it. */
  readonly nodes: readonly number[]
  /** Monotonic counter over `Session.replace` — bumped once per replace. */
  readonly replaceGeneration: number
}

/**
 * The injectable session contract: the subset of `dsh-session`
 * `Session` the compaction logic reads. Implementations (the real
 * `dsh-session` or a fixture) keep the log append-only and the surface in
 * sync; the module only reads and appends events plus `SurfaceIntent`s.
 */
export interface ISession {
  /** Stable session identity. */
  readonly id: ReturnType<typeof SessionId>
  /** The full immutable event log. */
  readonly events: readonly SessionEvent[]
  /** The ordered surface for the current model message. */
  readonly surface: ISessionSurface
  /**
   * Append one event and (for surface events) its `SurfaceIntent`.
   * Returns the appended event with the assigned `seq` and `time`.
   */
  append<T extends SessionEventType>(
    type: T,
    data: SessionEventMap[T],
    ...opts: T extends SurfaceEventType ? [opts: SurfaceIntent] : []
  ): SessionEventOf<T>
  /** Reconstruct the latest request header after the last checkpoint. */
  requestHeader(): EpochHeader | undefined
  /** Derive the LLM message an event produces; null for non-message events. */
  deriveEventMessage(event: SessionEvent): Message | null
}

// ---------------------------------------------------------------------------
// Token meter
// ---------------------------------------------------------------------------

/** Route-priced token accounting for one surface node's model-facing message. */
export interface TokenSurfaceNode {
  /** The surface node's log seq. */
  readonly seq: number
  /** Route-priced tokens for the node's model-facing message. */
  readonly tokens: number
  /** Fixed-heuristic tokens for the same message (shadow-price protocol). */
  readonly heuristicTokens: number
}

/**
 * Token measurement of one session.
 *
 * Minimal subset of `dsh-token-meter`'s `TokenMeasurement`: the compaction
 * reads `totalTokens` (pressure) and `nodes` (range selection and shadow
 * pricing); the full type also records `logRevision`, `baseline`,
 * `surfaceDeltaTokens`, and `surfaceTokens`.
 */
export interface TokenMeasurement {
  /** Non-negative current request-and-response pressure. */
  readonly totalTokens: number
  /** Current surface nodes in positional head-to-tail order. */
  readonly nodes: readonly TokenSurfaceNode[]
}

/** The injectable token meter: surface measurement plus message estimation. */
export interface ITokenMeter {
  /** Measure `session`, pricing with `requestHeader` when present. */
  measure(session: ISession): TokenMeasurement
  /** Estimate one message's tokens with the fixed heuristic. */
  estimateMessage(message: Message): number
}

// ---------------------------------------------------------------------------
// LLM client seam
// ---------------------------------------------------------------------------

/** Adapter-declared context capacity for one routed model. */
export interface LlmModelInfo {
  /** Context capacity in tokens, when declared by the adapter. */
  readonly context?: { readonly contextWindow: number }
}

/**
 * A single model request, fully assembled.
 *
 * Minimal projection of `dsh-llm`'s `GenerateOptions` to the fields the
 * compaction sets or reads (the assembler protocol is the same
 * {@link StreamChunk}).
 */
export interface LlmRequest {
  /** Registered provider route selecting the adapter instance. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Ordered conversation messages, exactly as the provider sees them. */
  messages: readonly Message[]
  /** System prompt text (adapters map to the provider's system slot). */
  system?: string
  /** Tool schemas (adapters map to the provider's `tools` field). */
  tools?: readonly ToolSchema[]
  maxTokens?: number
  signal?: AbortSignal
  /** Session identity stamped for request routing. */
  sessionId?: ReturnType<typeof SessionId>
  /** Provider-neutral classification for an auxiliary model call. */
  purpose?: 'compaction' | 'session-title'
}

/** The LLM call seam the compaction summarizes through. */
export interface ILLMClient {
  /**
   * Stream one assembled request. The adapter normalizes adapter failures
   * to a terminal `error` or `aborted` `finish` chunk (or rejects the
   * iteration), mirroring `dsh-llm`'s `LlmRuntime.stream()`.
   */
  stream(request: LlmRequest): AsyncIterable<StreamChunk>

  /**
   * Adapter-declared context capacity for one exact route.
   * @param provider - registered provider route.
   * @param model - provider-owned model id.
   * @param signal - optional cancellation forwarded to the adapter.
   */
  resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<LlmModelInfo>
}

/**
 * The replayed conversation surface the summarizer condenses. Reproducing the
 * last routed request's system prompt, tools, and leading messages verbatim
 * lets the auxiliary call reuse the provider's warm prefix cache; the trailing
 * compaction instruction is then the only novel input.
 */
export interface SummarizationInput {
  /** The conversation's own system prompt, reused for prefix-cache alignment; absent for a system-less request. */
  readonly system?: string
  /** The conversation's tool schemas, reused for prefix-cache alignment; absent when the request carried none. */
  readonly tools?: readonly ToolSchema[]
  /** The shadowed region, in surface order, that precedes the compaction instruction. */
  readonly messages: readonly Message[]
}

/** Safe summary content plus the exact auxiliary call envelope recorded with it. */
export type SummaryResult = {
  summary: readonly ContentBlock[]
  provider: string
  model: string
  maxTokens?: number
  /** Provider-reported usage for this summarization request. */
  usage?: TokenUsage
} & (
  | {
    /** Complete provider output before the text-only summary projection. */
    rawOutput: readonly ContentBlock[]
    /** Identifies exactly one call through this context's `ctx.llm.stream()`. */
    llmStreamCall: true
  }
  | {
    /** Optional complete output from an unmarked template, remote, or other summarizer. */
    rawOutput?: readonly ContentBlock[]
    /** An unmarked result does not identify a call through this context's LLM seam. */
    llmStreamCall?: never
  }
)

// ---------------------------------------------------------------------------
// Agent contract
// ---------------------------------------------------------------------------

/** The injectable context a compaction acts on: one session plus the routed model. */
export interface CompactionAgentContext {
  /** The session being compacted. */
  readonly session: ISession
  /**
   * Per-invocation provider/model override. Both present and non-empty when
   * set; absent for a session-routed call.
   */
  readonly options: { readonly provider?: string; readonly model?: string }
}

/**
 * A `CompactionAgentContext` that can run an isolated manual task under its
 * operation signal (the manual `compaction` entry).
 */
export interface ManualCompactAgentContext extends CompactionAgentContext {
  /**
   * Run one isolated maintenance task under this agent's operation signal.
   * The agent's own signal cancels the isolated operation.
   */
  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>
}

// ---------------------------------------------------------------------------
// Ported utilities
// ---------------------------------------------------------------------------

/**
 * Recursively freeze an object graph (ported from `dsh-llm/call-config.ts`).
 * Iterative: no recursion-depth limit on tall graphs. `AbortSignal` instances
 * are skipped so live cancellation objects are not frozen.
 *
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
 * Render an error (or any thrown value) with its `cause` chain (ported from
 * `dsh-llm/error.ts`): the outermost message first, each cause appended with
 * `: ` (skipped when it repeats the wrapper message verbatim), and
 * `AggregateError` members bracketed and `; `-joined. Hostile nodes collapse
 * to markers; nothing escapes.
 *
 * @param value - the thrown value (usually an `Error`).
 * @returns the rendered chain.
 */
export function errorChain(value: unknown): string {
  // Tracks the active recursion path (entries removed on exit), so only true
  // cycles are flagged and a diamond-shared cause still renders in full.
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
      // Only hostile coercion or hostile accessors (a throwing toString /
      // Symbol.toPrimitive on a non-Error, or a throwing message/name/cause/
      // errors getter on an Error subclass): this renderer feeds UI notices
      // and logs, so nothing may escape.
      return '<unrenderable value>'
    } finally {
      path.delete(current)
    }
  }
  return render(value)
}

/**
 * Check whether any content block in the list is an `image` block.
 * (Ported from `dsh-llm/content.ts`; images inside `tool-result` content are
 * checked recursively.)
 *
 * @param blocks - the content blocks to check.
 * @returns true when at least one block is image.
 */
export function contentHasImage(blocks: readonly ContentBlock[]): boolean {
  return blocks.some(block => {
    if (block.type === 'image') return true
    if (block.type === 'tool-result') return contentHasImage(block.content)
    return false
  })
}

/**
 * Exhaustiveness backstop for closed discriminated unions (ported from
 * `dsh-llm/never.ts`). The union's own type system guarantees this call site
 * is unreachable; the throw only fires when the union was extended without
 * updating the switch.
 *
 * @param value - the narrowed value, always `never` at a valid call site.
 * @param context - optional context for the thrown `Error` message.
 * @returns never — the function never returns.
 * @throws always — `assertNever` is a control-flow exhaustiveness backstop.
 */
export function assertNever(value: never, context?: string): never {
  const detail = context !== undefined ? `${context}: ` : ''
  let rendered: string
  try {
    rendered = JSON.stringify(value)
  } catch {
    rendered = String(value)
  }
  throw new Error(`${detail}unreachable: ${rendered}`)
}
