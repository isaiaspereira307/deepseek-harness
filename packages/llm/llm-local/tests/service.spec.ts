import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import Storage from '@deepseek-ai/dsh-storage'
import {
  apply as storageJsonApply,
  Config as storageJsonConfig,
  inject as storageJsonInject,
  name as storageJsonName,
} from '@deepseek-ai/dsh-storage-json'
import {
  apply as storageDomainApply,
  Config as storageDomainConfig,
  inject as storageDomainInject,
  name as storageDomainName,
} from '@deepseek-ai/dsh-storage-domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** The native runtime the local route loads; the spike pinned CPU-only inference. */
const native = vi.hoisted(() => ({ modelPath: '', contextSize: 0, gpu: undefined as boolean | undefined, systemPrompt: undefined as string | undefined }))
vi.mock('node-llama-cpp', () => ({
  getLlama: (options: { gpu: boolean }) => {
    native.gpu = options.gpu
    return Promise.resolve({
      loadModel: ({ modelPath }: { modelPath: string }) => {
        native.modelPath = modelPath
        return Promise.resolve({
          createContext: ({ contextSize }: { contextSize: number }) => {
            native.contextSize = contextSize
            return { getSequence: () => ({}) }
          },
        })
      },
    })
  },
  LlamaChatSession: class {
    constructor(options: { systemPrompt?: string }) { native.systemPrompt = options.systemPrompt }
    prompt(_text: string, options: { onTextChunk?: (chunk: string) => void }): Promise<void> {
      options.onTextChunk?.('local answer')
      return Promise.resolve()
    }
  },
  QwenChatWrapper: function QwenChatWrapper() { /* the chat template the spike pinned */ },
}))
/** Total RAM the Host reads; a spec pins it instead of trusting the runner's memory. */
const hostRam = vi.hoisted(() => ({ total: 0 }))
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, totalmem: () => hostRam.total }
})
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { CATALOG } from '../src/catalog.ts'
import { localModelsDomain } from '../src/state.ts'
import { LocalModels } from '../src/service.ts'
import type { DownloadFn } from '../src/service.ts'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { ModelCatalogEntry } from '../src/types.ts'

const GB = 1024 ** 3

describe('LocalModels', () => {
  let root: string
  let modelsDir: string
  let ctx: Context

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-llm-local-svc-state-'))
    modelsDir = await mkdtemp(join(tmpdir(), 'dsh-llm-local-svc-models-'))
    ctx = new Context()
    await ctx.plugin(Storage)
    await ctx.plugin({ name: storageJsonName, inject: storageJsonInject, apply: storageJsonApply, Config: storageJsonConfig }, { root })
    await ctx.plugin({ name: storageDomainName, inject: storageDomainInject, apply: storageDomainApply, Config: storageDomainConfig }, { backend: 'json' })
    await ctx.plugin(LlmRuntime)
  })

  afterEach(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    await rm(modelsDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  /** Boot the service with a fake download; without one, writes local fixture bytes. */
  async function harness(options?: {
    download?: DownloadFn
  }): Promise<LocalModels> {
    const fakeDownload = options?.download ?? (async (entry, destPath, opts) => {
      await writeFile(destPath, 'model-bytes')
      opts.onProgress?.(entry.sizeBytes)
    })
    class TestService extends LocalModels {
      protected override downloadModelFn: DownloadFn = fakeDownload
    }
    await ctx.plugin(TestService, { modelsDir, ramSafetyMarginBytes: 2 * GB, contextSize: 8192 })
    return ctx.llmLocal
  }

  it('boots, registers the local route, and lists the two catalog entries', async () => {
    const service = await harness()
    expect(ctx.llm.listProviders().map(provider => provider.id)).toContain('local')
    expect(service.listCatalog()).toEqual(CATALOG)
  })

  it('lists per-model status joined with the catalog and the active id', async () => {
    const service = await harness()
    await service.startDownload('qwen3.5-0.8b-q4_0')
    await service.setActive('qwen3.5-0.8b-q4_0')
    const status = service.listStatus()
    expect(status).toEqual([
      { modelId: 'qwen3.5-0.8b-q4_0', status: 'ready', downloadedBytes: CATALOG[0]!.sizeBytes, active: true },
      { modelId: 'qwen3.5-4b-q4_0', status: 'not-downloaded', active: false },
    ])
  })

  it('reports a row as downloading while the download is in flight', async () => {
    let finish: (() => void) | undefined
    const service = await harness({
      download: async () => {
        await new Promise<void>((resolve) => { finish = resolve })
      },
    })
    const downloading = service.startDownload('qwen3.5-0.8b-q4_0')
    await vi.waitFor(() => {
      expect(service.listStatus().find(row => row.modelId === 'qwen3.5-0.8b-q4_0')?.status).toBe('downloading')
    })
    finish?.()
    await downloading
  })

  it('serves the local route from the model file under modelsDir, CPU-only', async () => {
    await harness()
    const chunks: StreamChunk[] = []
    for await (const chunk of ctx.llm.stream({
      provider: 'local',
      model: 'qwen3.5-0.8b-q4_0',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    })) chunks.push(chunk)
    expect(native.gpu).toBe(false)
    expect(native.modelPath).toBe(join(modelsDir, 'qwen3.5-0.8b-q4_0.gguf'))
    expect(native.contextSize).toBe(8192)
    expect(native.systemPrompt).toBeUndefined()
    expect(chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text)).toEqual(['local answer'])
  })

  it('recommends from the machine memory the Host reads, above the configured margin', async () => {
    const service = await harness()
    hostRam.total = 16 * GB
    expect(service.recommendedModel()).toEqual({ kind: 'recommend', entry: CATALOG[1] })
    hostRam.total = 1 * GB
    expect(service.recommendedModel()).toEqual({ kind: 'insufficient-ram', floor: CATALOG[0] })
  })

  it('downloads a model and persists downloading then ready records', async () => {
    const service = await harness()
    await service.startDownload('qwen3.5-0.8b-q4_0')
    expect(service.listStatus().find(row => row.modelId === 'qwen3.5-0.8b-q4_0')?.status).toBe('ready')
    await expect(stat(join(modelsDir, 'qwen3.5-0.8b-q4_0.gguf'))).resolves.toBeTruthy()
  })

  it('records throttled progress during the download', async () => {
    const progresses: Array<number | undefined> = []
    const slowDownload = async (
      entry: ModelCatalogEntry,
      _destPath: string,
      opts: { onProgress?: (bytes: number) => void },
    ): Promise<void> => {
      const half = Math.floor(entry.sizeBytes / 2)
      for (const bytes of [0, half, entry.sizeBytes]) {
        opts.onProgress?.(bytes)
        progresses.push(bytes)
      }
    }
    const service = await harness({ download: slowDownload })
    await service.startDownload('qwen3.5-0.8b-q4_0')
    const row = service.listStatus().find(entry => entry.modelId === 'qwen3.5-0.8b-q4_0')
    expect(row?.status).toBe('ready')
    expect(row?.downloadedBytes).toBe(CATALOG[0]!.sizeBytes)
    expect(progresses).toEqual([0, Math.floor(CATALOG[0]!.sizeBytes / 2), CATALOG[0]!.sizeBytes])
  })

  it('a second concurrent start joins the first instead of racing it', async () => {
    let downloadCalls = 0
    const slowDownload = async (
      _entry: ModelCatalogEntry,
      _destPath: string,
      _opts: { onProgress?: (bytes: number) => void },
    ): Promise<void> => {
      downloadCalls += 1
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    const service = await harness({ download: slowDownload })
    await Promise.all([
      service.startDownload('qwen3.5-0.8b-q4_0'),
      service.startDownload('qwen3.5-0.8b-q4_0'),
    ])
    expect(downloadCalls).toBe(1)
  })

  it('cancelDownload aborts the in-flight download and drops its record', async () => {
    const service = await harness({
      download: async (_entry, _destPath, opts) => {
        opts.signal?.throwIfAborted()
        await new Promise<never>((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          }, { once: true })
        })
      },
    })
    const downloading = service.startDownload('qwen3.5-0.8b-q4_0')
    await service.cancelDownload('qwen3.5-0.8b-q4_0')
    await expect(downloading).rejects.toThrow()
    expect(service.listStatus().find(row => row.modelId === 'qwen3.5-0.8b-q4_0')?.status).toBe('not-downloaded')
  })

  it('a failed download drops the record and the failure reaches the caller', async () => {
    const service = await harness({
      download: async () => { throw new Error('disk full') },
    })
    await expect(service.startDownload('qwen3.5-0.8b-q4_0')).rejects.toThrow('disk full')
    expect(service.listStatus().find(row => row.modelId === 'qwen3.5-0.8b-q4_0')?.status).toBe('not-downloaded')
  })

  it('rejects downloads and activations of unknown model ids', async () => {
    const service = await harness()
    await expect(service.startDownload('nonexistent')).rejects.toThrow('unknown model id')
    await expect(service.setActive('nonexistent')).rejects.toThrow('unknown model id')
  })

  it('setActive requires the downloaded file and persists the active id', async () => {
    const service = await harness()
    await expect(service.setActive('qwen3.5-0.8b-q4_0')).rejects.toThrow('is not downloaded')
    await service.startDownload('qwen3.5-0.8b-q4_0')
    await service.setActive('qwen3.5-0.8b-q4_0')
    expect(service.getActive()).toBe('qwen3.5-0.8b-q4_0')
  })

  it('deleteModel removes the file and record, and clears the active id', async () => {
    const service = await harness()
    await service.startDownload('qwen3.5-0.8b-q4_0')
    await service.setActive('qwen3.5-0.8b-q4_0')
    await service.deleteModel('qwen3.5-0.8b-q4_0')
    await expect(stat(join(modelsDir, 'qwen3.5-0.8b-q4_0.gguf'))).rejects.toThrow()
    expect(service.listStatus().find(row => row.modelId === 'qwen3.5-0.8b-q4_0')?.status).toBe('not-downloaded')
    expect(service.getActive()).toBeUndefined()
  })

  it('passes a caller signal into the download alongside the service abort', async () => {
    let seen: AbortSignal | undefined
    const service = await harness({
      download: async (_entry, _destPath, opts) => {
        seen = opts.signal
      },
    })
    const caller = new AbortController()
    await service.startDownload('qwen3.5-0.8b-q4_0', caller.signal)
    expect(seen?.aborted).toBe(false)
    const serviceAbort = new AbortController()
    serviceAbort.abort()
    expect(seen?.aborted).toBe(false)
    caller.abort()
    expect(seen?.aborted).toBe(true)
  })

  it('cancelDownload resolves without effect when the model is not downloading', async () => {
    const service = await harness()
    await expect(service.cancelDownload('qwen3.5-0.8b-q4_0')).resolves.toBeUndefined()
  })

  it('cancelDownload logs a download failure that is not the abort', async () => {
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const service = await harness({
      download: async (_entry, _destPath, opts) => {
        // The abort may land before the body starts; either way the download
        // fails with its own error, which cancelDownload must log rather than
        // mistake for the cancellation it asked for.
        await new Promise<never>((_resolve, reject) => {
          const fail = () => { reject(new Error('network reset')) }
          if (opts.signal?.aborted === true) fail()
          else opts.signal?.addEventListener('abort', fail, { once: true })
        })
      },
    })
    const downloading = service.startDownload('qwen3.5-0.8b-q4_0')
    await service.cancelDownload('qwen3.5-0.8b-q4_0')
    await expect(downloading).rejects.toThrow('network reset')
    expect(warn).toHaveBeenCalled()
  })

  it('deleteModel keeps the active id when another model is deleted', async () => {
    const service = await harness()
    await service.startDownload('qwen3.5-0.8b-q4_0')
    await service.setActive('qwen3.5-0.8b-q4_0')
    await service.deleteModel('qwen3.5-4b-q4_0')
    expect(service.getActive()).toBe('qwen3.5-0.8b-q4_0')
  })

  it('setActive surfaces a models directory it cannot read', async () => {
    const service = await harness()
    await rm(modelsDir, { recursive: true, force: true })
    await writeFile(modelsDir, 'not a directory')
    await expect(service.setActive('qwen3.5-0.8b-q4_0')).rejects.toThrow()
    await rm(modelsDir, { force: true })
  })

  it('fails loud when a Remote runs before the service is initialized', async () => {
    const service = new LocalModels(ctx, { modelsDir, ramSafetyMarginBytes: 2 * GB, contextSize: 8192 })
    expect(() => service.listStatus()).toThrow('not initialized')
  })

  it('finishes the download when a progress write fails', async () => {
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const service = await harness()
    const domain = ctx.storageDomain.get(localModelsDomain.name) as Domain<typeof localModelsDomain>
    const table = domain.table('models')
    const put = table.put.bind(table)
    // The first put opens the record; the second is the progress write.
    vi.spyOn(table, 'put')
      .mockImplementationOnce(put)
      .mockImplementationOnce(async () => { throw new Error('storage offline') })
      .mockImplementation(put)
    await service.startDownload('qwen3.5-0.8b-q4_0')
    expect(warn).toHaveBeenCalled()
    expect(service.listStatus().find(row => row.modelId === 'qwen3.5-0.8b-q4_0')?.status).toBe('ready')
  })

  it('deleteModel refuses while the model is downloading', async () => {
    const service = await harness({
      download: async (_entry, _destPath, opts) => {
        // The abort may land before the download body starts running; a signal
        // that is already aborted must reject here instead of waiting forever.
        opts.signal?.throwIfAborted()
        await new Promise<never>((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          }, { once: true })
        })
      },
    })
    const downloading = service.startDownload('qwen3.5-0.8b-q4_0')
    await expect(service.deleteModel('qwen3.5-0.8b-q4_0')).rejects.toThrow('cancel it before deleting')
    await service.cancelDownload('qwen3.5-0.8b-q4_0')
    await expect(downloading).rejects.toThrow()
  })
})
