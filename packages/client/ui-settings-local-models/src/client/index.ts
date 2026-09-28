/**
 * Local models settings and first-run recommendation plugin, browser half.
 * The section reads the Host `llmLocal` Remote for the catalog and every
 * download action; the snapshot is shared with the first-run step that
 * `settings.onboarding` mounts.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the UI renderer's hook bindings (the `hooks` compartment).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ctx.remote merge and the `llmLocal` namespace types.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { LocalModelsOnboarding } from './LocalModelsOnboarding.tsx'
import { LocalModelsSection } from './LocalModelsSection.tsx'
import type { LocalModelsInjected } from './faces.ts'
import { LocalModelsStore } from './store.ts'
import { en, zh, type LocalModelsKey } from './locales.ts'

export type { LocalModelsInjected } from './faces.ts'
export type { LocalModelsOnboardingProps } from './LocalModelsOnboarding.tsx'
export type { LocalModelsSectionProps } from './LocalModelsSection.tsx'
export type { LocalModelRow, LocalModelsController, LocalModelsReadiness, LocalModelsState } from './store.ts'
export type { LocalModelsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The local models settings page and its first-run step. */
    'settings.localModels': LocalModelsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.localModels'

/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings' apply, whose activation order relative to this one is not
 * constrained; registration depends on the slot through `slots.inject()`.
 */
export const inject = ['slots', 'locale', 'remote', 'remote.llmLocal']

/**
 * Register the Local models settings section and the first-run step once their
 * slot declarations are on the ledger, and own the store's poll for as long as
 * the plugin lives. Both entries share one store, so the section already holds
 * the facts the step reads when the shell mounts it.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'ui-settings-local-models: copy dictionaries')
  // Bound once here, where the Remote namespace is declared in this plugin's
  // own `inject`; the section receives callbacks and a store, never a context.
  const t = ctx.locale.bind(NS)
  const controller = new LocalModelsStore(ctx)
  const injected = (): LocalModelsInjected => ({
    controller,
    hooks: { localModels: controller.store },
  })
  ctx.effect(() => () => { controller.dispose() }, 'ui-settings-local-models: progress poll')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'local-models',
    order: 20,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, LocalModelsSection))
  // The step runs after the official DeepSeek credential step (order 0), so a
  // first-run user meets the API key offer before the local alternative.
  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding',
    id: 'local-models',
    order: 10,
    locale: NS,
    inject: injected,
  }, LocalModelsOnboarding))
}
