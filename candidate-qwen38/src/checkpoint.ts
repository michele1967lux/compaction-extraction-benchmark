/**
 * Compaction checkpoint provenance: the correlated source constructor and type
 * every backend uses for its replacement user message, plus the predicate that
 * recognizes persisted checkpoints.
 *
 * Ported 1:1 from `dsh-compaction/src/checkpoint.ts` (the source module is a
 * pure type/value/predicate outlet with no Cordis imports; the only change is
 * the import paths for `MessageSource` and the branded ids).
 *
 * @module ./checkpoint
 */

import type { CommandId, CompactionId } from './brand.ts'
import type { MessageSource } from './session.ts'

const COMPACT_CHECKPOINT_MARKER = Object.freeze({ kind: 'plugin', plugin: 'compact' } as const)

/** Message provenance carried by a concrete compaction checkpoint. */
export type CompactionCheckpointSource = typeof COMPACT_CHECKPOINT_MARKER & {
  readonly compactionId: CompactionId
  readonly sourceCommandId?: CommandId
}

/**
 * Create checkpoint provenance correlated with one compaction transaction.
 * @param compactionId - owning compaction identity.
 * @param sourceCommandId - initiating manual command, when present.
 * @returns immutable checkpoint source.
 */
export function compactCheckpointSource(
  compactionId: CompactionId,
  sourceCommandId?: CommandId,
): CompactionCheckpointSource {
  return Object.freeze({
    ...COMPACT_CHECKPOINT_MARKER,
    compactionId,
    ...sourceCommandId === undefined ? {} : { sourceCommandId },
  })
}

/**
 * Test whether a persisted message source identifies a compaction checkpoint.
 * @param source - source restored from a surface user message.
 * @returns whether the source carries the backend-independent checkpoint marker.
 */
export function isCompactCheckpointSource(source: MessageSource): boolean {
  return source.kind === 'plugin' && source.plugin === COMPACT_CHECKPOINT_MARKER.plugin
}
