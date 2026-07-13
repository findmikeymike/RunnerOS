import { createInterface } from 'node:readline'


const requests: Array<Record<string, unknown>> = []
const lines = createInterface({ input: process.stdin, terminal: false })
for await (const line of lines) {
  requests.push(JSON.parse(line))
  if (requests.length === 2) {
    const responses = requests.map((request) => JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: { payload: 'x'.repeat(80) },
    }))
    process.stdout.write(`${responses.join('\n')}\n`)
  }
}
