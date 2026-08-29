/**
 * Public API for the extracted compaction module.
 *
 * @module ./index
 */

// Brand types
export {
  type Branded,
  type CompactionId,
  type CommandId,
  type SessionId,
  type ToolCallId,
  type MessageId,
} from './brand.ts'

// Session vocabulary
export {
  type ContentBlock,
  type Message,
  type UserMessage,
  type AssistantMessage,
  type ToolResultMessage,
  type StreamChunk,
  type FinishReason,
  type TokenUsage,
  type ToolSchema,
  type MessageSource,
  type LlmFailure,
  type LlmCallConfig,
  type EpochHeader,
  type ISession,
  type ISessionSurface,
  type SessionEvent,
  type SessionEventMap,
  type SessionEventOf,
  type SessionEventType,
  type SurfaceEventType,
  type SurfaceOp,
  type SurfaceIntent,
  type ITokenMeter,
  type TokenMeasurement,
  type TokenSurfaceNode,
  type ILLMClient,
  type LlmRequest,
  type LlmModelInfo,
  type CompactionAgentContext,
  type ManualCompactAgentContext,
  type SummarizationInput,
  type SummaryResult,
  deepFreeze,
  errorChain,
  contentHasImage,
  assertNever,
  createUserMessage,
} from './session.ts'

// Compaction types
export {
  type CompactionTrigger,
  type ManualCompactionErrorCode,
  ManualCompactionError,
  type CompactionResult,
  CompactionEngine,
  type BasicCompactionConfig,
  type CompactionPolicyConfig,
  type ResolvedConfig,
  type ResolvedTargetPolicy,
  TargetPressureConfigError,
  resolveConfig,
  resolveTargetPolicy,
  resolveCompactSpec,
} from './types.ts'

// Checkpoint
export {
  type CompactionCheckpointSource,
  compactCheckpointSource,
  isCompactCheckpointSource,
} from './checkpoint.ts'

// Tool pairing
export {
  toolPairingBalancedBefore,
  toolPairingBalancedAfter,
} from './tool-pairing.ts'

// Ranges
export {
  selectCompactableRange,
} from './ranges.ts'

// Transaction
export {
  compactSurfaceRegion,
  assertNoActiveCompaction,
} from './transaction.ts'

// Summarizer
export {
  frameSummary,
  summarizeWithLlm,
} from './summarizer.ts'

// Engine
export { BasicCompactionEngine } from './engine.ts'

// Facade
export { CompactionFacade } from './facade.ts'
