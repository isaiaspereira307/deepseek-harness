import { CATALOG } from './catalog.ts'
import type { ModelCatalogEntry } from './types.ts'

export type Recommendation =
  | { kind: 'recommend'; entry: ModelCatalogEntry }
  | { kind: 'insufficient-ram'; floor: ModelCatalogEntry }

/**
 * Pick the largest catalog entry whose `minRamBytes` plus `safetyMarginBytes`
 * fits `totalRamBytes`. The reported floor is the smallest catalog entry, the
 * variant a machine below every footprint is told it cannot run.
 * @param totalRamBytes - total RAM of the machine, `os.totalmem()`.
 * @param safetyMarginBytes - headroom kept free above the model's footprint.
 * @param catalog - entries to choose from; defaults to the shipped catalog.
 * @returns the recommended entry, or the floor when nothing fits.
 * @throws when `catalog` is empty; there is no floor to report.
 */
export function recommendModel(
  totalRamBytes: number,
  safetyMarginBytes: number,
  catalog: readonly ModelCatalogEntry[] = CATALOG,
): Recommendation {
  const byFootprint = [...catalog].sort((a, b) => a.minRamBytes - b.minRamBytes)
  const floor = byFootprint[0]
  if (floor === undefined) throw new Error('recommendModel: catalog is empty')
  const fitting = [...byFootprint].reverse().find(entry => entry.minRamBytes + safetyMarginBytes <= totalRamBytes)
  if (fitting !== undefined) return { kind: 'recommend', entry: fitting }
  return { kind: 'insufficient-ram', floor }
}
