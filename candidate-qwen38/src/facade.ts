/**
 * Compaction facade: typed public API over the engine.
 *
 * @module ./facade
 */

import type {
  CompactionResult,
  CompactionTrigger,
} from './types.ts'
import type {
  CompactionAgentContext,
  ManualCompactAgentContext,
} from './session.ts'
import type { CommandId } from './brand.ts'

/**
 * Typed facade over a compaction engine.
 *
 * Provides the public API surface for driving compaction:
 * - `compactIfNeeded` — automatic pressure/overflow compaction.
 * - `compactRegion` — explicit range compaction.
 * - `compactNow` — manual idle-session compaction.
 */
export class CompactionFacade {
  constructor(
    private readonly engine: {
      compactIfNeeded(
        trigger: CompactionTrigger,
        agent: CompactionAgentContext,
        signal?: AbortSignal,
      ): Promise<CompactionResult | null>
      compactRegion(
        start: number,
        end: number,
        agent: CompactionAgentContext,
        signal?: AbortSignal,
      ): Promise<CompactionResult>
      compactNow?(
        agent: ManualCompactAgentContext,
        signal: AbortSignal,
        sourceCommandId?: CommandId,
      ): Promise<CompactionResult | null>
    },
  ) {}

  /**
   * Compact when the automatic trigger applies.
   * @param trigger - why automatic policy is asking.
   * @param agent - context whose session is mutated.
   * @param signal - optional cancellation.
   * @returns the compaction result, or `null` when no compaction ran.
   */
  async compactIfNeeded(
    trigger: CompactionTrigger,
    agent: CompactionAgentContext,
    signal?: AbortSignal,
  ): Promise<CompactionResult | null> {
    return this.engine.compactIfNeeded(trigger, agent, signal)
  }

  /**
   * Compact one explicit surface span.
   * @param start - first surface seq, inclusive.
   * @param end - last surface seq, inclusive.
   * @param agent - context whose session is mutated.
   * @param signal - optional cancellation.
   * @returns the compaction result.
   */
  async compactRegion(
    start: number,
    end: number,
    agent: CompactionAgentContext,
    signal?: AbortSignal,
  ): Promise<CompactionResult> {
    return this.engine.compactRegion(start, end, agent, signal)
  }

  /**
   * Force one useful idle-session compaction.
   * @param agent - idle agent whose next-turn admission this call reserves.
   * @param signal - cancellation scoped to this compaction request.
   * @param sourceCommandId - initiating command identity.
   * @returns the committed result, or `null` when no safe useful range exists.
   */
  async compactNow(
    agent: ManualCompactAgentContext,
    signal: AbortSignal,
    sourceCommandId?: CommandId,
  ): Promise<CompactionResult | null> {
    if (this.engine.compactNow === undefined) {
      throw new Error('engine does not support compactNow')
    }
    return this.engine.compactNow(agent, signal, sourceCommandId)
  }
}

export default CompactionFacade
