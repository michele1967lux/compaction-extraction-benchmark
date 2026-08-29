/**
 * Result vocabulary for a successful compaction transaction.
 *
 * Verbatim port of `packages/compaction/compaction/src/types.ts`
 * (`@deepseek-ai/dsh-compaction/types`) — same fields, same semantics. The
 * `compaction/*` session-event payload shapes that the real `types.ts` adds
 * to `dsh-session`'s `SessionEventMap` via cross-package declaration merging
 * live in `session.ts` here instead (PLAN.md divergence #4), since this
 * module has no second package to reopen.
 *
 * @module types
 */

import type { CommandId, CompactionId } from './brand.js'
import type { ContentBlock } from './session.js'

/** Result of a successful compaction operation. */
export interface CompactionResult {
  /** Stable identity shared by this compaction's complete durable lifecycle. */
  compactionId: CompactionId
  /** Human command that initiated this compaction, when it was manual. */
  sourceCommandId?: CommandId
  /** The seq of the appended `compaction/start` event. */
  startSeq: number
  /** The seq of the appended `compaction/summary` event. */
  summarySeq: number
  /** The seq of the appended `compaction/end` event. */
  endSeq: number
  /** The summary content blocks produced by the backend. */
  summary: ContentBlock[]
  /**
   * The surface-boundary pair that was shadowed: the seqs of the first
   * (`start`) and last (`end`) surface nodes of the replaced range. A
   * surface-POSITION span, not a numeric seq interval — after a prior replace
   * lands a fresh high-seq summary node at an older range's position, `start`
   * can be GREATER than `end`. {@link CompactionResult.shadowedSeqs} is the
   * authoritative set of shadowed nodes, in surface order.
   */
  shadowedRange: { start: number; end: number }
  /** The seqs of all shadowed surface nodes, in surface order. */
  shadowedSeqs: number[]
  /** Estimated token count of the shadowed content. */
  shadowedTokenCount: number
}
