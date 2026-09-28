/**
 * Local models settings store: one snapshot joining the Host model catalog
 * with each model's download state. The Host owns every fact, so rows are
 * re-derived from `listCatalog` and `listStatus` after each write. No pushed
 * event announces byte progress, so a poll timer runs only while a row is
 * downloading.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ModelCatalogEntry, ModelStatusEntry } from '@deepseek-ai/dsh-llm-local/types'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** Refresh cadence for download progress while a row is downloading. */
const PROGRESS_POLL_MS = 1000

/** One rendered row: catalog metadata joined with the live download state. */
export interface LocalModelRow {
  /** Catalog model id, the key every action takes. */
  readonly modelId: string
  /** Human-facing display name. */
  readonly displayName: string
  /** Exact `.gguf` size, the denominator of the progress text. */
  readonly sizeBytes: number
  /** Download state, with `active` marking the model requests use now. */
  readonly status: 'not-downloaded' | 'downloading' | 'ready' | 'active'
  /** Bytes on disk, present once a download has started. */
  readonly downloadedBytes?: number
}

/** Render state of the whole section. */
export interface LocalModelsState {
  /** Load lifecycle; `idle` before the first load starts. */
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Latest failure text, or null. */
  error: string | null
  /** One row per catalog entry, in catalog order. */
  rows: readonly LocalModelRow[]
}

/** What the first-run recommendation step needs to know about the section. */
export type LocalModelsReadiness = 'loading' | 'needs-recommendation' | 'has-model'

/**
 * Join one catalog entry with its download state.
 * @param entry - catalog metadata.
 * @param status - the matching status row, absent when the model has no record.
 * @returns the rendered row.
 */
export function joinLocalModelRow(
  entry: ModelCatalogEntry,
  status: ModelStatusEntry | undefined,
): LocalModelRow {
  return {
    modelId: entry.id,
    displayName: entry.displayName,
    sizeBytes: entry.sizeBytes,
    status: status === undefined ? 'not-downloaded' : status.active ? 'active' : status.status,
    ...status?.downloadedBytes === undefined ? {} : { downloadedBytes: status.downloadedBytes },
  }
}

/** The load and mutation surface the settings section drives. */
export interface LocalModelsController {
  /** Refetch the catalog and per-model status. */
  load: () => Promise<void>
  /** Start one download. */
  download: (modelId: string) => Promise<void>
  /** Abort one in-flight download. */
  cancel: (modelId: string) => Promise<void>
  /** Make one downloaded model the one requests use. */
  activate: (modelId: string) => Promise<void>
  /** Delete one model's file and record. */
  remove: (modelId: string) => Promise<void>
}

/** The local models settings controller (one per settings surface). */
export class LocalModelsStore implements LocalModelsController {
  /** The snapshot the section renders from (uSES-safe store). */
  readonly store: SnapshotStore<LocalModelsState> = createSnapshotStore<LocalModelsState>({
    status: 'idle', error: null, rows: [],
  })

  /** Progress poll handle, present only while a row is downloading. */
  private pollTimer: ReturnType<typeof setInterval> | undefined

  /** A load already in flight, so concurrent calls share one request. */
  private loading: Promise<void> | undefined

  /**
   * @param ctx - the section plugin's context, whose `remote.llmLocal`
   * namespace carries the catalog, status, and download operations.
   */
  constructor(private readonly ctx: ClientContext) {}

  /**
   * Refetch the catalog and per-model status, then converge the progress poll
   * with the rows. A failure keeps the last good rows and carries the message.
   * @returns after the snapshot is published.
   */
  async load(): Promise<void> {
    if (this.loading !== undefined) return this.loading
    this.store.update((state) => { state.status = 'loading'; state.error = null })
    const request = this.fetch()
    this.loading = request
    void request.finally(() => { this.loading = undefined })
    return request
  }

  /**
   * Start one download. The row shows progress before the Host answers, and
   * the poll timer follows the byte count until the Host settles.
   * @param modelId - catalog model id to download.
   * @returns after the row reflects the settled state.
   */
  async download(modelId: string): Promise<void> {
    this.store.update((state) => {
      state.rows = state.rows.map(row => row.modelId === modelId && row.status === 'not-downloaded'
        ? { ...row, status: 'downloading', downloadedBytes: 0 }
        : row)
    })
    this.convergePolling()
    await this.mutate(() => this.ctx.remote.llmLocal.startDownload(modelId))
  }

  /**
   * Abort one in-flight download; the Host discards its partial file.
   * @param modelId - catalog model id whose download should stop.
   * @returns after the row reflects the settled state.
   */
  async cancel(modelId: string): Promise<void> {
    await this.mutate(() => this.ctx.remote.llmLocal.cancelDownload(modelId))
  }

  /**
   * Make one downloaded model the one requests use.
   * @param modelId - catalog model id to activate.
   * @returns after the row reflects the settled state.
   */
  async activate(modelId: string): Promise<void> {
    await this.mutate(() => this.ctx.remote.llmLocal.setActive(modelId))
  }

  /**
   * Delete one model's file and record; the Host clears the active pointer
   * when the deleted model was in use.
   * @param modelId - catalog model id to delete.
   * @returns after the row reflects the settled state.
   */
  async remove(modelId: string): Promise<void> {
    await this.mutate(() => this.ctx.remote.llmLocal.deleteModel(modelId))
  }

  /** Stop the progress poll; the Host keeps any download it already started. */
  dispose(): void {
    if (this.pollTimer !== undefined) {
      clearInterval(this.pollTimer)
      this.pollTimer = undefined
    }
  }

  /**
   * Run one Host mutation, then refresh the joined list, and let a failure
   * message outlive the refresh: publishing it first would erase it.
   * @param operation - the Host Remote call to run.
   * @returns after the rows and any failure message are published.
   */
  private async mutate<T>(operation: () => Promise<RemoteResult<T>>): Promise<void> {
    const result = await operation()
    await this.load()
    if (!result.ok) this.store.update((state) => { state.error = result.error.message })
  }

  /** Read both Host lists and publish the joined rows. */
  private async fetch(): Promise<void> {
    const [catalog, status] = await Promise.all([
      this.ctx.remote.llmLocal.listCatalog(),
      this.ctx.remote.llmLocal.listStatus(),
    ])
    if (!catalog.ok || !status.ok) {
      const message = catalog.ok ? status.error.message : catalog.error.message
      this.store.update((state) => { state.status = 'error'; state.error = message })
      return
    }
    const byModelId = new Map(status.value.map(row => [row.modelId, row]))
    this.store.update((state) => {
      state.status = 'ready'
      state.error = null
      state.rows = catalog.value.map(entry => joinLocalModelRow(entry, byModelId.get(entry.id)))
    })
    this.convergePolling()
  }

  /** Run the progress poll exactly while a row is downloading. */
  private convergePolling(): void {
    const downloading = this.store.getSnapshot().rows.some(row => row.status === 'downloading')
    if (downloading && this.pollTimer === undefined) {
      this.pollTimer = setInterval(() => { void this.load() }, PROGRESS_POLL_MS)
      return
    }
    if (!downloading) this.dispose()
  }
}

/**
 * Project the section state for the first-run recommendation step.
 * @param state - the current section snapshot.
 * @returns `loading` before the first rows land, `needs-recommendation` while
 * no model is on disk, and `has-model` once one is ready, downloading, or in use.
 */
export function localModelsReadiness(state: LocalModelsState): LocalModelsReadiness {
  if (state.status !== 'ready') return 'loading'
  if (state.rows.some(row => row.status !== 'not-downloaded')) return 'has-model'
  return 'needs-recommendation'
}
