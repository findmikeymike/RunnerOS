import { test, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { context } from 'esbuild'
import { buildProvenancePlugin } from './build-provenance-plugin'

test('watch rebuild embeds new source identity while previously loaded output stays unchanged', async () => {
  const root = mkdtempSync(join(tmpdir(), 'build-watch-'))
  let build: Awaited<ReturnType<typeof context>> | undefined
  try {
    execFileSync('git', ['init', '-q', root])
    mkdirSync(join(root, 'packages/shared/src'), { recursive: true })
    const modulePath = join(root, 'packages/shared/src/build-info.ts')
    writeFileSync(modulePath, 'declare const __ARTIST_OS_BUILD_INFO__: unknown; export const info = __ARTIST_OS_BUILD_INFO__;')
    build = await context({ entryPoints: [modulePath], bundle: true, write: false, format: 'cjs', plugins: [buildProvenancePlugin(root, 'main')] })
    const read = (code: string) => { const module = { exports: {} as { info: { sourceHash: string } } }; new Function('module', 'exports', code)(module, module.exports); return module.exports.info }
    const first = read((await build.rebuild()).outputFiles![0]!.text)
    writeFileSync(join(root, 'packages/shared/src/new-input.ts'), 'export const changed = true')
    const second = read((await build.rebuild()).outputFiles![0]!.text)
    expect(first.sourceHash).not.toBe(second.sourceHash)
    expect(first.sourceHash).toHaveLength(64)
  } finally {
    await build?.dispose()
    rmSync(root, { recursive: true, force: true })
  }
})
