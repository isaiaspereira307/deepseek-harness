import type { ModelCatalogEntry } from './types.ts'

/**
 * Every model this package will download or load, with the repository
 * filename, sha256, and byte size the downloader verifies. An id absent from
 * this list is not a local model: the service reports it as unavailable rather
 * than fetching an unreviewed file.
 */
export const CATALOG: readonly ModelCatalogEntry[] = [
  {
    id: 'qwen3.5-0.8b-q4_0',
    displayName: 'Qwen3.5 0.8B',
    huggingFaceUrl: 'https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_0.gguf',
    sizeBytes: 507_154_688,
    // Verified in the Task 1 spike: equals the file's HF LFS oid.
    sha256: '444406ddd926550c724ec18d5120a9d40ded44908a063b0e66e9a7e5464c652c',
    minRamBytes: 2 * 1024 ** 3,
  },
  {
    id: 'qwen3.5-4b-q4_0',
    displayName: 'Qwen3.5 4B',
    huggingFaceUrl: 'https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_0.gguf',
    sizeBytes: 2_583_221_408,
    // Verified against the file's HF LFS oid in Task 2.
    sha256: '298fcb5fe7a77ccc79745ae24751560c5ac56874caff4bb39b1f2055bd72b8bb',
    minRamBytes: 6 * 1024 ** 3,
  },
]

/**
 * Look up one catalog entry by id.
 * @param id - model id from {@link CATALOG}.
 * @returns the entry, or `undefined` for an unknown id.
 */
export function catalogEntry(id: string): ModelCatalogEntry | undefined {
  return CATALOG.find(entry => entry.id === id)
}
