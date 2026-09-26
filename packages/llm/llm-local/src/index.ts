/**
 * Local, no-cloud LLM provider: downloads cataloged Qwen3.5 GGUF weights into
 * `modelsDir`, recommends the largest variant the machine's RAM supports, and
 * streams CPU-only `node-llama-cpp` inference over the fixed `local` provider
 * route. See the package README for the download contract and model effects.
 * @module @deepseek-ai/dsh-llm-local
 */
export {
  LocalModels,
  LocalModelsConfigSchema,
} from './service.ts'
export type { DownloadFn, LocalModelsConfig } from './service.ts'
export { CATALOG, catalogEntry } from './catalog.ts'
export { recommendModel } from './recommend.ts'
export type { Recommendation } from './recommend.ts'
export type { ModelCatalogEntry } from './types.ts'

export { LocalModels as default } from './service.ts'
