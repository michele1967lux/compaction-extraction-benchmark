import { describe, expect, it } from 'vitest'
import { resolveCompactSpec, resolveConfig, resolveTargetPolicy, TargetPressureConfigError } from '../src/engine.js'

describe('resolveConfig', () => {
  it('applies documented defaults', () => {
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

  it('rejects an unknown top-level key', () => {
    expect(() => resolveConfig({ bogus: true } as never)).toThrow(/unknown key "bogus"/)
  })

  it('rejects retainRatio >= thresholdRatio', () => {
    expect(() => resolveConfig({ thresholdRatio: 0.5, retainRatio: 0.5 })).toThrow(/must be less than/)
  })

  it('rejects retainRatio and retainTokens set together', () => {
    expect(() => resolveConfig({ retainRatio: 0.1, retainTokens: 100 })).toThrow(/mutually exclusive/)
  })

  it('rejects a summarization provider/model set alone', () => {
    expect(() => resolveConfig({ summarizationProvider: 'openai' })).toThrow(/must be set together/)
  })

  it('rejects duplicate model policies', () => {
    expect(() => resolveConfig({
      modelPolicies: [
        { provider: 'p', model: 'm' },
        { provider: 'p', model: 'm' },
      ],
    })).toThrow(/duplicate model policy/)
  })

  it('rejects a model policy missing provider/model', () => {
    expect(() => resolveConfig({ modelPolicies: [{ model: 'm' } as never] })).toThrow(/provider.*non-empty string/)
  })
})

describe('resolveTargetPolicy', () => {
  it('inherits top-level defaults when no override matches', () => {
    const config = resolveConfig({ thresholdRatio: 0.7 })
    const policy = resolveTargetPolicy(config, { provider: 'p', model: 'm' })
    expect(policy.thresholdRatio).toBe(0.7)
    expect(policy.target).toEqual({ provider: 'p', model: 'm' })
  })

  it('merges an exact-target override over the defaults', () => {
    const config = resolveConfig({
      thresholdRatio: 0.8,
      modelPolicies: [{ provider: 'p', model: 'm', thresholdRatio: 0.5, maxTokens: 4096 }],
    })
    const policy = resolveTargetPolicy(config, { provider: 'p', model: 'm' })
    expect(policy.thresholdRatio).toBe(0.5)
    expect(policy.maxTokens).toBe(4096)

    const other = resolveTargetPolicy(config, { provider: 'other', model: 'm2' })
    expect(other.thresholdRatio).toBe(0.8)
    expect(other.maxTokens).toBe(8192)
  })
})

describe('resolveCompactSpec', () => {
  it('scales ratios into concrete token budgets', () => {
    const config = resolveConfig({ thresholdRatio: 0.8, retainRatio: 0.1 })
    const policy = resolveTargetPolicy(config, { provider: 'p', model: 'm' })
    const spec = resolveCompactSpec(policy, 1000)
    expect(spec.thresholdTokens).toBe(800)
    expect(spec.retainTokens).toBe(100)
    expect(spec.contextWindow).toBe(1000)
  })

  it('rejects a non-positive context window', () => {
    const config = resolveConfig()
    const policy = resolveTargetPolicy(config, { provider: 'p', model: 'm' })
    expect(() => resolveCompactSpec(policy, 0)).toThrow(TargetPressureConfigError)
  })

  it('rejects retainTokens >= thresholdTokens after scaling', () => {
    const config = resolveConfig({ thresholdRatio: 0.5, retainTokens: 600 })
    const policy = resolveTargetPolicy(config, { provider: 'p', model: 'm' })
    // thresholdTokens = floor(1000 * 0.5) = 500 <= retainTokens 600
    expect(() => resolveCompactSpec(policy, 1000)).toThrow(TargetPressureConfigError)
  })
})
