import { describe, expect, it } from 'vitest'
import * as api from '../src/index.ts'

describe('public API', () => {
  it('exports brand types', () => {
    expect(api).toBeDefined()
  })

  it('exports session vocabulary', () => {
    expect(api.deepFreeze).toBeTypeOf('function')
    expect(api.errorChain).toBeTypeOf('function')
    expect(api.contentHasImage).toBeTypeOf('function')
    expect(api.assertNever).toBeTypeOf('function')
    expect(api.createUserMessage).toBeTypeOf('function')
  })

  it('exports compaction types', () => {
    expect(api.ManualCompactionError).toBeTypeOf('function')
    expect(api.CompactionEngine).toBeTypeOf('function')
    expect(api.TargetPressureConfigError).toBeTypeOf('function')
    expect(api.resolveConfig).toBeTypeOf('function')
    expect(api.resolveTargetPolicy).toBeTypeOf('function')
    expect(api.resolveCompactSpec).toBeTypeOf('function')
  })

  it('exports checkpoint', () => {
    expect(api.compactCheckpointSource).toBeTypeOf('function')
    expect(api.isCompactCheckpointSource).toBeTypeOf('function')
  })

  it('exports tool pairing', () => {
    expect(api.toolPairingBalancedBefore).toBeTypeOf('function')
    expect(api.toolPairingBalancedAfter).toBeTypeOf('function')
  })

  it('exports ranges', () => {
    expect(api.selectCompactableRange).toBeTypeOf('function')
  })

  it('exports transaction', () => {
    expect(api.compactSurfaceRegion).toBeTypeOf('function')
    expect(api.assertNoActiveCompaction).toBeTypeOf('function')
  })

  it('exports summarizer', () => {
    expect(api.frameSummary).toBeTypeOf('function')
    expect(api.summarizeWithLlm).toBeTypeOf('function')
  })

  it('exports engine', () => {
    expect(api.BasicCompactionEngine).toBeTypeOf('function')
  })

  it('exports facade', () => {
    expect(api.CompactionFacade).toBeTypeOf('function')
  })
})
