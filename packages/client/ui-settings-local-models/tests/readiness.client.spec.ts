/** The two projections the first-run step reads, one case per state. */
import { expect, it } from 'vitest'
import type { ModelCatalogEntry, Recommendation } from '@deepseek-ai/dsh-llm-local/types'
import { localModelsReadiness } from '../src/client/store.ts'
import { localModelsStepDecision } from '../src/client/LocalModelsOnboarding.tsx'
import type { LocalModelRow, LocalModelsState } from '../src/client/store.ts'

const ROW: LocalModelRow = { modelId: 'qwen3.5-0.8b-q4_0', displayName: 'Qwen3.5 0.8B', sizeBytes: 507_154_688, status: 'not-downloaded' }
const ENTRY: ModelCatalogEntry = {
  id: ROW.modelId,
  displayName: ROW.displayName,
  huggingFaceUrl: 'https://huggingface.co/qwen3.5-0.8b-q4_0.gguf',
  sizeBytes: ROW.sizeBytes,
  sha256: 'a'.repeat(64),
  minRamBytes: 2_000_000_000,
}
const ready = (rows: readonly LocalModelRow[]): LocalModelsState => ({
  status: 'ready', error: null, rows, recommendation: { kind: 'recommend', entry: ENTRY } satisfies Recommendation,
})

it('reports loading until the first rows land', () => {
  expect(localModelsReadiness({ status: 'idle', error: null, rows: [], recommendation: null })).toBe('loading')
})

it('reports a failed load as unavailable rather than waiting for rows', () => {
  expect(localModelsReadiness({ status: 'error', error: 'catalog offline', rows: [], recommendation: null })).toBe('unavailable')
})

it('recommends a download while every model is absent', () => {
  expect(localModelsReadiness(ready([ROW, { ...ROW, modelId: 'qwen3.5-4b-q4_0' }]))).toBe('needs-recommendation')
})

it('counts a model on disk, on the way, or in use as available', () => {
  expect(localModelsReadiness(ready([ROW, { ...ROW, status: 'downloading', downloadedBytes: 1_000 }]))).toBe('has-model')
  expect(localModelsReadiness(ready([ROW, { ...ROW, status: 'ready' }]))).toBe('has-model')
  expect(localModelsReadiness(ready([ROW, { ...ROW, status: 'active' }]))).toBe('has-model')
})

it('decides the step next move from the same states', () => {
  const noModels = ready([ROW])
  expect(localModelsStepDecision({ status: 'idle', error: null, rows: [], recommendation: null })).toEqual({ kind: 'wait' })
  expect(localModelsStepDecision({ status: 'error', error: 'catalog offline', rows: [], recommendation: null })).toEqual({ kind: 'complete' })
  expect(localModelsStepDecision({ ...noModels, rows: [{ ...ROW, status: 'ready' }] })).toEqual({ kind: 'complete' })
  // A ready snapshot with no recommendation cannot be produced by the store; a
  // step that meets one has nothing to offer and must not hold the queue.
  expect(localModelsStepDecision({ ...noModels, recommendation: null })).toEqual({ kind: 'complete' })
  expect(localModelsStepDecision(noModels)).toEqual({ kind: 'offer', model: ENTRY })
  expect(localModelsStepDecision({ ...noModels, recommendation: { kind: 'insufficient-ram', floor: ENTRY } }))
    .toEqual({ kind: 'explain', floor: ENTRY })
})
