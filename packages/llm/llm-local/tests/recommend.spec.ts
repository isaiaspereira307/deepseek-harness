import { describe, expect, it } from 'vitest'
import { CATALOG } from '../src/catalog.ts'
import { recommendModel } from '../src/recommend.ts'

const GB = 1024 ** 3

describe('recommendModel', () => {
  it('recommends the 4B model when RAM clears its footprint plus the margin', () => {
    const result = recommendModel(16 * GB, 2 * GB)
    expect(result).toEqual({ kind: 'recommend', entry: CATALOG[1] })
  })

  it('recommends the 0.8B model when RAM clears only its footprint', () => {
    const result = recommendModel(4 * GB, 1 * GB)
    expect(result).toEqual({ kind: 'recommend', entry: CATALOG[0] })
  })

  it('reports insufficient RAM below even the smallest model floor, naming that floor', () => {
    const result = recommendModel(1 * GB, 1 * GB)
    expect(result).toEqual({ kind: 'insufficient-ram', floor: CATALOG[0] })
  })

  it('a larger safety margin can push a machine from 4B down to 0.8B', () => {
    const result = recommendModel(8 * GB, 4 * GB)
    expect(result).toEqual({ kind: 'recommend', entry: CATALOG[0] })
  })

  it('rejects an empty catalog instead of returning a floor', () => {
    expect(() => recommendModel(16 * GB, 0, [])).toThrow('catalog is empty')
  })
})
