/** One downloadable local-model variant. */
export interface ModelCatalogEntry {
  /** Stable model id used in requests and storage records. */
  readonly id: string
  /** Human-facing display name. */
  readonly displayName: string
  /** Direct Hugging Face `resolve` URL of the `.gguf` file. */
  readonly huggingFaceUrl: string
  /** Exact byte size of the `.gguf` file. */
  readonly sizeBytes: number
  /** sha256 of the complete `.gguf` file, verified before the download lands. */
  readonly sha256: string
  /** Rough total-RAM floor the model needs to run; recommendation input. */
  readonly minRamBytes: number
}

/** Recommendation outcome for one RAM figure. */
export type Recommendation =
  | { kind: 'recommend'; entry: ModelCatalogEntry }
  | { kind: 'insufficient-ram'; floor: ModelCatalogEntry }

/** One per-model status row the client renders. */
export interface ModelStatusEntry {
  /** Catalog model id. */
  modelId: string
  /** Download lifecycle state; `not-downloaded` when no record exists. */
  status: 'not-downloaded' | 'downloading' | 'ready'
  /** Persisted progress byte count, present once a download started. */
  downloadedBytes?: number
  /** Whether this model id is the currently active one. */
  active: boolean
}
