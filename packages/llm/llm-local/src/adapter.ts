import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, Message, RequestMessage, StreamChunk, TextBlock } from '@deepseek-ai/dsh-llm'

/** A loaded model's chat surface; the seam this adapter drives, kept narrow for testing. */
export interface LocalSession {
  /**
   * Stream one completion for `text` as incremental text deltas.
   * @param text - the fully rendered prompt for this request.
   * @param opts - per-call cancellation and output cap.
   */
  promptStreaming(text: string, opts: LocalPromptOptions): AsyncIterable<string>
}

/** Per-request generation controls handed to the local runtime. */
export interface LocalPromptOptions {
  /** Aborts the generation; partial text is discarded. */
  signal?: AbortSignal
  /** Output cap in tokens; omission uses the local runtime's own default. */
  maxTokens?: number
}

/**
 * The seams the adapter needs from the local runtime: where a model id's file
 * lives, how to open a chat session for it, and the output cap to use when a
 * request omits one.
 */
export interface LocalLlamaAdapterOptions {
  /** Resolve a catalog model id to its `.gguf` file path. */
  resolveModelPath(model: string): string
  /** Load one chat session for the model; called once per streamed request. */
  loadSession(modelPath: string, systemPrompt: string | undefined): Promise<LocalSession>
  /** Per-request output cap materialized when the caller omits `maxTokens`. */
  defaultMaxTokens?: number
}

/**
 * Provider-wire adapter over a local `node-llama-cpp` session. The adapter is
 * text-only: tool schemas are not honored and non-text content blocks are
 * dropped from the rendered prompt (package README records the gaps).
 */
export class LocalLlamaAdapter extends LlmAdapter {
  constructor(private readonly opts: LocalLlamaAdapterOptions) {
    super()
  }

  /**
   * @param _provider - the single `local` route this adapter serves.
   * @param model - exact model id passed to {@link GenerateOptions.model}.
   * @returns model identity plus the adapter's output cap for request defaulting.
   */
  override resolveModel(_provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider: _provider,
      id: model,
      name: model,
      ...this.opts.defaultMaxTokens === undefined ? {} : { defaultMaxTokens: this.opts.defaultMaxTokens },
    })
  }

  /**
   * Stream one model call as text chunks.
   * @param options - the fully-assembled request; honors `options.signal`.
   * @returns one text block streamed as deltas, then the terminal finish.
   */
  override async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    const modelPath = this.opts.resolveModelPath(options.model)
    const systemPrompt = options.system ?? leadingSystemText(options.messages)
    const session = await this.opts.loadSession(modelPath, systemPrompt)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    let text = ''
    for await (const delta of session.promptStreaming(renderTurns(options.messages), {
      ...options.signal === undefined ? {} : { signal: options.signal },
      ...options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens },
    })) {
      text += delta
      yield { type: 'text-delta', index: 0, text: delta }
    }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    const finish: StreamChunk = { type: 'finish', reason: { kind: 'stop' } }
    yield finish
  }
}

/** Text of the first system message; an empty one sends no prompt. */
function leadingSystemText(messages: readonly RequestMessage[]): string | undefined {
  const leading = messages.find(message => message.role === 'system')
  if (leading === undefined) return undefined
  const text = textOf(leading)
  return text.length === 0 ? undefined : text
}

/** Render non-system messages as `Role: text` paragraphs, the stable local wire format. */
function renderTurns(messages: readonly RequestMessage[]): string {
  const turns = messages
    .filter((message): message is TurnMessage => message.role !== 'system')
    .map(message => `${ROLE_LABEL[message.role]}${textOf(message)}`)
  return turns.join('\n\n')
}

/** A request message that carries turn text; the system message is the session prompt. */
type TurnMessage = Exclude<RequestMessage, { readonly role: 'system' }>

const ROLE_LABEL: Record<Exclude<Message['role'], 'system'>, string> = {
  user: 'User: ',
  assistant: 'Assistant: ',
  tool: 'Tool result: ',
  developer: 'Developer: ',
}

/** Concatenated text of the message's text blocks; non-text blocks contribute nothing. */
function textOf(message: RequestMessage): string {
  return message.content
    .filter((block): block is TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}
