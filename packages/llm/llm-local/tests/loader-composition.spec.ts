/** REAL composition: the shipped llm-local plugin boots through the Loader and serves its remote surface. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader, { type ModuleLoaderV2 } from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { mountRootInclude } from '@deepseek-ai/dsh-app-boot'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as LlmLocal from '@deepseek-ai/dsh-llm-local'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('llm-local loader composition', () => {
  it('boots with the local route registered and the remote catalog reachable', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-llm-local-composition-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      '- id: storage',
      "  name: '@deepseek-ai/dsh-storage'",
      '- id: storage-json',
      "  name: '@deepseek-ai/dsh-storage-json'",
      '  config:',
      `    root: ${JSON.stringify(join(root, 'storage'))}`,
      '- id: storage-domain',
      "  name: '@deepseek-ai/dsh-storage-domain'",
      '  config:',
      '    backend: json',
      '- id: llm',
      "  name: '@deepseek-ai/dsh-llm'",
      '- id: llm-local',
      "  name: '@deepseek-ai/dsh-llm-local'",
      '  config:',
      `    modelsDir: ${JSON.stringify(join(root, 'models'))}`,
      '    ramSafetyMarginBytes: 2147483648',
      '    contextSize: 8192',
      '',
    ].join('\n'))

    const ctx = new Context()
    context = ctx
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-storage', Storage],
      ['@deepseek-ai/dsh-storage-json', StorageJson],
      ['@deepseek-ai/dsh-storage-domain', StorageDomain],
      ['@deepseek-ai/dsh-llm', LlmRuntime],
      ['@deepseek-ai/dsh-llm-local', LlmLocal],
    ])
    const internal: ModuleLoaderV2 = {
      version: 'v2',
      loadCache: new Map(),
      import: (specifier: string) => {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return Promise.resolve(modules.get(specifier))
      },
      register(): never { throw new Error('unexpected module hook registration') },
      getOrCreateModuleJob(): never { throw new Error('unexpected module job creation') },
      resolveSync(): never { throw new Error('unexpected synchronous module resolution') },
      load(): never { throw new Error('unexpected module load') },
    }
    ctx.loader.internal = internal
    await mountRootInclude(ctx, configPath, [])
    await ctx.loader.await()

    expect(ctx.llm.listProviders().map(provider => provider.id)).toContain('local')
    expect(ctx.llmLocal.listCatalog()).toHaveLength(2)
    expect(ctx.llmLocal.getActive()).toBeUndefined()
    const modelsDirListing = await import('node:fs/promises').then(fs => fs.readdir(join(root!, 'models')))
    expect(modelsDirListing).toEqual([])
  })
})
