/** Readiness projection the first-run step reads, one case per state. */
import { expect, it } from 'vitest'
import { localModelsReadiness } from '../src/client/store.ts'
import type { LocalModelRow, LocalModelsState } from '../src/client/store.ts'

const ROW: LocalModelRow = { modelId: 'qwen3.5-0.8b-q4_0', displayName: 'Qwen3.5 0.8B', sizeBytes: 507_154_688, status: 'not-downloaded' }
const ready = (rows: readonly LocalModelRow[]): LocalModelsState => ({ status: 'ready', error: null, rows })

it('reports loading until the first rows land', () => {
  expect(localModelsReadiness({ status: 'idle', error: null, rows: [] })).toBe('loading')
  expect(localModelsReadiness({ status: 'error', error: 'catalog offline', rows: [] })).toBe('loading')
})

it('recommends a download while every model is absent', () => {
  expect(localModelsReadiness(ready([ROW, { ...ROW, modelId: 'qwen3.5-4b-q4_0' }]))).toBe('needs-recommendation')
})

it('counts a model on disk, on the way, or in use as available', () => {
  expect(localModelsReadiness(ready([ROW, { ...ROW, status: 'downloading', downloadedBytes: 1_000 }]))).toBe('has-model')
  expect(localModelsReadiness(ready([ROW, { ...ROW, status: 'ready' }]))).toBe('has-model')
  expect(localModelsReadiness(ready([ROW, { ...ROW, status: 'active' }]))).toBe('has-model')
})
