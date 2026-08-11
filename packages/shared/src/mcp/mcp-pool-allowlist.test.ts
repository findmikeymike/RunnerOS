import { expect, test } from 'bun:test'
import type { PoolClient } from './client.ts'
import { McpClientPool } from './mcp-pool.ts'

class TestPool extends McpClientPool {
  register(slug: string, client: PoolClient, allowedTools: string[]) {
    return this.registerClient(slug, client, allowedTools)
  }
}

test('MCP source allowlist hides and blocks server mutation tools', async () => {
  const calls: string[] = []
  const client: PoolClient = {
    listTools: async () => [
      { name: 'dt_status', description: 'Read status', inputSchema: { type: 'object' } },
      { name: 'dt_place_ticket', description: 'Place ticket', inputSchema: { type: 'object' } },
    ],
    callTool: async (name) => { calls.push(name); return { ok: true } },
    close: async () => undefined,
  }
  const pool = new TestPool()
  await pool.register('discotrader', client, ['dt_status'])

  expect(pool.getTools('discotrader').map(({ name }) => name)).toEqual(['dt_status'])
  expect(pool.getProxyToolDefs().map(({ name }) => name)).toEqual(['mcp__discotrader__dt_status'])
  expect(await pool.callTool('mcp__discotrader__dt_place_ticket', {})).toMatchObject({
    isError: true,
  })
  expect(calls).toEqual([])
})
