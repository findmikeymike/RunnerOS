import { describe, expect, it } from 'bun:test';
import { evaluateMonidSpendLimit, extractMonidActualCostUsd, MONID_MAX_RUN_COST_USD } from '../monid-spend-guard.ts';
import { McpClientPool } from '../mcp-pool.ts';
import type { PoolClient } from '../client.ts';
import { DEFAULT_MONID_SINGLE_CALL_CAP_USD, DEFAULT_MONID_WEEKLY_CAP_USD, MonidBudgetStore } from '../monid-budget.ts';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

class TestMcpClientPool extends McpClientPool {
  register(slug: string, client: PoolClient): Promise<void> {
    return this.registerClient(slug, client);
  }
}

describe('Monid spend guard', () => {
  it('allows a per-call price within the hard cap', () => {
    expect(evaluateMonidSpendLimit(
      { price: { type: 'PER_CALL', amount: 0.003, currency: 'USD' } },
      { provider: 'apify', endpoint: '/tweets', input: {} },
    )).toEqual({ allowed: true, projectedMaxUsd: 0.003 });
  });

  it('blocks a per-call price above the hard cap', () => {
    const result = evaluateMonidSpendLimit(
      { price: { type: 'PER_CALL', amount: MONID_MAX_RUN_COST_USD + 0.01, currency: 'USD' } },
      { provider: 'apify', endpoint: '/expensive', input: {} },
    );
    expect(result.allowed).toBe(false);
    expect('reason' in result ? result.reason : '').toContain('exceeds');
  });

  it('calculates a conservative per-result maximum from bounded input', () => {
    expect(evaluateMonidSpendLimit(
      { price: { type: 'PER_RESULT', amount: 0.01, flatFee: 0.02, currency: 'USD' } },
      { provider: 'apify', endpoint: '/tweets', input: { maxItems: 10 } },
    )).toEqual({ allowed: true, projectedMaxUsd: 0.12 });
  });

  it('blocks per-result execution when no result bound can be proven', () => {
    const result = evaluateMonidSpendLimit(
      { price: { type: 'PER_RESULT', amount: 0.001, currency: 'USD' } },
      { provider: 'apify', endpoint: '/tweets', input: { query: 'AI' } },
    );
    expect(result.allowed).toBe(false);
    expect('reason' in result ? result.reason : '').toContain('bounded result count');
  });

  it('blocks unknown or non-USD pricing', () => {
    expect(evaluateMonidSpendLimit(
      { price: { type: 'PER_CALL', amount: 0.01, currency: 'EUR' } },
      { input: {} },
    ).allowed).toBe(false);
    expect(evaluateMonidSpendLimit({ noPrice: true }, { input: {} }).allowed).toBe(false);
  });

  it('extracts the actual charged cost from a run response', () => {
    expect(extractMonidActualCostUsd({
      content: [{ type: 'text', text: JSON.stringify({ cost: { value: 0.03, currency: 'USD' } }) }],
    })).toBe(0.03);
  });
});

describe('Monid rolling budget', () => {
  const createStore = (now = () => Date.now()) => new MonidBudgetStore(
    join(mkdtempSync(join(tmpdir(), 'monid-budget-test-')), 'budget.json'),
    now,
  );

  it('starts with agentic defaults and supports user-set limits', () => {
    const store = createStore();
    expect(store.getStatus()).toMatchObject({
      singleCallCapUsd: DEFAULT_MONID_SINGLE_CALL_CAP_USD,
      weeklyCapUsd: DEFAULT_MONID_WEEKLY_CAP_USD,
      spentLast7DaysUsd: 0,
    });
    expect(store.updateLimits(2, 25)).toMatchObject({ singleCallCapUsd: 2, weeklyCapUsd: 25 });
  });

  it('blocks only when the next call would cross the single-call or weekly cap', () => {
    const store = createStore();
    store.updateLimits(0.05, 0.10);
    const first = store.reserve(0.03);
    store.commit(first, 0.03);
    const second = store.reserve(0.03);
    store.commit(second, 0.03);
    const third = store.reserve(0.03);
    store.commit(third, 0.03);

    expect(store.getStatus().spentLast7DaysUsd).toBe(0.09);
    expect(() => store.reserve(0.02)).toThrow('weekly cap');
    expect(() => store.reserve(0.06)).toThrow('single-call cap');
  });

  it('reconciles a conservative reservation to the actual charge', () => {
    const store = createStore();
    const reservation = store.reserve(0.40);
    expect(store.getStatus().spentLast7DaysUsd).toBe(0.40);
    store.commit(reservation, 0.03);
    expect(store.getStatus().spentLast7DaysUsd).toBe(0.03);
  });

  it('drops spend after seven days', () => {
    let now = 1_000_000_000;
    const store = createStore(() => now);
    const reservation = store.reserve(0.40);
    store.commit(reservation, 0.40);
    now += (7 * 24 * 60 * 60 * 1000) + 1;
    expect(store.getStatus().spentLast7DaysUsd).toBe(0);
  });
});

describe('Monid pool enforcement', () => {
  const createPool = () => new TestMcpClientPool({
    monidBudgetStore: new MonidBudgetStore(join(mkdtempSync(join(tmpdir(), 'monid-pool-test-')), 'budget.json')),
  });

  it('inspects immediately before a permitted run', async () => {
    const calls: string[] = [];
    const client: PoolClient = {
      listTools: async () => [
        { name: 'inspect', description: 'Inspect', inputSchema: { type: 'object' } },
        { name: 'run', description: 'Run', inputSchema: { type: 'object' } },
      ],
      callTool: async (name) => {
        calls.push(name);
        if (name === 'inspect') {
          return { content: [{ type: 'text', text: JSON.stringify({ price: { type: 'PER_CALL', amount: 0.03, currency: 'USD' } }) }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify({ runId: 'run-1' }) }] };
      },
      close: async () => {},
    };
    const pool = createPool();
    await pool.register('monid', client);

    const result = await pool.callTool('mcp__monid__run', { provider: 'apify', endpoint: '/tweets', input: {} });
    expect(result.isError).toBe(false);
    expect(calls).toEqual(['inspect', 'run']);
  });

  it('does not execute a run whose inspected price exceeds the cap', async () => {
    const calls: string[] = [];
    const client: PoolClient = {
      listTools: async () => [
        { name: 'inspect', description: 'Inspect', inputSchema: { type: 'object' } },
        { name: 'run', description: 'Run', inputSchema: { type: 'object' } },
      ],
      callTool: async (name) => {
        calls.push(name);
        return { content: [{ type: 'text', text: JSON.stringify({ price: { type: 'PER_CALL', amount: 0.75, currency: 'USD' } }) }] };
      },
      close: async () => {},
    };
    const pool = createPool();
    await pool.register('monid', client);

    const result = await pool.callTool('mcp__monid__run', { provider: 'apify', endpoint: '/expensive', input: {} });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('single-call cap');
    expect(calls).toEqual(['inspect']);
  });
});
