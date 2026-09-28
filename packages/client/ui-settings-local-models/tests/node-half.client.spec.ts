/** Node half of the plugin: the Host declares the package; the browser half renders it. */
import { expect, it } from 'vitest'
import { apply as applyHost } from '../src/index.ts'

it('keeps the host half empty', () => {
  expect(() => { applyHost() }).not.toThrow()
})
