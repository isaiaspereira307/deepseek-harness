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
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CATALOG } from '../src/catalog.ts'
import { LocalModels } from '../src/service.ts'
import type { DownloadFn } from '../src/service.ts'
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
      protected override get download(): typeof fakeDownload {
        return fakeDownload
      }
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

  it('recommends from the supplied RAM figures without reading the host', async () => {
    const service = await harness()
    expect(service.recommend(16 * GB, 2 * GB)).toEqual({ kind: 'recommend', entry: CATALOG[1] })
    expect(service.recommend(1 * GB, 1 * GB)).toEqual({ kind: 'insufficient-ram', floor: CATALOG[0] })
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
