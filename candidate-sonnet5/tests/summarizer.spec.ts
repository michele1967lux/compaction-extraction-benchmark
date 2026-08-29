import { describe, expect, it } from 'vitest'
import { frameSummary, summarizeWithLlm } from '../src/summarizer.js'
import type { GenerateOptions, ILlmService, LlmResolvedModelInfo, StreamChunk } from '../src/session.js'
import { FakeSession } from './fake-session.js'

function textStream(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

class FakeLlm implements ILlmService {
  lastOptions: GenerateOptions | undefined
  constructor(private readonly chunks: StreamChunk[]) {}

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.lastOptions = options
    for (const chunk of this.chunks) yield chunk
  }

  async resolveModelInfo(): Promise<LlmResolvedModelInfo> {
    return { provider: 'p', id: 'm', name: 'm', context: { contextWindow: 1000 } }
  }
}

const CONFIG = { summarizationProvider: 'openai', summarizationModel: 'gpt', maxTokens: 512 }

describe('frameSummary', () => {
  it('wraps the summary in the checkpoint preamble and open/close tags', () => {
    const framed = frameSummary([{ type: 'text', text: 'body' }])
    expect(framed).toHaveLength(3)
    expect(framed[0]).toMatchObject({ type: 'text' })
    expect((framed[0] as { text: string }).text).toContain('<compacted-summary>')
    expect(framed[1]).toEqual({ type: 'text', text: 'body' })
    expect(framed[2]).toEqual({ type: 'text', text: '</compacted-summary>' })
  })
})

describe('summarizeWithLlm', () => {
  it('streams a one-shot call with the compaction instruction appended and returns the safe summary', async () => {
    const llm = new FakeLlm(textStream('## Primary Request and Intent\n- do the thing'))
    const session = new FakeSession()
    const result = await summarizeWithLlm(
      llm,
      CONFIG,
      { messages: [] },
      { session, options: {} },
    )
    expect(result.llmStreamCall).toBe(true)
    expect(result.summary).toEqual([{ type: 'text', text: '## Primary Request and Intent\n- do the thing' }])
    expect(result.provider).toBe('openai')
    expect(result.model).toBe('gpt')
    expect(llm.lastOptions?.purpose).toBe('compaction')
    expect(llm.lastOptions?.messages.at(-1)?.content[0]).toMatchObject({ type: 'text' })
    expect((llm.lastOptions?.messages.at(-1)?.content[0] as { text: string }).text).toContain('acting as a compaction engine')
  })

  it('falls back to the routed request header target when no summarization target is configured', async () => {
    const llm = new FakeLlm(textStream('summary'))
    const session = new FakeSession()
    session.setRequestHeader({ config: { provider: 'routed-provider', model: 'routed-model' } })
    const result = await summarizeWithLlm(
      llm,
      { summarizationProvider: '', summarizationModel: '', maxTokens: 100 },
      { messages: [] },
      { session, options: {} },
    )
    expect(result.provider).toBe('routed-provider')
    expect(result.model).toBe('routed-model')
  })

  it('throws when no provider/model target is available anywhere', async () => {
    const llm = new FakeLlm(textStream('summary'))
    const session = new FakeSession()
    await expect(summarizeWithLlm(
      llm,
      { summarizationProvider: '', summarizationModel: '', maxTokens: 100 },
      { messages: [] },
      { session, options: {} },
    )).rejects.toThrow(/no provider\/model available/)
  })

  it('throws a MAX_TOKENS error when the stream finishes truncated', async () => {
    const llm = new FakeLlm([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'partial' },
      { type: 'finish', reason: { kind: 'max-tokens' } },
    ])
    const session = new FakeSession()
    await expect(summarizeWithLlm(
      llm,
      CONFIG,
      { messages: [] },
      { session, options: {} },
    )).rejects.toMatchObject({ code: 'MAX_TOKENS' })
  })

  it('throws when the stream produces only whitespace text', async () => {
    const llm = new FakeLlm(textStream('   \n  '))
    const session = new FakeSession()
    await expect(summarizeWithLlm(
      llm,
      CONFIG,
      { messages: [] },
      { session, options: {} },
    )).rejects.toThrow(/produced no text summary content/)
  })

  it('propagates an adapter error finish', async () => {
    const llm = new FakeLlm([
      { type: 'finish', reason: { kind: 'error', failure: { message: 'boom', code: 'RATE_LIMIT' } } },
    ])
    const session = new FakeSession()
    await expect(summarizeWithLlm(
      llm,
      CONFIG,
      { messages: [] },
      { session, options: {} },
    )).rejects.toMatchObject({ code: 'RATE_LIMIT' })
  })
})
