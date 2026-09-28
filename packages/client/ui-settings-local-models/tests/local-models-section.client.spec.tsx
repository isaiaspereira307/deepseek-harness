// @vitest-environment jsdom
/** Presentation of the local models section: statuses, actions, and failure surfaces. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { act } from 'react'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { LocalModelsSection, localModelSizeText, localModelStatusText } from '../src/client/LocalModelsSection.tsx'
import type { LocalModelsController, LocalModelRow, LocalModelsState } from '../src/client/store.ts'
import { en, zh, type LocalModelsKey } from '../src/client/locales.ts'
import type {} from '../src/client/index.ts'

afterEach(() => { cleanup() })

const SMALL: LocalModelRow = { modelId: 'qwen3.5-0.8b-q4_0', displayName: 'Qwen3.5 0.8B', sizeBytes: 507_154_688, status: 'not-downloaded' }

/** A controller whose writes resolve, so the spec exercises presentation only. */
function controller(): LocalModelsController {
  return {
    load: vi.fn(async () => {}),
    download: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    activate: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  }
}

/** The translate a locale-registered section receives: its own keys from the dictionary, common keys passed through. */
function translate(copy: Record<LocalModelsKey, string>) {
  return (key: string): string => (key in copy ? copy[key as LocalModelsKey] : key)
}

/** The section's own state source, so a spec can publish snapshots. */
function source(state: LocalModelsState): SnapshotStore<LocalModelsState> {
  return createSnapshotStore<LocalModelsState>(state)
}

const ready = (rows: readonly LocalModelRow[]): LocalModelsState => ({ status: 'ready', error: null, rows })
// The slot supplies the global seat in the application.
const globals = {} as GlobalStandardProps

it.each([en, zh])('renders every row state with its size and the allowed action', (copy) => {
  const store = source(ready([
    SMALL,
    { ...SMALL, status: 'downloading', downloadedBytes: 253_577_344 },
    { ...SMALL, status: 'ready' },
    { ...SMALL, status: 'active' },
  ]))
  render(<LocalModelsSection {...globals} controller={controller()}
    useLocalModels={selector => selector(store.getSnapshot())} t={translate(copy)} />)
  expect(screen.getByText(copy.nav)).toBeDefined()
  expect(screen.getByText(copy.description)).toBeDefined()
  expect(screen.getAllByText(SMALL.displayName)).toHaveLength(4)
  const size = copy.sizeMb.replace('{value}', '507')
  expect(screen.getByText(`${size} · ${copy.statusNotDownloaded}`)).toBeDefined()
  expect(screen.getByText(`${size} · ${copy.statusDownloading.replace('{percent}', '50')}`)).toBeDefined()
  expect(screen.getByText(`${size} · ${copy.statusReady}`)).toBeDefined()
  expect(screen.getByText(`${size} · ${copy.statusActive}`)).toBeDefined()
  expect(screen.getAllByRole('button', { name: copy.download })).toHaveLength(1)
  expect(screen.getByRole('button', { name: copy.cancel })).toBeDefined()
  expect(screen.getByRole('button', { name: copy.activate })).toBeDefined()
  expect(screen.getAllByRole('button', { name: copy.remove })).toHaveLength(2)
})

it('formats sizes and progress text from the row and the dictionary', () => {
  const t = (key: keyof typeof en): string => en[key]
  expect(localModelSizeText(2_583_221_408, t)).toBe('2.6 GB')
  expect(localModelSizeText(507_154_688, t)).toBe('507 MB')
  expect(localModelStatusText({ ...SMALL, status: 'not-downloaded' }, t)).toBe('Not downloaded')
  expect(localModelStatusText({ ...SMALL, status: 'downloading', downloadedBytes: 507_154_688 }, t)).toBe('Downloading 100%')
  expect(localModelStatusText({ ...SMALL, status: 'downloading' }, t)).toBe('Downloading 0%')
})

it('starts the first load when the section mounts', () => {
  const bound = controller()
  const store = source({ status: 'idle', error: null, rows: [] })
  render(<LocalModelsSection {...globals} controller={bound}
    useLocalModels={selector => selector(store.getSnapshot())} t={translate(en)} />)
  expect(bound.load).toHaveBeenCalled()
})

it('invokes the row action the state allows', () => {
  const bound = controller()
  const store = source(ready([
    { ...SMALL, status: 'not-downloaded' },
    { ...SMALL, modelId: 'qwen3.5-4b-q4_0', status: 'downloading', downloadedBytes: 1_000 },
  ]))
  render(<LocalModelsSection {...globals} controller={bound}
    useLocalModels={selector => selector(store.getSnapshot())} t={translate(en)} />)
  act(() => { screen.getByRole('button', { name: en.download }).click() })
  expect(bound.download).toHaveBeenCalledWith(SMALL.modelId)
  act(() => { screen.getByRole('button', { name: en.cancel }).click() })
  expect(bound.cancel).toHaveBeenCalledWith('qwen3.5-4b-q4_0')
})

it('activates a downloaded model', () => {
  const bound = controller()
  const store = source(ready([{ ...SMALL, status: 'ready' }]))
  render(<LocalModelsSection {...globals} controller={bound}
    useLocalModels={selector => selector(store.getSnapshot())} t={translate(en)} />)
  act(() => { screen.getByRole('button', { name: en.activate }).click() })
  expect(bound.activate).toHaveBeenCalledWith(SMALL.modelId)
})

it('reports a failed action above the rows it kept', () => {
  const store = source({ status: 'ready', error: 'download rejected', rows: [SMALL] })
  render(<LocalModelsSection {...globals} controller={controller()}
    useLocalModels={selector => selector(store.getSnapshot())} t={translate(en)} />)
  expect(screen.getByRole('alert').textContent).toBe('download rejected')
  expect(screen.getByText(SMALL.displayName)).toBeDefined()
})

it('offers a retry instead of rows when the load failed', () => {
  const bound = controller()
  const store = source({ status: 'error', error: 'catalog offline', rows: [] })
  render(<LocalModelsSection {...globals} controller={bound}
    useLocalModels={selector => selector(store.getSnapshot())} t={translate(en)} />)
  expect(screen.getByRole('alert').textContent).toBe('Could not load local models: catalog offline')
  act(() => { screen.getByRole('button', { name: en.retry }).click() })
  expect(bound.load).toHaveBeenCalled()
})

it('confirms a deletion before it reaches the Host', () => {
  const bound = controller()
  const store = source(ready([{ ...SMALL, status: 'ready' }]))
  render(<LocalModelsSection {...globals} controller={bound}
    useLocalModels={selector => selector(store.getSnapshot())} t={translate(en)} />)
  act(() => { screen.getByRole('button', { name: en.remove }).click() })
  expect(screen.getByRole('dialog').textContent).toContain('Delete Qwen3.5 0.8B?')
  act(() => { screen.getByRole('button', { name: en.removeCancel }).click() })
  expect(bound.remove).not.toHaveBeenCalled()
  act(() => { screen.getByRole('button', { name: en.remove }).click() })
  const confirm = screen.getAllByRole('button', { name: en.removeConfirm }).at(-1)!
  act(() => { confirm.click() })
  expect(bound.remove).toHaveBeenCalledWith(SMALL.modelId)
})

it('removes the active model through the same confirmation', () => {
  const bound = controller()
  const store = source(ready([{ ...SMALL, status: 'active' }]))
  render(<LocalModelsSection {...globals} controller={bound}
    useLocalModels={selector => selector(store.getSnapshot())} t={translate(en)} />)
  act(() => { screen.getByRole('button', { name: en.remove }).click() })
  expect(screen.getByRole('dialog').textContent).toContain('Delete Qwen3.5 0.8B?')
  act(() => { screen.getByRole('button', { name: en.close }).click() })
  expect(screen.queryByRole('dialog')).toBeNull()
  act(() => { screen.getByRole('button', { name: en.remove }).click() })
  const confirm = screen.getAllByRole('button', { name: en.removeConfirm }).at(-1)!
  act(() => { confirm.click() })
  expect(bound.remove).toHaveBeenCalledWith(SMALL.modelId)
})

it('disables a row action while its own write is in flight', async () => {
  let settle: (() => void) | undefined
  const bound = controller()
  bound.cancel = vi.fn(() => new Promise<void>((resolve) => { settle = resolve }))
  const store = source(ready([{ ...SMALL, status: 'downloading', downloadedBytes: 1_000 }]))
  render(<LocalModelsSection {...globals} controller={bound}
    useLocalModels={selector => selector(store.getSnapshot())} t={translate(en)} />)
  const cancel = screen.getByRole('button', { name: en.cancel }) as HTMLButtonElement
  act(() => { cancel.click() })
  expect(cancel.disabled).toBe(true)
  await act(async () => { settle?.() })
  expect(cancel.disabled).toBe(false)
})
