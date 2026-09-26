import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import {
  apply as storageJsonApply,
  Config as storageJsonConfig,
  inject as storageJsonInject,
  name as storageJsonName,
} from '@deepseek-ai/dsh-storage-json'
import {
  apply as storageDomainApply,
  Config as storageDomainConfig,
  inject as storageDomainInject,
  name as storageDomainName,
} from '@deepseek-ai/dsh-storage-domain'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { localModelsDomain } from '../src/state.ts'

describe('localModelsDomain', () => {
  let root: string
  let ctx: Context
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-llm-local-state-'))
    ctx = new Context()
    await ctx.plugin(Storage)
    await ctx.plugin({ name: storageJsonName, inject: storageJsonInject, apply: storageJsonApply, Config: storageJsonConfig }, { root })
    await ctx.plugin({ name: storageDomainName, inject: storageDomainInject, apply: storageDomainApply, Config: storageDomainConfig }, { backend: 'json' })
  })
  afterEach(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('starts with no model records and no active model', async () => {
    const domain = await ctx.storageDomain.open(localModelsDomain)
    expect(domain.table('models').get('qwen3.5-0.8b-q4_0')).toBeUndefined()
    expect(domain.global.get().modelId).toBeUndefined()
  })

  it('persists a status write and reads it back after reopening the domain', async () => {
    const domain = await ctx.storageDomain.open(localModelsDomain)
    await domain.table('models').put('qwen3.5-0.8b-q4_0', { modelId: 'qwen3.5-0.8b-q4_0', status: 'ready' })
    await domain.close()
    const reopened = await ctx.storageDomain.open(localModelsDomain)
    expect(reopened.table('models').get('qwen3.5-0.8b-q4_0')?.status).toBe('ready')
  })

  it('persists the active model id and reads it back after reopening the domain', async () => {
    const domain = await ctx.storageDomain.open(localModelsDomain)
    await domain.global.set({ modelId: 'qwen3.5-4b-q4_0' })
    await domain.close()
    const reopened = await ctx.storageDomain.open(localModelsDomain)
    expect(reopened.global.get().modelId).toBe('qwen3.5-4b-q4_0')
  })
})
