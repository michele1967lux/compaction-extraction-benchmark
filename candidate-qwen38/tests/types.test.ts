import { describe, expect, it } from 'vitest'
import {
  ManualCompactionError,
  resolveCompactSpec,
  resolveConfig,
  resolveTargetPolicy,
  TargetPressureConfigError,
} from '../src/types.ts'

describe('resolveConfig', () => {
  it('applies the documented defaults', () => {
    const config = resolveConfig()
    expect(config.thresholdRatio).toBe(0.8)
    expect(config.retainRatio).toBe(0.16)
    expect(config.summarizationProvider).toBe('')
    expect(config.summarizationModel).toBe('')
    expect(config.maxTokens).toBe(8192)
    expect(config.compactionRetries).toBe(1)
    expect(config.maxOverflowRetries).toBe(1)
    expect(config.modelPolicies).toEqual([])
    expect(config.auto).toBe(true)
  })

  it('returns a frozen config', () => {
    const config = resolveConfig()
    expect(Object.isFrozen(config)).toBe(true)
  })

  it('rejects unknown keys', () => {
    expect(() => resolveConfig({ thresholdRatio: 0.9, bogus: 1 } as never)).toThrow(
      'BasicCompactionConfig: unknown key "bogus"',
    )
  })

  it('rejects a non-boolean auto', () => {
    expect(() => resolveConfig({ auto: 'yes' } as never)).toThrow(
      'BasicCompactionConfig: auto must be a boolean',
    )
  })

  it('rejects a ratio outside (0, 1]', () => {
    expect(() => resolveConfig({ thresholdRatio: 0 })).toThrow(
      'BasicCompactionConfig.thresholdRatio (0) must be a number in (0, 1]',
    )
    expect(() => resolveConfig({ thresholdRatio: 1.5 })).toThrow(
      'BasicCompactionConfig.thresholdRatio (1.5) must be a number in (0, 1]',
    )
  })

  it('rejects retainRatio and retainTokens together', () => {
    expect(() => resolveConfig({ retainRatio: 0.1, retainTokens: 100 })).toThrow(
      'BasicCompactionConfig: retainRatio and retainTokens are mutually exclusive',
    )
  })

  it('rejects retainRatio >= thresholdRatio', () => {
    expect(() => resolveConfig({ thresholdRatio: 0.5, retainRatio: 0.5 })).toThrow(
      'BasicCompactionConfig: retainRatio (0.5) must be less than the resolved thresholdRatio (0.5)',
    )
  })

  it('accepts an explicit retainTokens form', () => {
    const config = resolveConfig({ retainTokens: 500 })
    expect(config.retainTokens).toBe(500)
    expect(config.retainRatio).toBeUndefined()
  })

  it('rejects a non-integer maxTokens', () => {
    expect(() => resolveConfig({ maxTokens: 1.5 })).toThrow(
      'BasicCompactionConfig.maxTokens (1.5) must be a positive integer',
    )
  })

  it('requires the summarization pair to be set together', () => {
    expect(() => resolveConfig({ summarizationProvider: 'p' })).toThrow(
      'BasicCompactionConfig: summarizationProvider and summarizationModel must be set together as an empty or non-empty pair',
    )
    expect(() => resolveConfig({ summarizationModel: 'm' })).toThrow(
      'BasicCompactionConfig: summarizationProvider and summarizationModel must be set together as an empty or non-empty pair',
    )
    // Both empty is a valid "clear" pair.
    const config = resolveConfig({ summarizationProvider: '', summarizationModel: '' })
    expect(config.summarizationProvider).toBe('')
    expect(config.summarizationModel).toBe('')
  })

  it('validates modelPolicies entries and rejects duplicates', () => {
    expect(() => resolveConfig({
      modelPolicies: [
        { provider: 'p', model: 'm' },
        { provider: 'p', model: 'm' },
      ],
    })).toThrow('BasicCompactionConfig: duplicate model policy for p/m')

    expect(() => resolveConfig({
      modelPolicies: [{ provider: '', model: 'm' }],
    })).toThrow('BasicCompactionConfig: modelPolicies[0].provider must be a non-empty string')

    const config = resolveConfig({
      modelPolicies: [{ provider: 'p', model: 'm', thresholdRatio: 0.9 }],
    })
    expect(config.modelPolicies).toHaveLength(1)
    expect(config.modelPolicies[0]?.thresholdRatio).toBe(0.9)
  })
})

describe('resolveTargetPolicy', () => {
  it('inherits every field when no override matches', () => {
    const config = resolveConfig({ summarizationProvider: 'p', summarizationModel: 'm' })
    const policy = resolveTargetPolicy(config, { provider: 'other', model: 'x' })
    expect(policy.target).toEqual({ provider: 'other', model: 'x' })
    expect(policy.thresholdRatio).toBe(0.8)
    expect(policy.retainRatio).toBe(0.16)
    expect(policy.summarizationProvider).toBe('p')
    expect(policy.summarizationModel).toBe('m')
    expect(policy.maxTokens).toBe(8192)
  })

  it('merges a matching override over the defaults', () => {
    const config = resolveConfig({
      thresholdRatio: 0.8,
      modelPolicies: [{ provider: 'p', model: 'm', thresholdRatio: 0.9, maxTokens: 4096 }],
    })
    const policy = resolveTargetPolicy(config, { provider: 'p', model: 'm' })
    expect(policy.thresholdRatio).toBe(0.9)
    expect(policy.maxTokens).toBe(4096)
    // Unset override fields inherit.
    expect(policy.retainRatio).toBe(0.16)
    expect(policy.compactionRetries).toBe(1)
  })

  it('inherits the default retention form into the override', () => {
    const config = resolveConfig({ retainTokens: 777 })
    const policy = resolveTargetPolicy(config, { provider: 'p', model: 'm' })
    expect(policy.retainTokens).toBe(777)
    expect(policy.retainRatio).toBeUndefined()
  })
})

describe('resolveCompactSpec', () => {
  const policy = resolveTargetPolicy(resolveConfig(), { provider: 'p', model: 'm' })

  it('scales the ratios to the context window', () => {
    const spec = resolveCompactSpec(policy, 1000)
    expect(spec.contextWindow).toBe(1000)
    expect(spec.thresholdTokens).toBe(800)
    expect(spec.retainTokens).toBe(160)
    expect(spec.thresholdRatio).toBe(0.8)
    expect(spec.summarizationProvider).toBe('')
  })

  it('prefers an explicit retainTokens over the ratio', () => {
    const config = resolveConfig({ retainTokens: 100 })
    const spec = resolveCompactSpec(resolveTargetPolicy(config, { provider: 'p', model: 'm' }), 1000)
    expect(spec.retainTokens).toBe(100)
  })

  it('rejects a non-positive or non-integer context window', () => {
    expect(() => resolveCompactSpec(policy, 0)).toThrow(
      'BasicCompactionConfig: contextWindow (0) must be a positive integer',
    )
    expect(() => resolveCompactSpec(policy, 1.5)).toThrow(
      'BasicCompactionConfig: contextWindow (1.5) must be a positive integer',
    )
  })

  it('rejects a retention budget at or above the threshold', () => {
    // retainTokens bypasses the load-time ratio check; the spec check catches it.
    const config = resolveConfig({ thresholdRatio: 0.5, retainTokens: 500 })
    const p = resolveTargetPolicy(config, { provider: 'p', model: 'm' })
    expect(() => resolveCompactSpec(p, 1000)).toThrow(
      'BasicCompactionConfig: p/m retainTokens (500) must be less than threshold tokens 500',
    )
  })

  it('throws a TargetPressureConfigError carrying the target key', () => {
    try {
      resolveCompactSpec(policy, 0)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(TargetPressureConfigError)
      expect((error as TargetPressureConfigError).targetKey).toBe('p/m')
    }
  })
})

describe('ManualCompactionError', () => {
  it('keeps the code, message, and cause', () => {
    const cause = new Error('root')
    const error = new ManualCompactionError('busy', 'agent is active', { cause })
    expect(error.name).toBe('ManualCompactionError')
    expect(error.code).toBe('busy')
    expect(error.message).toBe('agent is active')
    expect(error.cause).toBe(cause)
    expect(error).toBeInstanceOf(Error)
  })
})
