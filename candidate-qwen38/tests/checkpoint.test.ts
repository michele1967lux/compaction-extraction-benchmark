import { describe, expect, it } from 'vitest'
import { CommandId, CompactionId, ToolCallId } from '../src/brand.ts'
import {
  compactCheckpointSource,
  isCompactCheckpointSource,
  type CompactionCheckpointSource,
} from '../src/checkpoint.ts'
import type { MessageSource } from '../src/session.ts'

describe('compactCheckpointSource', () => {
  it('carries the plugin marker, the compaction id, and no sourceCommandId when absent', () => {
    const source = compactCheckpointSource(CompactionId('c-1'))
    expect(source.kind).toBe('plugin')
    expect(source.plugin).toBe('compact')
    expect(source.compactionId).toBe('c-1')
    expect('sourceCommandId' in source).toBe(false)
  })

  it('carries the source command id when present', () => {
    const source = compactCheckpointSource(CompactionId('c-2'), CommandId('cmd-9'))
    expect(source.sourceCommandId).toBe('cmd-9')
  })

  it('returns a frozen object', () => {
    const source = compactCheckpointSource(CompactionId('c-3'))
    expect(Object.isFrozen(source)).toBe(true)
  })

  it('is assignable to the MessageSource union', () => {
    const source: MessageSource = compactCheckpointSource(CompactionId('c-4'))
    expect(source.kind).toBe('plugin')
  })
})

describe('isCompactCheckpointSource', () => {
  it('accepts a checkpoint source with and without a command id', () => {
    expect(isCompactCheckpointSource(compactCheckpointSource(CompactionId('a')))).toBe(true)
    expect(isCompactCheckpointSource(compactCheckpointSource(CompactionId('b'), CommandId('x')))).toBe(true)
  })

  it('rejects a plain user source', () => {
    expect(isCompactCheckpointSource({ kind: 'user' })).toBe(false)
  })

  it('rejects a model source', () => {
    expect(isCompactCheckpointSource({ kind: 'model', provider: 'p', model: 'm' })).toBe(false)
  })

  it('rejects a tool source', () => {
    expect(isCompactCheckpointSource({ kind: 'tool', callId: ToolCallId('call-1') })).toBe(false)
  })

  it('rejects another plugin source', () => {
    expect(isCompactCheckpointSource({ kind: 'plugin', plugin: 'dsh-compaction-basic' })).toBe(false)
  })

  it('accepts a hand-built source with the same marker fields', () => {
    const source: CompactionCheckpointSource = {
      kind: 'plugin',
      plugin: 'compact',
      compactionId: CompactionId('manual'),
    }
    expect(isCompactCheckpointSource(source)).toBe(true)
  })
})
