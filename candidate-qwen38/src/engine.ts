/**
 * Basic compaction engine: pressure and overflow recovery, manual compaction.
 *
 * Ported from `dsh-compaction-basic/src/index.ts` (the engine portion).
 *
 * @module ./engine
 */

import {
  type CompactionAgentContext,
  type ILLMClient,
  type ISession,
  type ITokenMeter,
  type ManualCompactAgentContext,
  type SummarizationInput,
  type SummaryResult,
} from './session.ts'
import { selectCompactableRange } from './ranges.ts'
import { assertNoActiveCompaction, compactSurfaceRegion } from './transaction.ts'
import { summarizeWithLlm } from './summarizer.ts'
import {
  type BasicCompactionConfig,
  type CompactionResult,
  type CompactionTrigger,
  type ResolvedConfig,
  CompactionEngine,
  ManualCompactionError,
  resolveCompactSpec,
  resolveConfig,
  resolveTargetPolicy,
  TargetPressureConfigError,
} from './types.ts'
import type { CommandId } from './brand.ts'

/**
 * Basic compaction backend: pressure and overflow recovery with a
 * cache-reusing one-shot summarizer.
 */
export class BasicCompactionEngine extends CompactionEngine {
  private readonly config: ResolvedConfig
  private readonly meter: ITokenMeter
  private readonly llm: ILLMClient
  private readonly flush: (session: ISession) => Promise<void>
  private readonly pruneSession: ((session: ISession) => void) | undefined
  private readonly overflowRetries = new WeakMap<CompactionAgentContext, number>()

  constructor(options: {
    config?: BasicCompactionConfig
    meter: ITokenMeter
    llm: ILLMClient
    flush?: (session: ISession) => Promise<void>
    pruneSession?: (session: ISession) => void
  }) {
    super()
    this.config = resolveConfig(options.config)
    this.meter = options.meter
    this.llm = options.llm
    this.flush = options.flush ?? (async () => {})
    this.pruneSession = options.pruneSession
  }

  /**
   * Summarize the replayed conversation region through a direct one-shot
   * LLM stream call whose prefix reuses the conversation's own system
   * prompt, tools, and messages so the provider's KV cache is not invalidated.
   */
  protected async summarize(
    input: SummarizationInput,
    agent: CompactionAgentContext,
    signal?: AbortSignal,
  ): Promise<SummaryResult> {
    const target = agent.session.requestHeader()?.config
    const policy = target === undefined
      ? this.config
      : resolveTargetPolicy(this.config, target)
    return summarizeWithLlm(
      this.llm,
      {
        summarizationProvider: policy.summarizationProvider,
        summarizationModel: policy.summarizationModel,
        maxTokens: policy.maxTokens,
      },
      input,
      agent,
      signal,
    )
  }

  /**
   * Compact for replayed step-boundary pressure or one provider-confirmed
   * context overflow.
   */
  override async compactIfNeeded(
    trigger: CompactionTrigger,
    agent: CompactionAgentContext,
    signal?: AbortSignal,
  ): Promise<CompactionResult | null> {
    const target = agent.session.requestHeader()?.config
    if (target === undefined) return null
    const policy = resolveTargetPolicy(this.config, target)
    let measurement = this.meter.measure(agent.session)

    if (trigger === 'context-overflow') {
      if (this.pruneSession !== undefined) {
        this.pruneSession(agent.session)
        measurement = this.meter.measure(agent.session)
      }
      const range = selectCompactableRange(agent.session, measurement, 0)
      if (range === null) return null
      return this.compactRegion(range.start, range.end, agent, signal)
    }

    const context = (await this.llm.resolveModelInfo(target.provider, target.model, signal)).context
    assertNoActiveCompaction(agent.session, 'automatic pressure compaction')
    const targetKey = `${target.provider}/${target.model}`
    if (context === undefined) {
      throw new TargetPressureConfigError(
        targetKey,
        `compaction-basic: no context capacity for ${targetKey}; `
        + 'configure contextWindow on that adapter model',
      )
    }
    const spec = resolveCompactSpec(policy, context.contextWindow)
    if (measurement.totalTokens < spec.thresholdTokens) return null

    if (this.pruneSession !== undefined) {
      this.pruneSession(agent.session)
      measurement = this.meter.measure(agent.session)
    }
    if (measurement.totalTokens < spec.thresholdTokens) return null

    let result: CompactionResult | null = null
    for (let attempt = 0; attempt <= spec.compactionRetries; attempt += 1) {
      const range = selectCompactableRange(agent.session, measurement, spec.retainTokens)
      if (range === null) {
        if (result === null) return null
        break
      }
      result = await this.compactRegion(range.start, range.end, agent, signal)
      measurement = this.meter.measure(agent.session)
      if (measurement.totalTokens < spec.thresholdTokens) return result
    }

    throw new Error(
      `compaction still above threshold after ${spec.compactionRetries + 1} compaction attempts `
      + `(${measurement.totalTokens} estimated tokens >= threshold ${spec.thresholdTokens})`,
    )
  }

  /**
   * Compact one inclusive positional range from the agent-owned surface.
   */
  override async compactRegion(
    start: number,
    end: number,
    agent: CompactionAgentContext,
    signal?: AbortSignal,
  ): Promise<CompactionResult> {
    return compactSurfaceRegion(
      agent.session,
      start,
      end,
      agent,
      { owner: 'current-turn', stability: 'whole-surface' },
      signal,
      (input, owner, abort) => this.summarize(input, owner, abort),
      () => this.meter.measure(agent.session),
      (msg) => this.meter.estimateMessage(msg),
    )
  }

  /**
   * Force one useful idle-session compaction below the pressure threshold.
   */
  compactNow(
    agent: ManualCompactAgentContext,
    signal: AbortSignal,
    sourceCommandId?: CommandId,
  ): Promise<CompactionResult | null> {
    signal.throwIfAborted()
    try {
      return agent.runMaintenance(async (agentSignal) => {
        const operationSignal = AbortSignal.any([agentSignal, signal])
        try {
          operationSignal.throwIfAborted()
          const range = selectCompactableRange(
            agent.session,
            this.meter.measure(agent.session),
            0,
          )
          if (range === null) return null
          return await compactSurfaceRegion(
            agent.session,
            range.start,
            range.end,
            agent,
            {
              owner: null,
              stability: 'selected-span',
              ...sourceCommandId === undefined ? {} : { sourceCommandId },
              flush: async () => {
                await this.flush(agent.session)
              },
            },
            operationSignal,
            (input, owner, abort) => this.summarize(input, owner, abort),
            () => this.meter.measure(agent.session),
            (msg) => this.meter.estimateMessage(msg),
          )
        } catch (error: unknown) {
          if (signal.aborted) {
            throw new ManualCompactionError(
              'cancelled',
              'manual compaction was cancelled',
              { cause: error },
            )
          }
          operationSignal.throwIfAborted()
          throw error
        }
      })
    } catch (error: unknown) {
      if (error instanceof ManualCompactionError) throw error
      throw new ManualCompactionError(
        'busy',
        'manual compaction requires an idle agent with no waking queued work',
        { cause: error },
      )
    }
  }

  /**
   * Step-boundary pressure check: compact if the session is above threshold.
   */
  async stepPressureCheck(
    agent: CompactionAgentContext,
    signal: AbortSignal,
  ): Promise<CompactionResult | null> {
    return this.compactIfNeeded('pressure', agent, signal)
  }

  /**
   * Context-overflow recovery: force one useful reduction.
   */
  async recoverFromOverflow(
    agent: CompactionAgentContext,
    signal: AbortSignal,
  ): Promise<CompactionResult | null> {
    return this.compactIfNeeded('context-overflow', agent, signal)
  }

  /**
   * Reset overflow retry count when the agent becomes idle.
   */
  onAgentIdle(agent: CompactionAgentContext): void {
    this.overflowRetries.delete(agent)
  }

  /**
   * Note an assistant message (reset overflow retry count).
   */
  noteAssistantMessage(agent: CompactionAgentContext): void {
    this.overflowRetries.delete(agent)
  }
}
