/** Injected dependencies shared by the local models section and first-run step. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { LocalModelsController, LocalModelsState } from './store.ts'

/** What every entry of this plugin receives from `apply` (slot `inject`). */
export interface LocalModelsInjected {
  /** The load and mutation surface the section and the step both drive. */
  controller: LocalModelsController
  /** Section snapshot, bound by the UI renderer as `useLocalModels`. */
  hooks: { localModels: SnapshotStore<LocalModelsState> }
}
