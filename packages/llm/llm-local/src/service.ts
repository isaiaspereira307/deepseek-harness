import { rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { LocalLlamaAdapter } from './adapter.ts'
import { catalogEntry, CATALOG } from './catalog.ts'
import { downloadModel } from './download.ts'
import { createLocalSession } from './llama.ts'
import { ensureModelsDir } from './paths.ts'
import { recommendModel } from './recommend.ts'
import { localModelsDomain } from './state.ts'
import type { ModelCatalogEntry, ModelStatusEntry, Recommendation } from './types.ts'

/** Streams one catalog entry's `.gguf` file to its destination. */
export type DownloadFn = (
  entry: ModelCatalogEntry,
  destPath: string,
  opts: { onProgress?: (bytes: number) => void; signal?: AbortSignal },
) => Promise<void>

/** Resolved plugin configuration. */
export interface LocalModelsConfig {
  /** Directory holding downloaded `.gguf` files; created when missing. */
  modelsDir: string
  /** Headroom above a model's `minRamBytes` required before it is recommended. */
  ramSafetyMarginBytes: number
  /** Context window per loaded model; Qwen3.5's default (262144) would over-allocate RAM. */
  contextSize: number
}

/** Runtime schema for {@link LocalModelsConfig}. */
export const LocalModelsConfigSchema: z<LocalModelsConfig> = z.object({
  modelsDir: z.string().required(),
  ramSafetyMarginBytes: z.number().default(2 * 1024 ** 3),
  contextSize: z.number().step(1).default(8192),
})

/** One in-flight download keyed by model id. */
interface InFlight {
  readonly promise: Promise<void>
  readonly controller: AbortController
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Local model catalog, download control, and the `local` route. */
    llmLocal: LocalModels
  }
}

/**
 * The `llmLocal` remote service: model catalog, RAM-based recommendation,
 * download control, and the local provider route registration. Downloads are
 * joined per model id (a second start attaches to the in-flight one), records
 * land in the `llm_local_models` storage domain, and the active model id is a
 * durable global slot.
 */
export class LocalModels extends TypertRemoteService {
  /** The local route depends on the LLM runtime and the storage domain facility. */
  static inject = ['llm', 'storageDomain']
  static Config = LocalModelsConfigSchema

  private readonly inFlight = new Map<string, InFlight>()
  private domain: Domain<typeof localModelsDomain> | undefined

  /**
   * @param ctx - owning Host context.
   * @param config - resolved models directory, RAM margin, and context size.
   */
  constructor(ctx: Context, private readonly config: LocalModelsConfig) {
    super(ctx, 'llmLocal')
  }

  /** The file download implementation; tests substitute a fake by overriding. */
  protected get download(): DownloadFn {
    return downloadModel
  }

  protected async [Service.init](): Promise<void> {
    await ensureModelsDir(this.config.modelsDir)
    const domain = await this.ctx.storageDomain.open(localModelsDomain)
    this.domain = domain
    this.ctx.effect(() => async () => {
      await domain.close()
    }, 'llmLocal.domainClose')
    this.ctx.llm.registerAdapter(['local'], new LocalLlamaAdapter({
      resolveModelPath: model => join(this.config.modelsDir, `${model}.gguf`),
      loadSession: (modelPath, systemPrompt) => createLocalSession(modelPath, this.config.contextSize, systemPrompt),
      defaultMaxTokens: this.config.contextSize,
    }))
  }

  /**
   * The two cataloged Qwen3.5 GGUF variants, in smallest-first order.
   * @returns the read-only model catalog.
   */
  @Remote
  listCatalog(): readonly ModelCatalogEntry[] {
    return CATALOG
  }

  /**
   * Per-model client status: catalog order joined with the persisted record
   * and the active id. A model with no record is `not-downloaded`.
   * @returns one status row per catalog entry.
   */
  @Remote
  listStatus(): readonly ModelStatusEntry[] {
    const domain = this.requireDomain()
    const active = domain.global.get().modelId
    return CATALOG.map((entry) => {
      const record = domain.table('models').get(entry.id)
      const downloadingOrReady = record !== undefined
      return {
        modelId: entry.id,
        status: record?.status === 'downloading' ? 'downloading' : downloadingOrReady ? 'ready' : 'not-downloaded',
        active: active === entry.id,
        ...record?.downloadedBytes === undefined ? {} : { downloadedBytes: record.downloadedBytes },
      }
    })
  }

  /**
   * Recommend the largest model whose footprint plus margin fits the supplied RAM.
   * @param totalRamBytes - total RAM of the target machine, `os.totalmem()`.
   * @param safetyMarginBytes - headroom kept free above the model's footprint.
   * @returns the recommended entry, or the floor when nothing fits.
   */
  @Remote
  recommend(totalRamBytes: number, safetyMarginBytes: number): Recommendation {
    return recommendModel(totalRamBytes, safetyMarginBytes)
  }

  /**
   * Current active model id.
   * @returns the active model id, or `undefined` when none was activated.
   */
  @Remote
  getActive(): string | undefined {
    return this.requireDomain().global.get().modelId
  }

  /**
   * Activate a downloaded model. Persisted before the next request uses it;
   * the file must already be on disk.
   * @param modelId - catalog model id to activate.
   * @throws when the id is unknown or the model file is not downloaded.
   */
  @Remote
  async setActive(modelId: string): Promise<void> {
    this.requireEntry(modelId)
    const filePath = join(this.config.modelsDir, `${modelId}.gguf`)
    let downloaded = false
    try {
      downloaded = (await stat(filePath)).isFile()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (!downloaded) throw new Error(`llm-local: model "${modelId}" is not downloaded`)
    await this.requireDomain().global.set({ modelId })
  }

  /**
   * Download one catalog model into `modelsDir`, recording throttled progress
   * in the storage domain. A second start for the same model joins the
   * in-flight download instead of racing it.
   * @param modelId - catalog model id to download.
   * @param signal - remote caller cancellation; the download also stops on service disposal.
   * @throws when the id is unknown, the download fails, or it was cancelled.
   */
  @Remote
  async startDownload(modelId: string, signal?: AbortSignal): Promise<void> {
    const entry = this.requireEntry(modelId)
    const existing = this.inFlight.get(modelId)
    if (existing !== undefined) return existing.promise
    const controller = new AbortController()
    const promise = this.runDownload(entry, AbortSignal.any(signal === undefined ? [controller.signal] : [controller.signal, signal]))
    this.inFlight.set(modelId, { promise, controller })
    try {
      await promise
    } finally {
      this.inFlight.delete(modelId)
    }
  }

  /**
   * Abort one in-flight download and discard its partial state. Resolves
   * without effect when the model is not downloading.
   * @param modelId - catalog model id whose download should stop.
   */
  @Remote
  async cancelDownload(modelId: string): Promise<void> {
    const flight = this.inFlight.get(modelId)
    if (flight === undefined) return
    flight.controller.abort()
    try {
      await flight.promise
    } catch (error) {
      // Abort is the cancellation working as asked; other failures already
      // reached the startDownload caller, so they are only logged here.
      if (!isAbortError(error)) this.ctx.logger.warn(`llm-local: download of "${modelId}" failed during cancel`, error)
    }
  }

  /**
   * Delete one model's file and record, clearing the active id when needed.
   * @param modelId - catalog model id to delete.
   * @throws when the id is unknown or the model is currently downloading.
   */
  @Remote
  async deleteModel(modelId: string): Promise<void> {
    this.requireEntry(modelId)
    if (this.inFlight.has(modelId)) {
      throw new Error(`llm-local: model "${modelId}" is downloading; cancel it before deleting`)
    }
    await rm(join(this.config.modelsDir, `${modelId}.gguf`), { force: true })
    await this.requireDomain().table('models').delete(modelId)
    if (this.requireDomain().global.get().modelId === modelId) {
      await this.requireDomain().global.set({ modelId: undefined })
    }
  }

  /** One download lifecycle: record, stream with throttled progress, commit or discard. */
  private async runDownload(entry: ModelCatalogEntry, signal: AbortSignal): Promise<void> {
    const domain = this.requireDomain()
    const table = domain.table('models')
    await table.put(entry.id, { modelId: entry.id, status: 'downloading', downloadedBytes: 0 })
    const threshold = Math.max(1, Math.floor(entry.sizeBytes / 100))
    let lastRecorded = 0
    let progressChain: Promise<void> = Promise.resolve()
    try {
      await this.download(entry, join(this.config.modelsDir, `${entry.id}.gguf`), {
        signal,
        onProgress: (bytes) => {
          if (bytes - lastRecorded < threshold && bytes !== entry.sizeBytes) return
          lastRecorded = bytes
          // Progress writes serialize on this chain so records never go backwards.
          progressChain = progressChain
            .then(() => table.put(entry.id, { modelId: entry.id, status: 'downloading', downloadedBytes: bytes }))
            .catch((error: unknown) => { this.ctx.logger.warn(`llm-local: progress write for "${entry.id}" failed`, error) })
        },
      })
      await progressChain
      await table.put(entry.id, { modelId: entry.id, status: 'ready', downloadedBytes: entry.sizeBytes })
    } catch (error) {
      await table.delete(entry.id)
      throw error
    }
  }

  private requireEntry(modelId: string): ModelCatalogEntry {
    const entry = catalogEntry(modelId)
    if (entry === undefined) throw new Error(`llm-local: unknown model id "${modelId}"`)
    return entry
  }

  private requireDomain(): Domain<typeof localModelsDomain> {
    if (this.domain === undefined) throw new Error('llm-local: the service is not initialized')
    return this.domain
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
