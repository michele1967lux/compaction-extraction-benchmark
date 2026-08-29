/**
 * Operational facade: the single entry point a consumer instantiates
 * directly, with its dependencies injected explicitly, instead of mounting
 * a Cordis `cordis.yml` composition.
 *
 * Fidelity note: `packages/compaction/compaction-extracted/src/facade.ts`
 * (read during PLAN.md's source study) is a prior attempt at exactly this
 * kind of thin wrapper already present in the real repository, but its
 * constructor still takes `ctx: Context` from Cordis
 * (`new BasicCompactionEngine(ctx, engineConfig)`), so it does not satisfy
 * TASK.md's requirement that this module stay importable and testable
 * without Cordis. This `CompactionFacade` is NOT a port of that file — it is
 * built from the same operational intent (one object a consumer new()s up
 * directly) applied to THIS module's actually Cordis-free
 * `BasicCompactionEngine` (`engine.ts`), with `ITokenMeter`/`ILlmService`
 * injected as constructor arguments instead of resolved off a Cordis
 * context. See PLAN.md's source-study note for the full comparison.
 *
 * @module facade
 */

import { BasicCompactionEngine } from './engine.js'
import type { BasicCompactionConfig, CompactionTrigger, ManualCompactAgentContext } from './engine.js'
import type { CompactionAgentContext, ILlmService, ITokenMeter } from './session.js'
import type { CommandId } from './brand.js'
import type { CompactionResult } from './types.js'

/**
 * Thin operational wrapper around {@link BasicCompactionEngine}: constructs
 * the engine from injected dependencies and exposes its three entry points
 * directly, so a consumer does not need to know the engine's own
 * construction signature.
 */
export class CompactionFacade {
  /** The wrapped compaction backend. */
  readonly engine: BasicCompactionEngine

  /**
   * @param meter - injected token-pressure measurement capability.
   * @param llm - injected LLM capability used by the default summarizer.
   * @param config - untrusted caller configuration for the wrapped engine.
   */
  constructor(meter: ITokenMeter, llm: ILlmService, config: BasicCompactionConfig = {}) {
    this.engine = new BasicCompactionEngine(meter, llm, config)
  }

  /**
   * Consider automatic compaction for one explicit trigger.
   * @param agent - agent context owning the session surface and routing options.
   * @param trigger - normal pressure or provider-confirmed context overflow.
   * @param signal - cancellation signal forwarded to the engine.
   * @returns the compaction result, or `null` if no compaction was needed.
   */
  async compactIfNeeded(
    agent: CompactionAgentContext,
    trigger: CompactionTrigger,
    signal: AbortSignal,
  ): Promise<CompactionResult | null> {
    return this.engine.compactIfNeeded(agent, trigger, signal)
  }

  /**
   * Explicitly compact useful history even below automatic pressure thresholds.
   * @param agent - idle agent whose durable history should be compacted.
   * @param signal - cancellation scoped to this compaction request.
   * @param sourceCommandId - initiating command identity for a manual compaction.
   * @returns the compaction result, or `null` when no safe useful range exists.
   */
  async compactNow(
    agent: ManualCompactAgentContext,
    signal: AbortSignal,
    sourceCommandId?: CommandId,
  ): Promise<CompactionResult | null> {
    return this.engine.compactNow(agent, signal, sourceCommandId)
  }

  /**
   * Forcibly compact a range of surface nodes into a single summary node.
   * @param start - first surface seq, inclusive.
   * @param end - last surface seq, inclusive.
   * @param agent - context whose session is mutated and whose routing options guide summarization.
   * @param signal - optional cancellation forwarded to the engine.
   * @returns the appended event seqs, summary, replaced range, and token accounting.
   */
  async compactRegion(
    start: number,
    end: number,
    agent: CompactionAgentContext,
    signal?: AbortSignal,
  ): Promise<CompactionResult> {
    return this.engine.compactRegion(start, end, agent, signal)
  }
}

export default CompactionFacade
