import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

const modelRecordSchema = z.object({
  modelId: z.string(),
  status: z.union([z.literal('downloading'), z.literal('ready')]),
  downloadedBytes: z.number().optional(),
})

const activeRecordSchema = z.object({
  modelId: z.string().optional(),
})

/** Durable record for one catalog entry that started downloading. */
export type ModelRecord = z.infer<typeof modelRecordSchema>
/** Durable record naming the active model, or none when the host has no local model active. */
export type ActiveModelRecord = z.infer<typeof activeRecordSchema>

/**
 * Downloaded-model state. `models` holds one record per catalog entry that
 * ever started downloading (the download's authoritative status); `global`
 * names the currently active model id. Records survive restarts, so a
 * ready model is never re-derived by scanning `modelsDir`.
 */
export const localModelsDomain = defineDomain({
  name: 'llm_local_models',
  version: 0,
  global: { schema: activeRecordSchema, initial: { modelId: undefined } },
  tables: { models: domainTable<string, ModelRecord>(modelRecordSchema) },
})
