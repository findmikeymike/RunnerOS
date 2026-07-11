import { expect, test } from 'bun:test'

import { PROTOCOL_VERSION } from '@trade-god/contracts'

test('serves newline-delimited JSON-RPC on stdout and keeps stderr clean', async () => {
  const cliPath = new URL('../src/cli.ts', import.meta.url).pathname
  const child = Bun.spawn([process.execPath, cliPath], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const meta = {
    schema_version: PROTOCOL_VERSION,
    trace_id: 'trace-stdio-test',
    created_at: '2026-07-11T15:30:00.000Z',
    producer: { name: 'stdio-test-client', version: '0.1.0', instance_id: 'stdio-test-1' },
  }
  const lines = [
    '{not-json}',
    JSON.stringify({ jsonrpc: '2.0', id: 'health-stdio', method: 'trade.health', params: { meta } }),
    JSON.stringify({ jsonrpc: '2.0', id: 'shutdown-stdio', method: 'trade.shutdown', params: { meta } }),
  ]

  child.stdin.write(`${lines.join('\n')}\n`)
  child.stdin.end()

  const timeout = setTimeout(() => child.kill(), 2_000)
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  clearTimeout(timeout)

  expect(exitCode).toBe(0)
  expect(stderr).toBe('')

  const responses = stdout.trim().split('\n').map((line) => JSON.parse(line))
  expect(responses).toHaveLength(3)
  expect(responses[0]).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
  expect(responses[1]).toMatchObject({ id: 'health-stdio', result: { state: 'ready' } })
  expect(responses[2]).toEqual({ jsonrpc: '2.0', id: 'shutdown-stdio', result: { state: 'stopped' } })
})
