/**
 * Nominal id typing for the extracted compaction module — a faithful port of
 * `@deepseek-ai/dsh-brand` (`Branded`) plus the concrete brands the
 * compaction logic carries, each with the owning factory that mints them.
 *
 * A brand makes structurally identical strings non-interchangeable at the
 * type level: a `CompactionId` cannot be passed where a `CommandId` is
 * expected, even though both are plain strings at runtime. Comparison,
 * logging, and serialization all behave as ordinary strings.
 *
 * @module ./brand
 */

declare const BRAND: unique symbol

/** A string carrying a compile-time-only brand `B`. */
export type Branded<B extends string> = string & { readonly [BRAND]: B }

/** Factory for one concrete nominal id type: no runtime cost, no validation. */
function mint<B extends string>(id: string): Branded<B> {
  return id as Branded<B>
}

/** Stable identity shared by one compact start/summary/checkpoint/end transaction. */
export type CompactionId = Branded<'CompactionId'>

/**
 * Brand an implementation-minted compaction identity.
 * @param id - opaque transaction identity.
 * @returns the same string, branded; no validation is performed.
 */
export function CompactionId(id: string): CompactionId {
  return mint(id)
}

/** Stable identity of one human command invocation, shared with the session log. */
export type CommandId = Branded<'CommandId'>

/**
 * Brand a raw command-invocation identity.
 * @param id - the raw command id.
 * @returns the same string, branded; no validation is performed.
 */
export function CommandId(id: string): CommandId {
  return mint(id)
}

/** Stable identity of one session, shared with the session log. */
export type SessionId = Branded<'SessionId'>

/**
 * Brand a raw session identity.
 * @param id - the raw session id.
 * @returns the same string, branded; no validation is performed.
 */
export function SessionId(id: string): SessionId {
  return mint(id)
}

/** Provider-issued tool-call id correlating a `tool-call` block with its `tool-result`. */
export type ToolCallId = Branded<'ToolCallId'>

/** Stable identity of one message, preserved across every representation boundary. */
export type MessageId = Branded<'MessageId'>

/**
 * Brand a raw message identity.
 * @param id - the raw message id.
 * @returns the same string, branded; no validation is performed.
 */
export function MessageId(id: string): MessageId {
  return mint(id)
}

/**
 * Brand a raw provider tool-call id.
 * @param id - the raw tool call id.
 * @returns the same string, branded; no validation is performed.
 */
export function ToolCallId(id: string): ToolCallId {
  return mint(id)
}
