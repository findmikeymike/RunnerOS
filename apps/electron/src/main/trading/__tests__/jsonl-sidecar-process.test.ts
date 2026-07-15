import { describe, expect, test } from 'bun:test'
import path from 'node:path'

import {
  JsonlSidecarExitedError,
  JsonlSidecarProcess,
  JsonlSidecarProtocolError,
  JsonlSidecarRequestTimeoutError,
} from '../jsonl-sidecar-process.ts'


const fixture = path.join(import.meta.dir, 'fixtures', 'coalesced-lines-sidecar.ts')
const fixtures = path.join(import.meta.dir, 'fixtures')


function processFor(script: string, requestTimeoutMs = 500, maxLineBytes = 1_000): JsonlSidecarProcess {
  return new JsonlSidecarProcess({
    serviceLabel: 'Test',
    command: [process.execPath, path.join(fixtures, script)],
    cwd: fixtures,
    requestTimeoutMs,
    maxLineBytes,
    maxStderrBytes: 1_024,
  })
}


describe('JsonlSidecarProcess', () => {
  test('applies the byte limit to each line when multiple valid responses share one chunk', async () => {
    const sidecar = new JsonlSidecarProcess({
      serviceLabel: 'Coalesced Test',
      command: [process.execPath, fixture],
      cwd: path.dirname(fixture),
      requestTimeoutMs: 1_000,
      maxLineBytes: 150,
      maxStderrBytes: 1_024,
    })
    try {
      const responses = await Promise.all([
        sidecar.request({ jsonrpc: '2.0', id: 'one', method: 'test', params: {} }),
        sidecar.request({ jsonrpc: '2.0', id: 'two', method: 'test', params: {} }),
      ])
      expect(responses).toHaveLength(2)
      expect(sidecar.status().state).toBe('ready')
    } finally {
      await sidecar.stop()
    }
  })

  test('keeps timeout, process exit, and protocol corruption distinguishable', async () => {
    const silent = processFor('silent-sidecar.ts', 30)
    const crashing = processFor('crashing-sidecar.ts')
    const oversized = processFor('oversized-sidecar.ts', 500, 64)
    try {
      await expect(silent.request({ jsonrpc: '2.0', id: 'silent', method: 'test', params: {} }))
        .rejects.toBeInstanceOf(JsonlSidecarRequestTimeoutError)
      await expect(crashing.request({ jsonrpc: '2.0', id: 'crash', method: 'test', params: {} }))
        .rejects.toBeInstanceOf(JsonlSidecarExitedError)
      await expect(oversized.request({ jsonrpc: '2.0', id: 'large', method: 'test', params: {} }))
        .rejects.toBeInstanceOf(JsonlSidecarProtocolError)
    } finally {
      await Promise.all([silent.stop(), crashing.stop(), oversized.stop()])
    }
  })

  test('allows a caller to extend one request timeout without weakening the process default', async () => {
    const sidecar = processFor('silent-sidecar.ts', 30)
    const started = performance.now()
    try {
      await expect(sidecar.request(
        { jsonrpc: '2.0', id: 'extended', method: 'test', params: {} },
        80,
      )).rejects.toBeInstanceOf(JsonlSidecarRequestTimeoutError)
      expect(performance.now() - started).toBeGreaterThanOrEqual(70)
    } finally {
      await sidecar.stop()
    }
  })
})
