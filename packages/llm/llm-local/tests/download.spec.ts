import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import type { Server } from 'node:http'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ChecksumMismatchError, downloadModel } from '../src/download.ts'
import type { ModelCatalogEntry } from '../src/types.ts'

const FIXTURE_BYTES = Buffer.from('local-model-fixture-bytes-for-checksum-testing')
const FIXTURE_SHA256 = createHash('sha256').update(FIXTURE_BYTES).digest('hex')

describe('downloadModel', () => {
  let server: Server
  let baseUrl: string
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-llm-local-dl-'))
    server = createServer((req, res) => {
      if (req.url === '/slow') {
        res.writeHead(200, { 'content-length': String(FIXTURE_BYTES.length) })
        res.write(FIXTURE_BYTES.subarray(0, 4))
        // Never finishes on its own; the test aborts it mid-stream.
        return
      }
      if (req.url === '/missing') {
        res.writeHead(404, { 'content-length': 0 })
        res.end()
        return
      }
      res.writeHead(200, { 'content-length': String(FIXTURE_BYTES.length) })
      res.end(FIXTURE_BYTES)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('expected a bound TCP address')
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  })

  const entryFor = (path: string, sha256: string): ModelCatalogEntry => ({
    id: 'fixture',
    displayName: 'Fixture',
    huggingFaceUrl: `${baseUrl}${path}`,
    sizeBytes: FIXTURE_BYTES.length,
    sha256,
    minRamBytes: 0,
  })

  it('downloads the file and verifies its checksum before the destination exists', async () => {
    const dest = join(root, 'model.gguf')
    const progressed: number[] = []
    await downloadModel(entryFor('/ok', FIXTURE_SHA256), dest, { onProgress: bytes => progressed.push(bytes) })
    expect(await readFile(dest)).toEqual(FIXTURE_BYTES)
    expect(progressed.at(-1)).toBe(FIXTURE_BYTES.length)
  })

  it('rejects and leaves no destination file on a checksum mismatch', async () => {
    const dest = join(root, 'model.gguf')
    await expect(downloadModel(entryFor('/ok', '0'.repeat(64)), dest, {}))
      .rejects.toBeInstanceOf(ChecksumMismatchError)
    await expect(readFile(dest)).rejects.toThrow()
    expect(await readdir(root)).toEqual([])
  })

  it('cleans up the temp file and leaves no destination on a mid-stream abort', async () => {
    const dest = join(root, 'model.gguf')
    const controller = new AbortController()
    const pending = downloadModel(entryFor('/slow', FIXTURE_SHA256), dest, {
      signal: controller.signal,
      onProgress: () => {
        controller.abort()
      },
    })
    await expect(pending).rejects.toThrow()
    await expect(readFile(dest)).rejects.toThrow()
    expect(await readdir(root)).toEqual([])
  })

  it('rejects and leaves no destination when the server responds with an HTTP error', async () => {
    const dest = join(root, 'model.gguf')
    await expect(downloadModel(entryFor('/missing', FIXTURE_SHA256), dest, {}))
      .rejects.toThrow(/HTTP 404/u)
    await expect(readFile(dest)).rejects.toThrow()
    expect(await readdir(root)).toEqual([])
  })
})
