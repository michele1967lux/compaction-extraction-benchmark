/**
 * Public entry point: the extracted DeepSeek Harness compaction system,
 * importable and testable without Cordis. Re-exports the full surface of
 * every module in this package.
 *
 * See `PLAN.md` for the source-fidelity mapping back to
 * `packages/compaction/{compaction,compaction-basic}/src/*.ts`, and
 * `PROGRAM_STATE.md` for the phase-by-phase log of what was ported and the
 * handful of explicitly declared divergences.
 *
 * @module index
 */

export {
  CompactionId,
  CommandId,
  SessionId,
  MessageId,
  ToolCallId,
  ReasoningEffortId,
} from './brand.js'
export type { Branded } from './brand.js'

export type {
  // Content blocks
  TextBlock,
  ReasoningBlock,
  ImageBlock,
  ImageAttachmentRef,
  ToolCallBlock,
  ToolResultBlock,
  ContentBlockMap,
  ContentBlockType,
  ContentBlock,
  // Token accounting / tool schemas
  TokenUsage,
  ToolSchema,
  // Messages
  AssistantProvenance,
  ModelMessageSource,
  ToolMessageSource,
  MessageSourceMap,
  MessageSource,
  Message,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  // LLM call vocabulary
  LlmCallConfig,
  FinishReasonMap,
  FinishReason,
  LlmFailure,
  ReplayEnvelope,
  StreamChunk,
  GenerateOptions,
  LlmModelContext,
  LlmResolvedModelInfo,
  ILlmService,
  // Session event log and surface
  JsonValue,
  EpochHeader,
  SessionEventMap,
  SessionEventType,
  SurfaceEventType,
  SurfaceOp,
  SurfaceIntent,
  SessionEvent,
  SessionSurface,
  ISession,
  // Agent context
  CompactionAgentContext,
  // Token metering
  TokenSurfaceNode,
  TokenMeasurement,
  ITokenMeter,
} from './session.js'
export {
  deepFreeze,
  freezeMessage,
  createMessage,
  createUserMessage,
  contentHasImage,
  HarnessError,
  LlmError,
  CONTEXT_WINDOW_EXCEEDED_CODE,
  errorChain,
  assertNever,
} from './session.js'
export type { LlmErrorOptions } from './session.js'

export { compactCheckpointSource, isCompactCheckpointSource } from './checkpoint.js'
export type { CompactionCheckpointSource } from './checkpoint.js'

export { toolPairingBalancedAfter, toolPairingBalancedBefore } from './tool-pairing.js'

export type { CompactionResult } from './types.js'

export { selectCompactableRange, validateRangeSelection } from './ranges.js'
export type { SurfaceSelection } from './ranges.js'

export { summarizeWithLlm, frameSummary } from './summarizer.js'
export type { SummarizationInput, SummaryResult } from './summarizer.js'

export { assertNoActiveCompaction, compactSurfaceRegion } from './transaction.js'
export type { CompactionTransactionOptions, RegionDependencies } from './transaction.js'

export {
  CompactionEngine,
  BasicCompactionEngine,
  ManualCompactionError,
  TargetPressureConfigError,
  resolveConfig,
  resolveTargetPolicy,
  resolveCompactSpec,
} from './engine.js'
export type {
  CompactionTrigger,
  ManualCompactionErrorCode,
  ManualCompactAgentContext,
  CompactionPolicyConfig,
  ModelCompactPolicyConfig,
  BasicCompactionConfig,
  ResolvedRetention,
  ResolvedConfig,
  ResolvedTargetPolicy,
  ResolvedCompactSpec,
} from './engine.js'

export { CompactionFacade } from './facade.js'
export { default } from './facade.js'
