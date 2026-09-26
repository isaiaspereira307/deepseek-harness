import { getLlama, LlamaChatSession, QwenChatWrapper } from 'node-llama-cpp'
import type { LocalSession, LocalPromptOptions } from './adapter.ts'

/**
 * Load one local chat session. Spike-pinned invocation
 * (`docs/superpowers/plans/2026-09-24-local-llm-provider-spike-notes.md`):
 * CPU-only inference (the vulkan backend hung on init in the spike host), an
 * explicit `QwenChatWrapper` (binding 3.21.1 does not read the GGUF's embedded
 * `tokenizer.chat_template`), and an explicit context size (Qwen3.5's
 * trainContextSize is 262144 and the default reservation over-allocates RAM).
 * @param modelPath - absolute path of the downloaded `.gguf` file.
 * @param contextSize - per-request context window in tokens.
 * @param systemPrompt - session-level system prompt, or `undefined` for none.
 * @returns the chat surface backing {@link LocalLlamaAdapter}'s requests.
 */
export async function createLocalSession(
  modelPath: string,
  contextSize: number,
  systemPrompt: string | undefined,
): Promise<LocalSession> {
  const llama = await getLlama({ gpu: false })
  const model = await llama.loadModel({ modelPath })
  const context = await model.createContext({ contextSize })
  const session = new LlamaChatSession({
    contextSequence: context.getSequence(),
    chatWrapper: new QwenChatWrapper(),
    ...systemPrompt === undefined ? {} : { systemPrompt },
  })
  return {
    promptStreaming: (text: string, opts: LocalPromptOptions) => bridgePrompt(session, text, opts),
  }
}

/**
 * Bridge `LlamaChatSession.prompt`'s `onTextChunk` callbacks into an async
 * iterable of chunks: text reaches the caller while the model still generates
 * (3.21.1's chat session has no native `promptStreaming`).
 */
async function* bridgePrompt(
  session: LlamaChatSession,
  text: string,
  opts: LocalPromptOptions,
): AsyncGenerator<string> {
  const chunks: string[] = []
  // Mutable state object: the settle callbacks run only from promise
  // reactions, so a plain `let` flag would be flow-narrowed to `false`.
  const state: { settled: boolean; failure: unknown } = { settled: false, failure: undefined }
  let wake: (() => void) | undefined
  const settle = (error?: unknown) => {
    state.settled = true
    state.failure = error
    const w = wake
    wake = undefined
    w?.()
  }
  void session.prompt(text, {
    ...opts.signal === undefined ? {} : { signal: opts.signal },
    ...opts.maxTokens === undefined ? {} : { maxTokens: opts.maxTokens },
    onTextChunk: (chunk: string) => {
      chunks.push(chunk)
      const w = wake
      wake = undefined
      w?.()
    },
  }).then(
    () => {
      settle()
    },
    (error: unknown) => {
      settle(error)
    },
  )
  while (true) {
    const chunk = chunks.shift()
    if (chunk === undefined) {
      if (state.settled) {
        if (state.failure instanceof Error) throw state.failure
        if (state.failure !== undefined) throw new Error('llm-local: local prompt failed', { cause: state.failure })
        return
      }
      await new Promise<void>((resolve) => { wake = resolve })
      continue
    }
    yield chunk
  }
}
