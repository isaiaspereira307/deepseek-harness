import { describe, expect, it } from 'vitest'
import {
  createAssistantMessage,
  createSystemMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk, ToolCallId } from '@deepseek-ai/dsh-llm'
import { LocalLlamaAdapter } from '../src/adapter.ts'

describe('LocalLlamaAdapter', () => {
  it('streams text-delta chunks inside one text block and finishes with stop', async () => {
    const adapter = new LocalLlamaAdapter({
      resolveModelPath: () => '/fake/path.gguf',
      loadSession: async () => ({
        promptStreaming: async function* () {
          yield 'hel'
          yield 'lo'
        },
      }),
    })
    const chunks: StreamChunk[] = []
    for await (const chunk of adapter.stream(generateOptions())) chunks.push(chunk)
    expect(chunks[0]).toEqual({ type: 'block-start', index: 0, blockType: 'text' })
    expect(chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text)).toEqual(['hel', 'lo'])
    expect(chunks.at(-2)).toEqual({ type: 'block-end', index: 0, block: { type: 'text', text: 'hello' } })
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('resolves the model path, system prompt, and per-call cap into the session', async () => {
    const loaded: Array<{ modelPath: string; systemPrompt: string | undefined }> = []
    const prompted: Array<{ text: string; maxTokens: number | undefined }> = []
    const adapter = new LocalLlamaAdapter({
      resolveModelPath: model => `/fake/${model}.gguf`,
      loadSession: async (modelPath, systemPrompt) => {
        loaded.push({ modelPath, systemPrompt })
        return {
          promptStreaming: async function* (text: string, opts: { maxTokens?: number }) {
            prompted.push({ text, maxTokens: opts.maxTokens })
            yield 'ok'
          },
        }
      },
    })
    const chunks: StreamChunk[] = []
    for await (const chunk of adapter.stream(generateOptions({
      system: 'You are local.',
      maxTokens: 123,
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'first' }] },
        { role: 'user', content: [{ type: 'text', text: 'second' }] },
      ],
    }))) chunks.push(chunk)
    expect(loaded).toEqual([{ modelPath: '/fake/qwen3.5-0.8b-q4_0.gguf', systemPrompt: 'You are local.' }])
    expect(prompted[0]?.text).toContain('first')
    expect(prompted[0]?.text).toContain('second')
    expect(prompted[0]?.maxTokens).toBe(123)
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('renders the persisted history with role labels and the leading system prompt in the session', async () => {
    let promptText: string | undefined
    const adapter = new LocalLlamaAdapter({
      resolveModelPath: () => '/fake/path.gguf',
      loadSession: async (_modelPath, _systemPrompt) => ({
        promptStreaming: async function* (text: string) {
          promptText = text
          yield 'ok'
        },
      }),
    })
    for await (const _chunk of adapter.stream(generateOptions({
      messages: [
        createSystemMessage('system rules'),
        createUserMessage({ content: [{ type: 'text', text: 'question' }], source: { kind: 'user' } }),
        createAssistantMessage({ content: [{ type: 'text', text: 'answer' }], source: { provider: 'local', model: 'qwen3.5-0.8b-q4_0' } }),
        createToolResultMessage({ callId: 'call-1' as ToolCallId, content: [{ type: 'text', text: 'result' }], isError: false }),
        createUserMessage({ content: [{ type: 'text', text: 'follow up' }], source: { kind: 'user' } }),
      ],
    }))) { /* drain */ }
    expect(promptText).toBe('User: question\n\nAssistant: answer\n\nTool result: result\n\nUser: follow up')
  })

  it('propagates abort via options.signal without hanging', async () => {
    const controller = new AbortController()
    const adapter = new LocalLlamaAdapter({
      resolveModelPath: () => '/fake/path.gguf',
      loadSession: async () => ({
        promptStreaming: async function* (_text: string, opts: { signal?: AbortSignal }) {
          opts.signal?.throwIfAborted()
          await new Promise<never>((_resolve, reject) => {
            opts.signal?.addEventListener('abort', () => {
              reject(new DOMException('aborted', 'AbortError'))
            }, { once: true })
          })
          yield 'unreachable'
        },
      }),
    })
    controller.abort()
    await expect(async () => {
      for await (const _chunk of adapter.stream(generateOptions({ signal: controller.signal }))) { /* drain */ }
    }).rejects.toThrow()
  })

  it('materializes its configured output cap as the resolved model default', async () => {
    const adapter = new LocalLlamaAdapter({
      resolveModelPath: () => '/fake/path.gguf',
      loadSession: async () => ({ promptStreaming: async function* () { yield 'x' } }),
      defaultMaxTokens: 4096,
    })
    const resolved = await adapter.resolveModel('local', 'qwen3.5-0.8b-q4_0')
    expect(resolved.defaultMaxTokens).toBe(4096)
    expect(resolved.provider).toBe('local')
    expect(resolved.id).toBe('qwen3.5-0.8b-q4_0')
  })
  it('resolves without an output cap when the local runtime declares none', async () => {
    const adapter = new LocalLlamaAdapter({
      resolveModelPath: () => '/fake/path.gguf',
      loadSession: async () => ({ promptStreaming: async function* () { yield 'x' } }),
    })
    expect(await adapter.resolveModel('local', 'qwen3.5-0.8b-q4_0')).toEqual({
      provider: 'local', id: 'qwen3.5-0.8b-q4_0', name: 'qwen3.5-0.8b-q4_0',
    })
  })

  it('sends no session prompt when the system message carries no text', async () => {
    const loaded: Array<string | undefined> = []
    const adapter = new LocalLlamaAdapter({
      resolveModelPath: () => '/fake/path.gguf',
      loadSession: async (_modelPath, systemPrompt) => {
        loaded.push(systemPrompt)
        return { promptStreaming: async function* () { yield 'ok' } }
      },
    })
    for await (const _chunk of adapter.stream(generateOptions({ messages: [createSystemMessage('')] }))) { /* drain */ }
    expect(loaded).toEqual([undefined])
  })
})

function generateOptions(overrides?: Partial<GenerateOptions>): GenerateOptions {
  return {
    provider: 'local',
    model: 'qwen3.5-0.8b-q4_0',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    ...overrides,
  }
}
