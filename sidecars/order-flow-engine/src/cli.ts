import { createInterface } from 'node:readline'

import { createOrderFlowRpcHandler } from './index.ts'

const handler = createOrderFlowRpcHandler({
  now: () => new Date().toISOString(),
  instanceId: process.env.TRADE_GOD_SIDECAR_INSTANCE_ID ?? `order-flow-${process.pid}`,
})

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false })

for await (const line of lines) {
  if (!line.trim()) continue

  let request: unknown
  try {
    request = JSON.parse(line)
  } catch {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    })}\n`)
    continue
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
    continue
  }

  const response = await handler.handle(request as Parameters<typeof handler.handle>[0])
  process.stdout.write(`${JSON.stringify(response)}\n`)

  if (handler.state() === 'stopped') break
}

lines.close()
