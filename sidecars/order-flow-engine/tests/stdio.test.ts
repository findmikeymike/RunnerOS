import { expect, test } from 'bun:test'

import { PROTOCOL_VERSION } from '@trade-god/contracts'
import { loadEsDemoFixture } from '@trade-god/testkit'
import { ORDER_FLOW_MAX_LINE_BYTES } from '../src/analyze-market-batch.ts'

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

test('processes cancellation while analysis is in flight over stdio', async () => {
  const fixture = await loadEsDemoFixture()
  const cliPath = new URL('../src/cli.ts', import.meta.url).pathname
  const child = Bun.spawn([process.execPath, cliPath], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, TRADE_GOD_TEST_ANALYSIS_DELAY_MS: '50' },
  })
  const meta = {
    schema_version: PROTOCOL_VERSION,
    trace_id: 'trace-active-cancel-stdio',
    created_at: '2026-07-11T15:30:00.000Z',
    producer: { name: 'stdio-test-client', version: '0.1.0', instance_id: 'stdio-test-1' },
  }
  const lines = [
    JSON.stringify({
      jsonrpc: '2.0', id: 'analyze-active', method: 'trade.analyze_fixture', params: {
        meta,
        fixture: { id: fixture.manifest.fixture_id, sha256: fixture.manifest.events_sha256 },
        instrument: fixture.manifest.instrument,
        session: fixture.manifest.session,
        analysis: { name: 'order-flow-summary', version: '0.1.0', configuration_hash: 'b'.repeat(64) },
        deadline_at: '2099-01-01T00:00:00.000Z',
        cancellation_id: 'cancel-active-stdio',
      },
    }),
    JSON.stringify({ jsonrpc: '2.0', id: 'cancel-active', method: 'trade.cancel', params: { meta, cancellation_id: 'cancel-active-stdio' } }),
    JSON.stringify({ jsonrpc: '2.0', id: 'shutdown-active', method: 'trade.shutdown', params: { meta } }),
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
  expect(responses.find((response) => response.id === 'analyze-active')).toMatchObject({
    error: { data: { trade_error: { code: 'CANCELED', category: 'canceled' } } },
  })
  expect(responses.find((response) => response.id === 'cancel-active')).toMatchObject({ result: { state: 'canceled' } })
})

test('rejects an oversized JSONL frame before parsing and remains responsive', async () => {
  const cliPath = new URL('../src/cli.ts', import.meta.url).pathname
  const child = Bun.spawn([process.execPath, cliPath], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
  const meta = {
    schema_version: PROTOCOL_VERSION, trace_id: 'trace-oversized-stdio', created_at: '2026-07-13T12:00:00.000Z',
    producer: { name: 'stdio-test-client', version: '0.1.0', instance_id: 'stdio-test-1' },
  }
  child.stdin.write(`${'x'.repeat(ORDER_FLOW_MAX_LINE_BYTES + 1)}\n`)
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 'health-after-large', method: 'trade.health', params: { meta } })}\n`)
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 'shutdown-after-large', method: 'trade.shutdown', params: { meta } })}\n`)
  child.stdin.end()

  const timeout = setTimeout(() => child.kill(), 2_000)
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ])
  clearTimeout(timeout)
  expect(exitCode).toBe(0)
  expect(stderr).toBe('')
  const responses = stdout.trim().split('\n').map((line) => JSON.parse(line))
  expect(responses[0]).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large' } })
  expect(responses[1]).toMatchObject({ id: 'health-after-large', result: { state: 'ready' } })
})
