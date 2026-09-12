/**
 * Pool client for API sources.
 *
 * Connects to an in-process McpServer (created by createSdkMcpServer) via
 * in-memory transport, exposing it through the same PoolClient interface
 * that CraftMcpClient uses for remote MCP sources.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { PoolClient } from './client.ts';
import { getGmailDraftPreparer, type PreparedGmailSend } from '../sources/gmail-send-snapshot.ts';

export class ApiSourcePoolClient implements PoolClient {
  private client: Client;
  private connected = false;

  constructor(private mcpServer: McpServer) {
    this.client = new Client({ name: 'craft-pool-api-source', version: '1.0.0' });
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    // Connect both ends
    await this.mcpServer.connect(serverTransport);
    await this.client.connect(clientTransport);

    this.connected = true;
  }

  async listTools(): Promise<Tool[]> {
    if (!this.connected) await this.connect();
    const result = await this.client.listTools();
    return result.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.connected) await this.connect();
    return this.client.callTool({ name, arguments: args });
  }

  async prepareGmailDraftSend(input: Record<string, unknown>): Promise<PreparedGmailSend> {
    const prepare = getGmailDraftPreparer(this.mcpServer);
    if (!prepare) throw new Error('This Gmail source cannot prepare an exact draft preview. Reconnect the source and try again.');
    return prepare(input);
  }

  async close(): Promise<void> {
    if (this.connected) {
      await this.client.close().catch(() => {});
      this.connected = false;
    }
  }
}
