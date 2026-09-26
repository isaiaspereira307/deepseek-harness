import { describe, expect, it } from 'vitest'
import { CATALOG, catalogEntry } from '../src/catalog.ts'

describe('CATALOG', () => {
  it('has exactly the two spec entries with unique, non-empty ids and metadata', () => {
    expect(CATALOG).toHaveLength(2)
    const ids = CATALOG.map(entry => entry.id)
    expect(new Set(ids).size).toBe(2)
    for (const entry of CATALOG) {
      expect(entry.id.length).toBeGreaterThan(0)
      expect(entry.displayName.length).toBeGreaterThan(0)
      expect(entry.huggingFaceUrl).toMatch(/^https:\/\/huggingface\.co\/.*/)
      expect(entry.sizeBytes).toBeGreaterThan(0)
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/u)
      expect(entry.minRamBytes).toBeGreaterThan(0)
    }
  })

  it('catalogEntry looks up by id and returns undefined for unknown ids', () => {
    expect(catalogEntry('qwen3.5-0.8b-q4_0')?.displayName).toBe('Qwen3.5 0.8B')
    expect(catalogEntry('nonexistent')).toBeUndefined()
  })

  it('the 0.8B entry pins the spike-verified checksum and file size', () => {
    const entry = catalogEntry('qwen3.5-0.8b-q4_0')
    expect(entry?.sha256).toBe('444406ddd926550c724ec18d5120a9d40ded44908a063b0e66e9a7e5464c652c')
    expect(entry?.sizeBytes).toBe(507_154_688)
  })

  it('catalog entries are ordered smallest-first, the recommendation floor assumption', () => {
    expect(CATALOG[0]!.minRamBytes).toBeLessThan(CATALOG[1]!.minRamBytes)
    expect(CATALOG[0]!.sizeBytes).toBeLessThan(CATALOG[1]!.sizeBytes)
  })
})
