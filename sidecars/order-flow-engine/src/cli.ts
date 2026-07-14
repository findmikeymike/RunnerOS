import { analyzeOrderFlowFixture } from '@trade-god/testkit'

import { createOrderFlowRpcHandler } from './index.ts'
import { ORDER_FLOW_MAX_LINE_BYTES } from './analyze-market-batch.ts'

const testDelayMs = Number(process.env.TRADE_GOD_TEST_ANALYSIS_DELAY_MS || 0)
const handler = createOrderFlowRpcHandler({
  now: () => new Date().toISOString(),
  instanceId: process.env.TRADE_GOD_SIDECAR_INSTANCE_ID ?? `order-flow-${process.pid}`,
  ...(testDelayMs > 0 ? {
    analyzeFixture: async (fixture, context) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, testDelayMs)
        context.signal.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new Error('analysis aborted'))
        }, { once: true })
      })
      return analyzeOrderFlowFixture(fixture, {
        meta: context.meta,
        artifact_id: context.artifactId,
      })
    },
  } : {}),
})

const pending = new Set<Promise<void>>()

async function processLine(line: string): Promise<void> {
  if (!line.trim()) return

  if (Buffer.byteLength(line, 'utf8') > ORDER_FLOW_MAX_LINE_BYTES) {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Request too large' },
    })}\n`)
    return
  }

  let request: unknown
  try {
    request = JSON.parse(line)
  } catch {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    })}\n`)
    return
  }

  if (
    !request
    || typeof request !== 'object'
    || (request as Record<string, unknown>).jsonrpc !== '2.0'
    || typeof (request as Record<string, unknown>).method !== 'string'
    || !Object.hasOwn(request, 'id')
  ) {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid Request' },
    })}\n`)
    return
  }

  const response = await handler.handle(request as Parameters<typeof handler.handle>[0])
  process.stdout.write(`${JSON.stringify(response)}\n`)
  if (handler.state() === 'stopped') process.stdin.destroy()
}

function schedule(line: string): void {
  const task = processLine(line)
  pending.add(task)
  void task.finally(() => pending.delete(task))
}

const frame = Buffer.allocUnsafe(ORDER_FLOW_MAX_LINE_BYTES)
let frameLength = 0
let discardingOversizedFrame = false

for await (const chunkValue of process.stdin) {
  const chunk = Buffer.isBuffer(chunkValue) ? chunkValue : Buffer.from(chunkValue)
  let offset = 0
  while (offset < chunk.length) {
    const newline = chunk.indexOf(0x0a, offset)
    const end = newline === -1 ? chunk.length : newline
    const pieceLength = end - offset
    if (!discardingOversizedFrame) {
      if (frameLength + pieceLength > ORDER_FLOW_MAX_LINE_BYTES) {
        discardingOversizedFrame = true
        frameLength = 0
        process.stdout.write(`${JSON.stringify({
          jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large' },
        })}\n`)
      } else {
        chunk.copy(frame, frameLength, offset, end)
        frameLength += pieceLength
      }
    }

    if (newline === -1) break
    if (!discardingOversizedFrame) {
      const lineEnd = frameLength > 0 && frame[frameLength - 1] === 0x0d ? frameLength - 1 : frameLength
      schedule(frame.subarray(0, lineEnd).toString('utf8'))
    }
    frameLength = 0
    discardingOversizedFrame = false
    offset = newline + 1
  }
}

if (!discardingOversizedFrame && frameLength > 0) schedule(frame.subarray(0, frameLength).toString('utf8'))

await Promise.all(pending)
