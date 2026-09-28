import { createHash } from 'node:crypto'
import { open, rename, rm } from 'node:fs/promises'
import type { ModelCatalogEntry } from './types.ts'

/** The downloaded file's sha256 does not match the catalog entry's; it is discarded. */
export class ChecksumMismatchError extends Error {
  constructor(
    readonly entryId: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`llm-local: checksum mismatch for "${entryId}" (expected ${expected}, got ${actual})`)
  }
}

/** Progress and cancellation hooks for one download. */
export interface DownloadOptions {
  /** Called with the cumulative downloaded byte count after each chunk. */
  onProgress?: (downloadedBytes: number) => void
  /** Aborts the download; the destination is never touched. */
  signal?: AbortSignal
}

/**
 * Stream `entry.huggingFaceUrl` to a temp path beside `destPath`, verify its
 * sha256 against `entry.sha256`, and rename into place only on a match. Any
 * failure — HTTP error, network error, checksum mismatch, or abort — removes
 * the temp file and leaves no partial file at `destPath`.
 * @param entry - catalog entry naming the source URL and expected checksum.
 * @param destPath - final file path; never exists unless the download succeeded.
 * @param opts - progress and cancellation.
 */
export async function downloadModel(
  entry: ModelCatalogEntry,
  destPath: string,
  opts: DownloadOptions,
): Promise<void> {
  const tempPath = `${destPath}.download`
  const hash = createHash('sha256')
  let downloaded = 0
  const handle = await open(tempPath, 'w')
  try {
    const response = await fetch(entry.huggingFaceUrl, opts.signal === undefined ? {} : { signal: opts.signal })
    if (!response.ok || response.body === null) {
      throw new Error(`llm-local: download of "${entry.id}" failed with HTTP ${response.status}`)
    }
    for await (const chunk of response.body) {
      hash.update(chunk)
      downloaded += chunk.byteLength
      opts.onProgress?.(downloaded)
      await handle.write(chunk)
    }
    const actual = hash.digest('hex')
    if (actual !== entry.sha256) throw new ChecksumMismatchError(entry.id, entry.sha256, actual)
    await handle.close()
    await rename(tempPath, destPath)
  } catch (error) {
    // The body loop's throw leaves the handle open; a cleanup close can only
    // fail on an already-destroyed handle and must not mask the download error.
    /* v8 ignore next -- closing a still-open handle fails only when the filesystem
       itself fails, and that failure is not the one the caller asked about */
    await handle.close().catch(() => undefined)
    await rm(tempPath, { force: true })
    throw error
  }
}
