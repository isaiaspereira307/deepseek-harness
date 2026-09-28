/**
 * First-run local models step: offers the Host's recommended model to an
 * installation that has none on disk. The step owns the onboarding queue while
 * it shows, and completes itself on every outcome it cannot offer, so first run
 * never stalls on it. Accepting the offer starts the download and completes at
 * once; the section reports that download's progress and failure.
 */

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import type { ModelCatalogEntry } from '@deepseek-ai/dsh-llm-local/types'
import { Button, OnboardingModal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { localModelsReadiness } from './store.ts'
import type { LocalModelsState } from './store.ts'
import type { LocalModelsInjected } from './faces.ts'
import { localModelSizeText } from './LocalModelsSection.tsx'
import styles from './LocalModelsOnboarding.module.css'

/** Composed first-run local models step props. */
export type LocalModelsOnboardingProps =
  PropsRuntime<'settings.onboarding'> & PropsLocale<'settings.localModels'> & InjectFace<LocalModelsInjected>

/**
 * What the step does with the current snapshot. `wait` holds the queue while
 * the Host answers, `complete` ends the step because it has nothing to offer,
 * and the last two carry the model the step is talking about.
 */
export type LocalModelsStepDecision =
  | { kind: 'wait' | 'complete' }
  | { kind: 'offer'; model: ModelCatalogEntry }
  | { kind: 'explain'; floor: ModelCatalogEntry }

/**
 * Decide the step's next move from the section snapshot.
 * @param state - the current section snapshot.
 * @returns the decision, with the model to offer or the floor to name.
 */
export function localModelsStepDecision(state: LocalModelsState): LocalModelsStepDecision {
  const readiness = localModelsReadiness(state)
  if (readiness === 'loading') return { kind: 'wait' }
  if (readiness === 'unavailable' || readiness === 'has-model') return { kind: 'complete' }
  const recommendation = state.recommendation
  if (recommendation === null) return { kind: 'complete' }
  return recommendation.kind === 'insufficient-ram'
    ? { kind: 'explain', floor: recommendation.floor }
    : { kind: 'offer', model: recommendation.entry }
}

/**
 * @param props - the shell's owner state, the section store, and its copy.
 * @returns the first-run offer, the memory explanation, or null.
 */
export function LocalModelsOnboarding({ complete, controller, useLocalModels, t }: LocalModelsOnboardingProps): ReactNode {
  const state = useLocalModels(snapshot => snapshot)
  const decision = localModelsStepDecision(state)

  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  useEffect(() => {
    if (decision.kind === 'complete') complete()
  }, [complete, decision.kind])

  switch (decision.kind) {
    case 'wait':
    case 'complete':
      return null
    case 'offer':
      return (
        <OnboardingModal title={t('firstRunTitle')}>
          <p className={styles.body}>
            {t('firstRunBody')
              .replace('{name}', decision.model.displayName)
              .replace('{size}', localModelSizeText(decision.model.sizeBytes, t))}
          </p>
          <div className={styles.actions}>
            <Button variant="ghost" onClick={() => { complete() }}>{t('firstRunLater')}</Button>
            <Button variant="primary" onClick={() => {
              void controller.download(decision.model.id)
              complete()
            }}>
              {t('download')}
            </Button>
          </div>
        </OnboardingModal>
      )
    case 'explain':
      return (
        <OnboardingModal title={t('firstRunMemoryTitle')}>
          <p className={styles.body}>
            {t('firstRunMemoryBody').replace('{size}', localModelSizeText(decision.floor.minRamBytes, t))}
          </p>
          <div className={styles.actions}>
            <Button variant="primary" onClick={() => { complete() }}>{t('firstRunContinue')}</Button>
          </div>
        </OnboardingModal>
      )
  }
}
