import { expect, test } from 'bun:test';
import { BaseAgent } from '../base-agent.ts';
import { SourceManager } from '../core/source-manager.ts';
import { McpClientPool } from '../../mcp/mcp-pool.ts';

test('failed transport connection stays intended but is not reported connected', async () => {
  class FailingPool extends McpClientPool {
    async connect(): Promise<void> { throw new Error('Unavailable test transport'); }
  }
  const pool = new FailingPool();
  const sourceManager = new SourceManager();
  // Source lifecycle has no need to construct providers or write session files.
  const agent = Object.create(BaseAgent.prototype) as BaseAgent;
  Object.assign(agent, { config: { mcpPool: pool }, sourceManager, sourceServersUpdateVersion: 0 });
  await agent.setSourceServers({ service: { type: 'http', url: 'https://example.invalid' } }, {}, ['service']);
  expect(agent.getActiveSourceSlugs()).toEqual(['service']);
  expect(agent.isSourceServerActive('service')).toBe(false);
  expect([...agent.getActiveSourceServerNames()]).toEqual([]);
  expect(sourceManager.isSourceActive('service')).toBe(false);
});
