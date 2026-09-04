import { afterEach, expect, test } from 'bun:test'
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function launch(body: string, backend?: string) {
  const root = mkdtempSync(join(tmpdir(), 'server-bootstrap-'))
  roots.push(root)
  copyFileSync(join(import.meta.dir, '..', 'index.ts'), join(root, 'index.ts'))
  writeFileSync(join(root, 'server.ts'), body)
  const env = { ...process.env }
  delete env.PANGOCAIRO_BACKEND
  if (backend) env.PANGOCAIRO_BACKEND = backend
  return Bun.spawn([process.execPath, join(root, 'index.ts'), 'argument with spaces'], {
    env, stdout: 'pipe', stderr: 'pipe',
  })
}

test('bootstrap sets the Mac launch environment and preserves arguments and exit status', async () => {
  const proc = launch('console.log(JSON.stringify([process.env.PANGOCAIRO_BACKEND, process.argv.at(-1)])); process.exit(23)')
  expect(await proc.exited).toBe(23)
  expect(JSON.parse(await new Response(proc.stdout).text())).toEqual([
    process.platform === 'darwin' ? 'fontconfig' : null,
    'argument with spaces',
  ])
})

test('bootstrap preserves an explicit backend', async () => {
  const proc = launch('console.log(process.env.PANGOCAIRO_BACKEND)', 'custom-backend')
  expect(await proc.exited).toBe(0)
  expect((await new Response(proc.stdout).text()).trim()).toBe('custom-backend')
})

test('bootstrap forwards shutdown to the running server', async () => {
  const proc = launch('process.on("SIGTERM", () => process.exit(42)); setInterval(() => {}, 1000); console.log("ready")')
  try {
    const reader = proc.stdout.getReader()
    await reader.read()
    reader.releaseLock()
    proc.kill('SIGTERM')
    expect(await proc.exited).toBe(42)
  } finally {
    proc.kill()
  }
})
