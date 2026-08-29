/**
 * Nominal-typing primitive plus every branded cross-boundary id the
 * compaction module needs.
 *
 * Source fidelity: `Branded<B>` is a verbatim port of
 * `packages/util/brand/src/index.ts` (`@deepseek-ai/dsh-brand`). Each
 * concrete brand below (`CompactionId`, `CommandId`, `SessionId`,
 * `MessageId`, `ToolCallId`, `ReasoningEffortId`) is a verbatim port of the
 * matching brand constructor from its owning source package
 * (`dsh-compaction/brand.ts`, `dsh-commands/brand.ts`, `dsh-llm/brand.ts`):
 * same construction (a plain cast, no validation), same "own the ids you
 * mint" policy. The only change is PHYSICAL: the real harness spreads these
 * across four packages (`dsh-brand`, `dsh-llm`, `dsh-commands`,
 * `dsh-compaction`) because each package owns the ids it mints; this
 * extracted, single-package module consolidates them into one file since
 * there is no multi-package boundary left to justify the split (declared in
 * PLAN.md, divergence #3).
 *
 * @module brand
 */

declare const BRAND: unique symbol

/** A string carrying a compile-time-only brand `B`. */
export type Branded<B extends string> = string & { readonly [BRAND]: B }

/** Stable identity shared by one compact start/summary/checkpoint/end transaction. */
export type CompactionId = Branded<'CompactionId'>

/**
 * Brand an implementation-minted compaction identity.
 * @param id - opaque transaction identity.
 * @returns the same string, branded; no validation is performed.
 */
export function CompactionId(id: string): CompactionId {
  return id as CompactionId
}

/**
 * Pairs one command execution's lifecycle records with each other and with
 * its admission response. Minted by the executor, monotonic per service
 * instance.
 */
export type CommandId = Branded<'CommandId'>

/**
 * Brand a string as a {@link CommandId}.
 * @param id - the executor-minted pairing id.
 * @returns the same string, branded; no validation is performed.
 */
export function CommandId(id: string): CommandId {
  return id as CommandId
}

/** Stable session identity, derived from a session's durable header. */
export type SessionId = Branded<'SessionId'>

/**
 * Brand a string as a {@link SessionId}.
 * @param id - the store-minted session identity.
 * @returns the same string, branded; no validation is performed.
 */
export function SessionId(id: string): SessionId {
  return id as SessionId
}

/** Stable identity preserved across every message representation boundary. */
export type MessageId = Branded<'MessageId'>

/**
 * Brand a string as a {@link MessageId}.
 * @param id - the freshly minted message identity.
 * @returns the same string, branded; no validation is performed.
 */
export function MessageId(id: string): MessageId {
  return id as MessageId
}

/** Provider-issued tool-call id; correlates a call with its matching result. */
export type ToolCallId = Branded<'ToolCallId'>

/**
 * Brand a string as a {@link ToolCallId}.
 * @param id - the provider-issued call id.
 * @returns the same string, branded; no validation is performed.
 */
export function ToolCallId(id: string): ToolCallId {
  return id as ToolCallId
}

/** Opaque stable value accepted by an adapter-owned reasoning effort selection. */
export type ReasoningEffortId = Branded<'ReasoningEffortId'>

/**
 * Brand a string as a {@link ReasoningEffortId}.
 * @param id - the adapter-owned effort identity.
 * @returns the same string, branded; no validation is performed.
 */
export function ReasoningEffortId(id: string): ReasoningEffortId {
  return id as ReasoningEffortId
}
