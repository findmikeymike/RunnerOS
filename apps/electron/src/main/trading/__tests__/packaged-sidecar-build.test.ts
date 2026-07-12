import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { PROTOCOL_VERSION } from '@trade-god/contracts'

const repoRoot = path.resolve(import.meta.dir, '../../../../../..')

test('builds a self-contained packaged sidecar that answers health', async () => {
  const outputRoot = mkdtempSync(path.join(tmpdir(), 'trade-god-sidecar-build-'))

  try {
    const build = Bun.spawn({
      cmd: [process.execPath, 'run', 'trade-god:build-sidecars', '--outdir', outputRoot],
      cwd: repoRoot,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const buildError = await new Response(build.stderr).text()
    expect(await build.exited, buildError).toBe(0)

    const entrypoint = path.join(outputRoot, 'order-flow-engine.mjs')
    expect(existsSync(entrypoint)).toBe(true)

    const sidecar = Bun.spawn({
      cmd: [process.execPath, entrypoint],
      cwd: outputRoot,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    sidecar.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 'packaged-health-1',
      method: 'trade.health',
      params: {
        meta: {
          schema_version: PROTOCOL_VERSION,
          trace_id: 'trace-packaged-health',
          created_at: '2026-07-11T15:30:00.000Z',
          producer: { name: 'packaged-test', version: '0.1.0', instance_id: 'packaged-test-1' },
        },
      },
    }) + '\n')
    sidecar.stdin.end()

    const response = JSON.parse((await new Response(sidecar.stdout).text()).trim())
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 'packaged-health-1',
      result: { state: 'ready', capabilities: { fixture_mode: true } },
    })
    expect(await sidecar.exited).toBe(0)
  } finally {
    rmSync(outputRoot, { recursive: true, force: true })
  }
})
