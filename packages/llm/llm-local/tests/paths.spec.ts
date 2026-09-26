import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureModelsDir } from '../src/paths.ts'

describe('ensureModelsDir', () => {
  let root: string
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'dsh-llm-local-')) })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  it('creates a fresh-install modelsDir that does not exist yet', async () => {
    const target = join(root, 'nested', 'models')
    await ensureModelsDir(target)
    const info = await stat(target)
    expect(info.isDirectory()).toBe(true)
  })

  it('is a no-op when the directory already exists', async () => {
    await ensureModelsDir(root)
    await expect(ensureModelsDir(root)).resolves.toBeUndefined()
  })

  it('fails when an existing file occupies the target path', async () => {
    const filePath = join(root, 'occupied')
    await writeFile(filePath, 'not a directory')
    await expect(ensureModelsDir(filePath)).rejects.toThrow()
  })
})
