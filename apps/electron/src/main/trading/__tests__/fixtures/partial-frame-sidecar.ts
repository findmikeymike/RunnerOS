import { createInterface } from 'node:readline'

import { createOrderFlowRpcHandler } from '../../../../../../../sidecars/order-flow-engine/src/index.ts'

const handler = createOrderFlowRpcHandler({
  now: () => new Date().toISOString(),
  instanceId: 'partial-frame-test',
})
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false })

for await (const line of lines) {
  if (!line.trim()) continue
  const request = JSON.parse(line)
  const response = await handler.handle(request)
  const frame = `${JSON.stringify(response)}\n`
  const midpoint = Math.floor(frame.length / 2)
  process.stdout.write(frame.slice(0, midpoint))
  await Bun.sleep(10)
  process.stdout.write(frame.slice(midpoint))
  if (handler.state() === 'stopped') break
}

lines.close()
