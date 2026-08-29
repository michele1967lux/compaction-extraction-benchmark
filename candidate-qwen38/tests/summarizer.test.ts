import { describe, expect, it } from 'vitest'
import { FakeLLM, FakeSession, userMessage, errorChunks } from './fakes.ts'
import { frameSummary, summarizeWithLlm } from '../src/summarizer.ts'
import type { ContentBlock } from '../src/session.ts'

describe('frameSummary', () => {
  it('wraps the summary with preamble and tags', () => {
    const summary: ContentBlock[] = [{ type: 'text', text: 'the summary' }]
    const framed = frameSummary(summary)
    expect(framed).toHaveLength(3)
    expect(framed[0]?.type).toBe('text')
    if (framed[0]?.type === 'text') {
      expect(framed[0].text).toContain('checkpoint')
      expect(framed[0].text).toContain('<compacted-summary>')
    }
    expect(framed[1]).toEqual({ type: 'text', text: 'the summary' })
    expect(framed[2]?.type).toBe('text')
    if (framed[2]?.type === 'text') {
      expect(framed[2].text).toBe('</compacted-summary>')
    }
  })
})

describe('summarizeWithLlm', () => {
  it('returns the summary with llmStreamCall: true', async () => {
    const session = new FakeSession()
    session.append('user/message', userMessage('hello'), { surfaceOp: 'append' })

    const llm = new FakeLLM(1000, [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'summary text' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'summary text' } },
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])

    const result = await summarizeWithLlm(
      llm,
      { summarizationProvider: 'p', summarizationModel: 'm', maxTokens: 100 },
      { messages: [userMessage('hello')] },
      { session, options: {} },
    )

    expect(result.summary).toEqual([{ type: 'text', text: 'summary text' }])
    expect(result.llmStreamCall).toBe(true)
    expect(result.provider).toBe('p')
    expect(result.model).toBe('m')
    expect(result.maxTokens).toBe(100)
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })
  })

  it('throws on max-tokens finish', async () => {
    const session = new FakeSession()
    const llm = new FakeLLM(1000, [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'partial' },
      { type: 'finish', reason: { kind: 'max-tokens' } },
    ])

    await expect(
      summarizeWithLlm(
        llm,
        { summarizationProvider: 'p', summarizationModel: 'm', maxTokens: 100 },
        { messages: [userMessage('hello')] },
        { session, options: {} },
      ),
    ).rejects.toThrow('summarization truncated at the token cap')
  })

  it('throws on error finish', async () => {
    const session = new FakeSession()
    const llm = new FakeLLM(1000, errorChunks({ message: 'provider error', code: 'PROV_ERR' }))

    await expect(
      summarizeWithLlm(
        llm,
        { summarizationProvider: 'p', summarizationModel: 'm', maxTokens: 100 },
        { messages: [userMessage('hello')] },
        { session, options: {} },
      ),
    ).rejects.toThrow('provider error')
  })

  it('throws on aborted finish', async () => {
    const session = new FakeSession()
    const llm = new FakeLLM(1000, errorChunks({ message: 'aborted', code: 'ABORT' }, 'aborted'))

    await expect(
      summarizeWithLlm(
        llm,
        { summarizationProvider: 'p', summarizationModel: 'm', maxTokens: 100 },
        { messages: [userMessage('hello')] },
        { session, options: {} },
      ),
    ).rejects.toThrow('aborted')
  })

  it('throws when no target is available', async () => {
    const session = new FakeSession()
    const llm = new FakeLLM(1000)

    await expect(
      summarizeWithLlm(
        llm,
        { summarizationProvider: '', summarizationModel: '', maxTokens: 100 },
        { messages: [userMessage('hello')] },
        { session, options: {} },
      ),
    ).rejects.toThrow('no provider/model available for summarization')
  })

  it('throws when the summary has no text content', async () => {
    const session = new FakeSession()
    const llm = new FakeLLM(1000, [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: '   ' },
      { type: 'block-end', index: 0, block: { type: 'text', text: '   ' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])

    await expect(
      summarizeWithLlm(
        llm,
        { summarizationProvider: 'p', summarizationModel: 'm', maxTokens: 100 },
        { messages: [userMessage('hello')] },
        { session, options: {} },
      ),
    ).rejects.toThrow('summarization produced no text summary content')
  })

  it('prefers configured target over agent options', async () => {
    const session = new FakeSession()
    const llm = new FakeLLM(1000, [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'ok' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])

    const result = await summarizeWithLlm(
      llm,
      { summarizationProvider: 'configured-p', summarizationModel: 'configured-m', maxTokens: 100 },
      { messages: [userMessage('hello')] },
      { session, options: { provider: 'agent-p', model: 'agent-m' } },
    )

    expect(result.provider).toBe('configured-p')
    expect(result.model).toBe('configured-m')
  })

  it('falls back to agent options when config is empty', async () => {
    const session = new FakeSession()
    const llm = new FakeLLM(1000, [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'ok' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])

    const result = await summarizeWithLlm(
      llm,
      { summarizationProvider: '', summarizationModel: '', maxTokens: 100 },
      { messages: [userMessage('hello')] },
      { session, options: { provider: 'agent-p', model: 'agent-m' } },
    )

    expect(result.provider).toBe('agent-p')
    expect(result.model).toBe('agent-m')
  })
})
