// @vitest-environment jsdom
/** The local models section and first-run step in the shipped client composition. */
import { afterEach, expect, vi } from 'vitest'
import { ok, type RemoteMock } from '@deepseek-ai/dsh-remote-mock'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { createClientTest, webApp, type TestClient } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import type { ModelCatalogEntry, ModelStatusEntry, Recommendation } from '@deepseek-ai/dsh-llm-local/types'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { LocalModelsInjected } from '../src/client/faces.ts'
import type {} from '../src/client/index.ts'

const it = createClientTest({ roster: webApp })
const SELF = '@deepseek-ai/dsh-client-ui-settings-local-models'
const SMALL: ModelCatalogEntry = {
  id: 'qwen3.5-0.8b-q4_0',
  displayName: 'Qwen3.5 0.8B',
  huggingFaceUrl: 'https://huggingface.co/api/models/qwen/resolve/main/qwen3.5-0.8b-q4_0.gguf',
  sizeBytes: 507_154_688,
  sha256: 'a'.repeat(64),
  minRamBytes: 2_000_000_000,
}
const LARGE: ModelCatalogEntry = { ...SMALL, id: 'qwen3.5-4b-q4_0', displayName: 'Qwen3.5 4B', sizeBytes: 2_583_221_408 }
const CATALOG: readonly ModelCatalogEntry[] = [SMALL, LARGE]
const RECOMMEND_LARGE: Recommendation = { kind: 'recommend', entry: LARGE }
const NONE: readonly ModelStatusEntry[] = [
  { modelId: SMALL.id, status: 'not-downloaded', active: false },
  { modelId: LARGE.id, status: 'not-downloaded', active: false },
]
const DOWNLOADING: readonly ModelStatusEntry[] = [
  { modelId: SMALL.id, status: 'downloading', downloadedBytes: 253_577_344, active: false },
  { modelId: LARGE.id, status: 'not-downloaded', active: false },
]
const READY_ACTIVE: readonly ModelStatusEntry[] = [
  { modelId: SMALL.id, status: 'downloading', downloadedBytes: 253_577_344, active: false },
  { modelId: LARGE.id, status: 'ready', downloadedBytes: LARGE.sizeBytes, active: true },
]

afterEach(() => { vi.useRealTimers() })

/** The registered section's injected face. */
function injected(c: TestClient): LocalModelsInjected {
  const entry = c.ctx.slots.entries('settings.section').find(candidate => candidate.options.id === 'local-models')
  const face: object = entry?.inject?.() ?? {}
  return face as LocalModelsInjected
}

/** Answer the three Host reads the store joins, so no request goes unmatched. */
function mockFacts(mock: RemoteMock, status: readonly ModelStatusEntry[]): void {
  mock.remote.llmLocal.listCatalog.mockResolvedValue(ok(CATALOG))
  mock.remote.llmLocal.listStatus.mockResolvedValue(ok(status))
  mock.remote.llmLocal.recommendedModel.mockResolvedValue(ok(RECOMMEND_LARGE))
}

it('registers the section and joins the catalog with per-model status', async ({ start, mock }) => {
  const c = await start()
  mockFacts(mock, READY_ACTIVE)
  const entry = c.ctx.slots.entries('settings.section').find(candidate => candidate.options.id === 'local-models')!
  expect(resolveSlotLabel(entry.options.label)).toBe('Local models')
  const face = injected(c)
  await face.controller.load()
  expect(face.hooks.localModels.getSnapshot()).toMatchObject({
    status: 'ready',
    recommendation: RECOMMEND_LARGE,
    rows: [
      { modelId: SMALL.id, displayName: SMALL.displayName, sizeBytes: SMALL.sizeBytes, status: 'downloading', downloadedBytes: 253_577_344 },
      { modelId: LARGE.id, displayName: LARGE.displayName, sizeBytes: LARGE.sizeBytes, status: 'active', downloadedBytes: LARGE.sizeBytes },
    ],
  })
}, 60_000)

it('registers the first-run step in the onboarding queue after the credential step', async ({ start, mock }) => {
  const c = await start()
  mockFacts(mock, NONE)
  const steps = c.ctx.slots.entries('settings.onboarding')
    .map(entry => ({ id: entry.options.id, order: entry.options.order ?? 0 }))
    .sort((a, b) => a.order - b.order)
  expect(steps.map(step => step.id)).toContain('local-models')
  const mine = steps.find(step => step.id === 'local-models')!
  expect(steps.filter(step => step.order < mine.order).map(step => step.id)).toEqual(['welcome-notice', 'deepseek-official'])
}, 60_000)

it('marks a catalog entry the status list omits as not downloaded', async ({ start, mock }) => {
  const c = await start()
  mockFacts(mock, [READY_ACTIVE[1]!])
  const face = injected(c)
  await face.controller.load()
  expect(face.hooks.localModels.getSnapshot().rows).toMatchObject([
    { modelId: SMALL.id, status: 'not-downloaded' },
    { modelId: LARGE.id, status: 'active' },
  ])
}, 60_000)

it('downloads, cancels, activates, and deletes through the Host Remote', async ({ start, mock }) => {
  const c = await start()
  mockFacts(mock, NONE)
  for (const method of ['startDownload', 'cancelDownload', 'setActive', 'deleteModel'] as const) {
    mock.remote.llmLocal[method].mockResolvedValue(ok(undefined))
  }
  const face = injected(c)
  await face.controller.load()
  await face.controller.download(SMALL.id)
  expect(mock.remote.llmLocal.startDownload).toHaveBeenCalledWith(SMALL.id)
  await face.controller.cancel(SMALL.id)
  expect(mock.remote.llmLocal.cancelDownload).toHaveBeenCalledWith(SMALL.id)
  await face.controller.activate(SMALL.id)
  expect(mock.remote.llmLocal.setActive).toHaveBeenCalledWith(SMALL.id)
  await face.controller.remove(LARGE.id)
  expect(mock.remote.llmLocal.deleteModel).toHaveBeenCalledWith(LARGE.id)
}, 60_000)

it('keeps the rows and reports a rejected download', async ({ start, mock }) => {
  const c = await start()
  mockFacts(mock, NONE)
  mock.remote.llmLocal.startDownload.mockResolvedValue({ ok: false, error: new RemoteError('gateway/internal', 'download rejected', {}) })
  const face = injected(c)
  await face.controller.load()
  await face.controller.download(SMALL.id)
  const snapshot = face.hooks.localModels.getSnapshot()
  expect(snapshot.error).toBe('download rejected')
  expect(snapshot.rows).toHaveLength(2)
}, 60_000)

it('reports a rejected cancel, activation, and deletion on the snapshot', async ({ start, mock }) => {
  const c = await start()
  mockFacts(mock, NONE)
  const failure = { ok: false as const, error: new RemoteError('gateway/internal', 'write refused', {}) }
  for (const method of ['cancelDownload', 'setActive', 'deleteModel'] as const) {
    mock.remote.llmLocal[method].mockResolvedValue(failure)
  }
  const face = injected(c)
  await face.controller.load()
  await face.controller.cancel(SMALL.id)
  await face.controller.activate(SMALL.id)
  await face.controller.remove(SMALL.id)
  expect(face.hooks.localModels.getSnapshot().error).toBe('write refused')
}, 60_000)

it('surfaces a failed catalog read and retries on demand', async ({ start, mock }) => {
  const c = await start()
  mockFacts(mock, NONE)
  mock.remote.llmLocal.listCatalog.mockResolvedValue({ ok: false, error: new RemoteError('gateway/internal', 'catalog offline', {}) })
  const face = injected(c)
  await face.controller.load()
  expect(face.hooks.localModels.getSnapshot()).toMatchObject({ status: 'error', error: 'catalog offline' })
  mock.remote.llmLocal.listCatalog.mockResolvedValue(ok(CATALOG))
  await face.controller.load()
  expect(face.hooks.localModels.getSnapshot().status).toBe('ready')
}, 60_000)

it('surfaces a failed status read after the catalog answered', async ({ start, mock }) => {
  const c = await start()
  mockFacts(mock, NONE)
  mock.remote.llmLocal.listStatus.mockResolvedValue({ ok: false, error: new RemoteError('gateway/internal', 'status offline', {}) })
  const face = injected(c)
  await face.controller.load()
  expect(face.hooks.localModels.getSnapshot()).toMatchObject({ status: 'error', error: 'status offline' })
}, 60_000)

it('surfaces a failed recommendation read after the lists answered', async ({ start, mock }) => {
  const c = await start()
  mockFacts(mock, NONE)
  mock.remote.llmLocal.recommendedModel.mockResolvedValue({ ok: false, error: new RemoteError('gateway/internal', 'recommendation offline', {}) })
  const face = injected(c)
  await face.controller.load()
  expect(face.hooks.localModels.getSnapshot()).toMatchObject({ status: 'error', error: 'recommendation offline' })
}, 60_000)

it('shares one request between concurrent loads', async ({ start, mock }) => {
  const c = await start()
  mockFacts(mock, NONE)
  const face = injected(c)
  await Promise.all([face.controller.load(), face.controller.load()])
  expect(mock.remote.llmLocal.listCatalog).toHaveBeenCalledTimes(1)
}, 60_000)

it('polls progress while a row downloads, settles, and drops the poll on reload', async ({ start, mock }) => {
  vi.useFakeTimers()
  const c = await start()
  mockFacts(mock, DOWNLOADING)
  const face = injected(c)
  await face.controller.load()
  const polled = mock.remote.llmLocal.listStatus.mock.calls.length
  await vi.advanceTimersByTimeAsync(1000)
  expect(mock.remote.llmLocal.listStatus.mock.calls.length).toBeGreaterThan(polled)
  mock.remote.llmLocal.listStatus.mockResolvedValue(ok(NONE))
  await face.controller.load()
  const settled = mock.remote.llmLocal.listStatus.mock.calls.length
  await vi.advanceTimersByTimeAsync(3000)
  expect(mock.remote.llmLocal.listStatus.mock.calls.length).toBe(settled)
  // The poll is an effect disposer: a plugin reload must not leave it running.
  mock.remote.llmLocal.listStatus.mockResolvedValue(ok(DOWNLOADING))
  await injected(c).controller.load()
  expect(vi.getTimerCount()).toBe(1)
  await c.reload(SELF)
  expect(vi.getTimerCount()).toBe(0)
}, 60_000)
