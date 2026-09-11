import { afterAll, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { build, type UserConfig } from 'vite'
import electronConfig from '../apps/electron/vite.config'

const root = mkdtempSync(join(realpathSync(tmpdir()), 'renderer-publication-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

test('real Vite builds stamp output and leave previous renderer intact on compile failure', async () => {
  const source = join(root, 'source'), destination = join(root, 'renderer')
  mkdirSync(source); mkdirSync(destination)
  writeFileSync(join(destination, 'index.html'), 'previous renderer')
  writeFileSync(join(source, 'index.html'), '<html><script type="module" src="./entry.ts"></script></html>')
  writeFileSync(join(source, 'entry.ts'), 'console.log(__ARTIST_OS_BUILD_INFO__)')
  const configured = typeof electronConfig === 'function' ? await electronConfig({ command: 'build', mode: 'production', isSsrBuild: false, isPreview: false }) : electronConfig
  const config: UserConfig = {
    ...configured, configFile: false, root: source, logLevel: 'silent',
    build: { ...configured.build, outDir: destination, sourcemap: false, minify: false, rollupOptions: { input: join(source, 'index.html') } },
  }
  await build(config)
  const html = readFileSync(join(destination, 'index.html'), 'utf8')
  expect(html).not.toBe('previous renderer')
  const assets = readdirSync(join(destination, 'assets'))
  const js = assets.filter(name => name.endsWith('.js')).map(name => readFileSync(join(destination, 'assets', name), 'utf8')).join('\n')
  expect(js).toContain('sourceHash')
  expect(js).toContain('renderer')
  writeFileSync(join(source, 'entry.ts'), 'import "./missing-input-module"')
  await expect(build(config)).rejects.toThrow()
  expect(readFileSync(join(destination, 'index.html'), 'utf8')).toBe(html)
  expect(readdirSync(join(destination, 'assets'))).toEqual(assets)
})

test('Vite serve does not claim a stale whole-renderer identity during partial HMR', async () => {
  const configured = typeof electronConfig === 'function' ? await electronConfig({ command: 'serve', mode: 'development', isSsrBuild: false, isPreview: false }) : electronConfig
  expect(configured.define?.__ARTIST_OS_BUILD_INFO__).toBe('undefined')
})
