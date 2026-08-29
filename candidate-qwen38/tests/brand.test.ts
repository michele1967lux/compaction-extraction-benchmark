/**
 * Brand contract: branded ids are plain strings at runtime (no validation,
 * zero allocation) while the compiler keeps the four id families apart.
 */
import { describe, expect, it } from 'vitest'
import { CommandId, type CommandId as CommandIdentity, CompactionId, SessionId, ToolCallId } from '../src/brand.ts'

describe('brands', () => {
  it('keeps branded ids plain strings at runtime', () => {
    const c = CompactionId('c-1')
    const d = CommandId('c-1')
    expect(c).toBe('c-1')
    expect(d).toBe('c-1')
    expect(typeof c).toBe('string')
  })

  it('mints four distinct families from one raw string', () => {
    const raw = 'shared'
    const compaction: CompactionId = CompactionId(raw)
    const command: CommandIdentity = CommandId(raw)
    const session: SessionId = SessionId(raw)
    const call: ToolCallId = ToolCallId(raw)
    // Runtime identity: all the same string; type identity: four families.
    expect([compaction, command, session, call]).toEqual(['shared', 'shared', 'shared', 'shared'])
  })
})
