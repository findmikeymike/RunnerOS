/** Run with node --experimental-strip-types. Uses only hidden, isolated Electron fixtures. */
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temp = mkdtempSync(join(tmpdir(), 'output-preview-smoke-'))
try {
  const entry = join(temp, 'probe.cjs')
  await build({
    entryPoints: [join(root, 'scripts/tests/output-preview-isolation.electron.ts')],
    outfile: entry, bundle: true, platform: 'node', format: 'cjs', external: ['electron'],
    plugins: [{ name: 'isolated-fixtures', setup(builder) {
      builder.onResolve({ filter: /^@craft-agent\/shared\/config$/ }, () => ({ path: 'config', namespace: 'fixture' }))
      builder.onResolve({ filter: /^\.\/logger$/ }, (args) => args.importer.endsWith('/output-asset-protocol.ts')
        ? { path: 'logger', namespace: 'fixture' } : undefined)
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: args.path === 'config'
        ? 'export const getWorkspaceByNameOrId = id => globalThis.__previewWorkspaces.get(id);'
        : 'export const mainLog = {info(){},warn(){}};' }))
    } }],
  })
  const electron = createRequire(join(root, 'package.json'))('electron') as string
  const code = await new Promise<number>((resolveCode, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, OUTPUT_PREVIEW_SMOKE_DIR: temp }
    delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(electron, ['--enable-logging=stderr', entry], { env, stdio: 'inherit' })
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Electron preview smoke timed out')) }, 45_000)
    child.on('error', (error) => { clearTimeout(timeout); reject(error) })
    child.on('exit', (code) => { clearTimeout(timeout); resolveCode(code ?? 1) })
  })
  if (code !== 0) throw new Error(`Electron preview smoke failed (${code})`)
} finally {
  rmSync(temp, { recursive: true, force: true })
}
