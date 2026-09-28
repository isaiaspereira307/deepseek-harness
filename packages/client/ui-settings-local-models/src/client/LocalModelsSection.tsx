/**
 * Local models settings section: one row per catalog model with its download
 * state and the action that state allows. A load failure keeps the section
 * frame and offers a retry; a failed action leaves the rows as they were and
 * reports the message above them. Deleting a model file asks first.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { LocalModelRow, LocalModelsController, LocalModelsState } from './store.ts'
import type { en } from './locales.ts'
import styles from './LocalModelsSection.module.css'

/** Injected dependencies of {@link LocalModelsSection} (slot `inject`). */
export interface LocalModelsSectionInjected {
  /** The section's load and mutation surface. */
  controller: LocalModelsController
  /** Section snapshot, bound by the UI renderer as `useLocalModels`. */
  hooks: { localModels: HostObservable<LocalModelsState> }
}

/** Composed local models section props. */
export type LocalModelsSectionProps =
  PropsRuntime<'settings.section'> & PropsLocale<'settings.localModels'> & InjectFace<LocalModelsSectionInjected>

/** Localized copy of this section. */
type Copy = (key: keyof typeof en) => string

/**
 * Render one row's download state from its copy dictionary.
 * @param row - the joined catalog and status row.
 * @param t - bound section copy.
 * @returns the status text.
 */
export function localModelStatusText(row: LocalModelRow, t: Copy): string {
  switch (row.status) {
    case 'not-downloaded': return t('statusNotDownloaded')
    case 'ready': return t('statusReady')
    case 'active': return t('statusActive')
    case 'downloading': {
      const percent = Math.min(100, Math.round(100 * (row.downloadedBytes ?? 0) / row.sizeBytes))
      return t('statusDownloading').replace('{percent}', String(percent))
    }
  }
}

/**
 * Render a `.gguf` size with the largest unit that keeps one decimal place.
 * @param sizeBytes - exact file size.
 * @param t - bound section copy.
 * @returns the size text, for example `2.6 GB`.
 */
export function localModelSizeText(sizeBytes: number, t: Copy): string {
  return sizeBytes >= 1_000_000_000
    ? t('sizeGb').replace('{value}', (sizeBytes / 1_000_000_000).toFixed(1))
    : t('sizeMb').replace('{value}', (sizeBytes / 1_000_000).toFixed(0))
}

/**
 * @param props - localized actions, the section store, and its subscription.
 * @returns the local models settings UI.
 */
export function LocalModelsSection({ controller, useLocalModels, t }: LocalModelsSectionProps): ReactNode {
  const state = useLocalModels(snapshot => snapshot)
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())
  const [deleting, setDeleting] = useState<LocalModelRow | undefined>(undefined)

  if (state.status === 'idle') void controller.load()

  const run = async (modelId: string, action: () => Promise<void>): Promise<void> => {
    setPending(current => new Set(current).add(modelId))
    try {
      await action()
    } finally {
      setPending((current) => {
        const next = new Set(current)
        next.delete(modelId)
        return next
      })
    }
  }

  if (state.status === 'error') {
    /* v8 ignore next 2 -- an error status always carries text; the fallback satisfies the nullable type */
    const errorText = state.error ?? ''
    return (
      <div className={styles.section}>
        <p className={styles.error} role="alert">{`${t('loadFailed')}: ${errorText}`}</p>
        <Button variant="outline" onClick={() => { void controller.load() }}>{t('retry')}</Button>
      </div>
    )
  }

  return (
    <section className={styles.section} aria-label={t('nav')}>
      <div className={styles.header}>
        <span className={styles.title}>{t('nav')}</span>
        <span className={styles.description}>{t('description')}</span>
      </div>
      {state.error !== null && <p className={styles.error} role="alert">{state.error}</p>}
      <ul className={styles.rows}>
        {state.rows.map((row) => {
          const busy = pending.has(row.modelId)
          return (
            <li key={row.modelId} className={styles.row}>
              <div className={styles.identity}>
                <span className={styles.name}>{row.displayName}</span>
                <span className={styles.meta}>
                  {`${localModelSizeText(row.sizeBytes, t)} · ${localModelStatusText(row, t)}`}
                </span>
              </div>
              <div className={styles.actions}>
                {row.status === 'not-downloaded' && <Button variant="primary" disabled={busy}
                  onClick={() => { void run(row.modelId, () => controller.download(row.modelId)) }}>
                  {t('download')}
                </Button>}
                {row.status === 'downloading' && <Button variant="outline" disabled={busy}
                  onClick={() => { void run(row.modelId, () => controller.cancel(row.modelId)) }}>
                  {t('cancel')}
                </Button>}
                {row.status === 'ready' && <>
                  <Button variant="primary" disabled={busy}
                    onClick={() => { void run(row.modelId, () => controller.activate(row.modelId)) }}>
                    {t('activate')}
                  </Button>
                  <Button variant="ghost" disabled={busy}
                    onClick={() => { setDeleting(row) }}>
                    {t('remove')}
                  </Button>
                </>}
                {row.status === 'active' && <Button variant="ghost" disabled={busy}
                  onClick={() => { setDeleting(row) }}>
                  {t('remove')}
                </Button>}
              </div>
            </li>
          )
        })}
      </ul>
      <Modal
        open={deleting !== undefined}
        onClose={() => { setDeleting(undefined) }}
        title={t('removeTitle').replace('{name}', deleting?.displayName ?? '')}
        description={t('removeBody')}
        closeLabel={t('close')}
        footer={deleting === undefined ? null : <>
          <Button variant="outline" onClick={() => { setDeleting(undefined) }}>{t('removeCancel')}</Button>
          <Button variant="primary" onClick={() => {
            const target = deleting
            setDeleting(undefined)
            void run(target.modelId, () => controller.remove(target.modelId))
          }}>
            {t('removeConfirm')}
          </Button>
        </>}
      />
    </section>
  )
}
