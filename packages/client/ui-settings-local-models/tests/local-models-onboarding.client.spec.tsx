// @vitest-environment jsdom
/** First-run local models step: what it offers, what it completes, and how it leaves. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ModelCatalogEntry, Recommendation } from '@deepseek-ai/dsh-llm-local/types'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { LocalModelsOnboarding } from '../src/client/LocalModelsOnboarding.tsx'
import type { LocalModelsController, LocalModelsState } from '../src/client/store.ts'
import { en, zh, type LocalModelsKey } from '../src/client/locales.ts'
import type {} from '../src/client/index.ts'

afterEach(() => { cleanup() })

const LARGE: ModelCatalogEntry = {
  id: 'qwen3.5-4b-q4_0',
  displayName: 'Qwen3.5 4B',
  huggingFaceUrl: 'https://huggingface.co/qwen3.5-4b-q4_0.gguf',
  sizeBytes: 2_583_221_408,
  sha256: 'b'.repeat(64),
  minRamBytes: 6_000_000_000,
}

/** A controller whose reads resolve, so the spec drives the snapshot instead. */
function controller(): LocalModelsController {
  return {
    load: vi.fn(async () => {}),
    download: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    activate: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  }
}

const translate = (copy: Record<LocalModelsKey, string>) =>
  (key: string): string => (key in copy ? copy[key as LocalModelsKey] : key)

/** A snapshot with no model on disk and the supplied Host recommendation. */
function waiting(recommendation: Recommendation | null): SnapshotStore<LocalModelsState> {
  return createSnapshotStore<LocalModelsState>({
    status: 'ready', error: null, rows: [], recommendation,
  })
}

const offer = waiting({ kind: 'recommend', entry: LARGE })
const globals = {} as GlobalStandardProps

function step(store: SnapshotStore<LocalModelsState>, complete: () => void, ctl = controller()) {
  return {
    ctl,
    view: render(<LocalModelsOnboarding {...globals} complete={complete} controller={ctl}
      useLocalModels={selector => selector(store.getSnapshot())} t={translate(en)} />),
  }
}

it.each([en, zh])('offers the recommended model with its size, in the active language', (copy) => {
  const complete = vi.fn()
  render(<LocalModelsOnboarding {...globals} complete={complete} controller={controller()}
    useLocalModels={selector => selector(offer.getSnapshot())} t={translate(copy)} />)
  expect(screen.getByRole('dialog', { name: copy.firstRunTitle })).toBeDefined()
  const body = copy.firstRunBody.replace('{name}', LARGE.displayName).replace('{size}', copy.sizeGb.replace('{value}', '2.6'))
  expect(screen.getByText(body)).toBeDefined()
  expect(screen.getByRole('button', { name: copy.download })).toBeDefined()
  expect(screen.getByRole('button', { name: copy.firstRunLater })).toBeDefined()
  expect(complete).not.toHaveBeenCalled()
})

it('starts the download of the recommended model and completes at once', () => {
  const complete = vi.fn()
  const { ctl, view } = step(offer, complete)
  view.getByRole('button', { name: en.download }).click()
  expect(ctl.download).toHaveBeenCalledWith(LARGE.id)
  expect(complete).toHaveBeenCalledTimes(1)
})

it('completes without a download when the user declines', () => {
  const complete = vi.fn()
  const { ctl, view } = step(offer, complete)
  view.getByRole('button', { name: en.firstRunLater }).click()
  expect(ctl.download).not.toHaveBeenCalled()
  expect(complete).toHaveBeenCalledTimes(1)
})

it('names the smallest model it offers when the device is short on memory', () => {
  const complete = vi.fn()
  step(waiting({ kind: 'insufficient-ram', floor: { ...LARGE, minRamBytes: 2_000_000_000, sizeBytes: 507_154_688 } }), complete)
  expect(screen.getByRole('dialog', { name: en.firstRunMemoryTitle })).toBeDefined()
  const body = en.firstRunMemoryBody.replace('{size}', en.sizeGb.replace('{value}', '2.0'))
  expect(screen.getByText(body)).toBeDefined()
  expect(screen.queryByRole('button', { name: en.download })).toBeNull()
  // The step holds the queue until the user reads it.
  expect(complete).not.toHaveBeenCalled()
  screen.getByRole('button', { name: en.firstRunContinue }).click()
  expect(complete).toHaveBeenCalledTimes(1)
})

it('completes itself once a model is on disk', () => {
  const complete = vi.fn()
  const withModel = createSnapshotStore<LocalModelsState>({
    status: 'ready',
    error: null,
    rows: [{ modelId: LARGE.id, displayName: LARGE.displayName, sizeBytes: LARGE.sizeBytes, status: 'ready' }],
    recommendation: { kind: 'recommend', entry: LARGE },
  })
  const { view } = step(withModel, complete)
  expect(view.container.innerHTML).toBe('')
  expect(complete).toHaveBeenCalledTimes(1)
})

it('completes itself when the Host cannot answer, rather than holding the queue', () => {
  const complete = vi.fn()
  const offline = createSnapshotStore<LocalModelsState>({ status: 'error', error: 'catalog offline', rows: [], recommendation: null })
  const { view } = step(offline, complete)
  expect(view.container.innerHTML).toBe('')
  expect(complete).toHaveBeenCalledTimes(1)
})

it('waits for the first load and shows nothing until the Host answers', () => {
  const complete = vi.fn()
  const idle = createSnapshotStore<LocalModelsState>({ status: 'idle', error: null, rows: [], recommendation: null })
  const ctl = controller()
  const { view } = step(idle, complete, ctl)
  expect(ctl.load).toHaveBeenCalledTimes(1)
  expect(view.container.innerHTML).toBe('')
  expect(complete).not.toHaveBeenCalled()
})
