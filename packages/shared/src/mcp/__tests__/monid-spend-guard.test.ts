import { describe, expect, it } from 'bun:test';
import { evaluateMonidSpendLimit, extractMonidActualCostUsd, MONID_MAX_RUN_COST_USD } from '../monid-spend-guard.ts';
import { McpClientPool } from '../mcp-pool.ts';
import type { PoolClient } from '../client.ts';
import { DEFAULT_MONID_SINGLE_CALL_CAP_USD, DEFAULT_MONID_WEEKLY_CAP_USD, MonidBudgetStore } from '../monid-budget.ts';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

class TestMcpClientPool extends McpClientPool {
  async register(slug: string, client: PoolClient): Promise<void> {
    await this.registerClient(slug, client);
  }
}

describe('Monid spend guard', () => {
  it('accepts absent nullable fees in legacy and money-object prices', () => {
    for (const amount of [0.01, { value: 0.01, currency: 'USD' }]) {
      expect(evaluateMonidSpendLimit({ price: { type: 'PER_CALL', amount, currency: 'USD', flatFee: null } }, { input: {} }, 0.02))
        .toEqual({ allowed: true, projectedMaxUsd: 0.01 });
    }
  });
  it('bounds the pinned transcript singleton and accepts documented money objects', () => {
    const price = { price: { type: 'PER_RESULT', amount: { value: 0.01, currency: 'USD' }, flatFee: { value: 0.001, currency: 'USD' } } };
    const args = { provider: 'apify', endpoint: '/starvibe/youtube-video-transcript', input: { youtube_url: 'https://www.youtube.com/watch?v=abcdefghijk', language: 'en' } };
    expect(evaluateMonidSpendLimit(price, args, 0.02)).toEqual({ allowed: true, projectedMaxUsd: 0.011 });
    expect(evaluateMonidSpendLimit(price, args, 0.005).allowed).toBe(false);
    expect(evaluateMonidSpendLimit(price, { ...args, input: { ...args.input, channel_url: 'https://youtube.com/@example', limit: 1 } }, 0.02).allowed).toBe(false);
    expect(evaluateMonidSpendLimit(price, args, NaN).allowed).toBe(false);
  });
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

describe('Monid narrow marketplace pins', () => {
  const makeInspection = (provider: string, endpoint: string, properties: Record<string, unknown>, query = false) => ({
    provider, endpoint,
    price: { type: 'PER_RESULT', amount: { value: 0.01, currency: 'USD' } },
    input: query ? { queryParams: { type: 'object', properties } }
      : { bodyType: 'json', body: { type: 'object', properties } },
  });
  const hunter = makeInspection('hunterio', '/email-finder', {
    domain: { type: 'string' }, company: { type: 'string' }, linkedin_handle: { type: 'string' },
    full_name: { type: 'string' }, first_name: { type: 'string' }, last_name: { type: 'string' },
    max_duration: { type: 'number', minimum: 3, maximum: 20 },
  }, true);
  const image = makeInspection('minimax', '/v1/image_generation', {
    model: { type: 'string', enum: ['image-01', 'image-01-live'] }, prompt: { type: 'string', maxLength: 1500 },
    n: { type: 'integer', minimum: 1, maximum: 9 }, aspect_ratio: { type: 'string' },
  });
  const search = makeInspection('context.dev', '/web/search', {
    query: { type: 'string' }, numResults: { type: 'integer', minimum: 10, maximum: 100 },
    country: { type: 'string' }, freshness: { type: 'string' },
  });
  const args = (detail: typeof hunter, payload: unknown, query = false) => ({
    provider: detail.provider, endpoint: detail.endpoint, [query ? 'query' : 'input']: payload,
  });

  it('reserves one result for a scalar Hunter identity, including LinkedIn-only lookup', () => {
    for (const identity of [
      { domain: 'example.com', full_name: 'Example Person' },
      { company: 'Example', first_name: 'Example', last_name: 'Person', max_duration: 10 },
      { linkedin_handle: 'example-person' },
    ]) expect(evaluateMonidSpendLimit(hunter, args(hunter, identity, true), 0.01))
      .toEqual({ allowed: true, projectedMaxUsd: 0.01 });
    expect(evaluateMonidSpendLimit(hunter, args(hunter, { linkedin_handle: 'example' }, true), 0.009).allowed).toBe(false);
  });

  it('rejects Hunter batches, incomplete identities, invented limits and alternate payloads', () => {
    for (const identity of [
      [{ linkedin_handle: 'example' }], { linkedin_handle: ['one', 'two'] },
      { domain: 'example.com' }, { first_name: 'Only' }, { full_name: ' ' },
      { linkedin_handle: 'example', maxItems: 1 }, { linkedin_handle: 'example', reveal_phone: true },
      { linkedin_handle: 'example', max_duration: 21 },
    ]) expect(evaluateMonidSpendLimit(hunter, args(hunter, identity, true)).allowed).toBe(false);
    expect(evaluateMonidSpendLimit(hunter, { ...args(hunter, { linkedin_handle: 'example' }, true), input: { maxItems: 1 } }).allowed).toBe(false);
  });

  it('uses the actual MiniMax n and Context numResults, including multi-result cap checks', () => {
    expect(evaluateMonidSpendLimit(image, args(image, { model: 'image-01', prompt: 'Blue square', n: 3 }), 0.03))
      .toEqual({ allowed: true, projectedMaxUsd: 0.03 });
    expect(evaluateMonidSpendLimit(image, args(image, { model: 'image-01', prompt: 'Blue square', n: 3 }), 0.02).allowed).toBe(false);
    expect(evaluateMonidSpendLimit(search, args(search, { query: 'music', numResults: 10 }), 0.10))
      .toEqual({ allowed: true, projectedMaxUsd: 0.10 });
    expect(evaluateMonidSpendLimit(search, args(search, { query: 'music', numResults: 20 }), 0.10).allowed).toBe(false);
  });

  it('rejects malformed counts, fan-out and unsupported image options without generic-limit fallback', () => {
    for (const n of [undefined, 0, 10, 1.5, '1', [1], NaN, Infinity]) {
      expect(evaluateMonidSpendLimit(image, args(image, { model: 'image-01', prompt: 'Blue square', n })).allowed).toBe(false);
    }
    expect(evaluateMonidSpendLimit(image, args(image, { model: 'image-01', prompt: 'Blue square', n: 0, limit: 1 })).allowed).toBe(false);
    for (const numResults of [undefined, 0, 9, 101, 10.5, '10', [10]]) {
      expect(evaluateMonidSpendLimit(search, args(search, { query: 'music', numResults })).allowed).toBe(false);
    }
    for (const payload of [
      { query: ['music', 'art'], numResults: 10 }, { query: 'music', numResults: 10, queryFanOut: true },
      { query: 'music', numResults: 10, maxItems: 1 },
    ]) expect(evaluateMonidSpendLimit(search, args(search, payload)).allowed).toBe(false);
    expect(evaluateMonidSpendLimit(image, args(image, { model: 'image-01', prompt: 'Blue square', n: 1, subject_reference: [{}] })).allowed).toBe(false);
  });

  it('requires the fresh matching input contract and does not bless count aliases for other endpoints', () => {
    const run = args(image, { model: 'image-01', prompt: 'Blue square', n: 1 });
    expect(evaluateMonidSpendLimit({ price: image.price }, run).allowed).toBe(false);
    expect(evaluateMonidSpendLimit({ ...image, input: { bodyType: 'json', body: { type: 'object', properties: {} } } }, run).allowed).toBe(false);
    expect(evaluateMonidSpendLimit({ ...image, input: { ...image.input, queryParams: { required: ['batch'] } } }, run).allowed).toBe(false);
    expect(evaluateMonidSpendLimit({ ...image, input: { ...image.input, body: { ...image.input.body, required: ['new_batch'] } } }, run).allowed).toBe(false);
    expect(evaluateMonidSpendLimit(image, { ...run, endpoint: '/different-image' }).allowed).toBe(false);
    expect(evaluateMonidSpendLimit(search, { ...args(search, { query: 'music', numResults: 10 }), provider: 'other' }).allowed).toBe(false);
    expect(evaluateMonidSpendLimit({ content: [{ type: 'text', text: JSON.stringify(image) }] }, run))
      .toEqual({ allowed: true, projectedMaxUsd: 0.01 });
  });

  it('keeps complex pricing blocked even when an exact pin is bounded', () => {
    for (const type of ['TIERED', 'PER_UNIT', 'PER_UNIT_MATRIX', 'UNKNOWN']) {
      expect(evaluateMonidSpendLimit({ ...image, price: { ...image.price, type, amount: { value: 0, currency: 'USD' } } },
        args(image, { model: 'image-01', prompt: 'Blue square', n: 1 })).allowed).toBe(false);
    }
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
