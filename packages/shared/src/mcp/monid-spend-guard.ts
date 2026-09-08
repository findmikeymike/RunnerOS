import { DEFAULT_MONID_SINGLE_CALL_CAP_USD } from './monid-budget.ts';

export const MONID_MAX_RUN_COST_USD = DEFAULT_MONID_SINGLE_CALL_CAP_USD;

export type MonidSpendDecision =
  | { allowed: true; projectedMaxUsd: number }
  | { allowed: false; reason: string };

interface MonidPrice {
  type: string;
  amount: number;
  flatFee?: number;
  currency: string;
}

function parseJsonText(value: string): unknown {
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function findPrice(value: unknown, seen = new Set<unknown>()): MonidPrice | null {
  if (typeof value === 'string') return findPrice(parseJsonText(value), seen);
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);

  const record = value as Record<string, unknown>;
  if (record.price && typeof record.price === 'object') {
    const price = record.price as Record<string, unknown>;
    const money = price.amount && typeof price.amount === 'object' ? price.amount as Record<string, unknown> : null;
    const amount = money ? money.value : price.amount;
    const currency = money ? money.currency : price.currency;
    const fee = price.flatFee && typeof price.flatFee === 'object' ? price.flatFee as Record<string, unknown> : null;
    const flatFee = fee ? fee.value : price.flatFee ?? undefined;
    if (flatFee !== undefined && (typeof flatFee !== 'number' || !Number.isFinite(flatFee) || flatFee < 0
      || (fee && fee.currency !== currency))) return null;
    if (
      typeof price.type === 'string' &&
      typeof amount === 'number' &&
      Number.isFinite(amount) &&
      typeof currency === 'string'
    ) {
      return {
        type: price.type,
        amount,
        flatFee: flatFee as number | undefined,
        currency,
      };
    }
  }

  for (const child of Object.values(record)) {
    const found = findPrice(child, seen);
    if (found) return found;
  }
  return null;
}

const RESULT_BOUND_KEY = /^(?:limit|max(?:items|results|records|reviews|posts|profiles|rows|count)|pageSize)$/i;

function findConservativeResultBound(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const bounds: number[] = [];

  const visit = (current: unknown): void => {
    if (!current || typeof current !== 'object') return;
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      if (RESULT_BOUND_KEY.test(key) && typeof child === 'number' && Number.isInteger(child) && child > 0) {
        bounds.push(child);
      } else if (child && typeof child === 'object') {
        visit(child);
      }
    }
  };
  visit(value);

  if (bounds.length === 0) return null;
  return bounds.reduce((total, bound) => total * bound, 1);
}

function roundUsd(value: number): number {
  const micros = value * 1_000_000;
  return Math.ceil(micros - Number.EPSILON * Math.abs(micros)) / 1_000_000;
}

function pinnedTranscriptBound(args: Record<string, unknown>): number | null {
  if (args.provider !== 'apify' || args.endpoint !== '/starvibe/youtube-video-transcript') return null;
  const input = args.input as Record<string, unknown> | undefined;
  if (!input || Object.keys(input).some(key => !['youtube_url', 'language'].includes(key))
    || input.language !== 'en' || typeof input.youtube_url !== 'string'
    || !/^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(input.youtube_url)) return null;
  return 1;
}

type JsonObject = Record<string, unknown>;

function object(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function inspectedEndpoint(value: unknown, provider: unknown, endpoint: unknown): JsonObject | null {
  if (typeof value === 'string') return inspectedEndpoint(parseJsonText(value), provider, endpoint);
  if (!value || typeof value !== 'object') return null;
  if (object(value) && value.provider === provider && value.endpoint === endpoint && object(value.input)) return value;
  for (const child of Object.values(value)) {
    const found = inspectedEndpoint(child, provider, endpoint);
    if (found) return found;
  }
  return null;
}

// These are deliberately narrow documented contracts, not generic count aliases.
// Hunter: https://hunter.io/api-documentation (Email Finder: one identity).
// MiniMax: https://platform.minimax.io/docs/api-reference/image-generation-t2i (n: 1–9).
// Context: https://monid.ai/blog/guides/openrouter-mcp-server-tool-layer (numResults: 10–100).
function pinnedMarketplaceBound(inspection: unknown, args: JsonObject): number | null | undefined {
  const hunter = args.provider === 'hunterio' && args.endpoint === '/email-finder';
  const image = args.provider === 'minimax' && args.endpoint === '/v1/image_generation';
  const search = args.provider === 'context.dev' && args.endpoint === '/web/search';
  if (!hunter && !image && !search) return undefined;

  const detail = inspectedEndpoint(inspection, args.provider, args.endpoint);
  const contract = detail?.input as JsonObject | undefined;
  const payload = hunter ? args.query : args.input;
  const schema = hunter ? contract?.queryParams : contract?.body;
  if (!contract || !object(payload) || !object(schema) || schema.type !== 'object' || !object(schema.properties)) return null;
  if (!hunter && contract.bodyType !== 'json') return null;
  // Never infer a bound from an alternate body, path, batch or unknown option.
  for (const place of hunter ? ['input', 'path'] : ['query', 'path']) {
    if (args[place] !== undefined && (!object(args[place]) || Object.keys(args[place]).length > 0)) return null;
  }
  for (const place of hunter ? ['body', 'pathParams'] : ['queryParams', 'pathParams']) {
    const other = contract[place];
    if (object(other) && Array.isArray(other.required) && other.required.length > 0) return null;
  }
  const allowed = hunter
    ? ['domain', 'company', 'linkedin_handle', 'first_name', 'last_name', 'full_name', 'max_duration']
    : image
      ? ['model', 'prompt', 'n', 'aspect_ratio', 'response_format', 'prompt_optimizer', 'seed']
      : ['query', 'numResults', 'country', 'freshness'];
  if (Object.keys(payload).some(key => !allowed.includes(key))) return null;
  if (schema.required !== undefined && (!Array.isArray(schema.required)
    || schema.required.some(key => typeof key !== 'string' || !Object.hasOwn(payload, key)))) return null;
  for (const [key, value] of Object.entries(payload)) {
    const field = schema.properties[key];
    if (!object(field)) return null;
    if (field.type === 'string') {
      if (typeof value !== 'string' || !value.trim()) return null;
      if (typeof field.minLength === 'number' && value.length < field.minLength) return null;
      if (typeof field.maxLength === 'number' && value.length > field.maxLength) return null;
    } else if (field.type === 'number' || field.type === 'integer') {
      if (typeof value !== 'number' || !Number.isFinite(value) || (field.type === 'integer' && !Number.isInteger(value))) return null;
      if (typeof field.minimum === 'number' && value < field.minimum) return null;
      if (typeof field.maximum === 'number' && value > field.maximum) return null;
    } else if (field.type !== 'boolean' || typeof value !== 'boolean') return null;
    if (Array.isArray(field.enum) && !field.enum.includes(value)) return null;
  }
  const text = (key: string): boolean => typeof payload[key] === 'string' && !!(payload[key] as string).trim();
  if (hunter) {
    if (!text('linkedin_handle') && !((text('domain') || text('company'))
      && (text('full_name') || text('first_name') && text('last_name')))) return null;
    if (payload.max_duration !== undefined && (typeof payload.max_duration !== 'number'
      || payload.max_duration < 3 || payload.max_duration > 20)) return null;
    return 1;
  }
  const count = image ? payload.n : payload.numResults;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < (image ? 1 : 10) || count > (image ? 9 : 100)) return null;
  if (image && (!['image-01', 'image-01-live'].includes(payload.model as string) || !text('prompt'))) return null;
  if (search && !text('query')) return null;
  return count;
}

export function evaluateMonidSpendLimit(
  inspectResult: unknown,
  runArgs: Record<string, unknown>,
  singleCallCapUsd = DEFAULT_MONID_SINGLE_CALL_CAP_USD,
): MonidSpendDecision {
  if (!Number.isFinite(singleCallCapUsd) || singleCallCapUsd < 0) return { allowed: false, reason: 'Monid run blocked: invalid single-call cap.' };
  const price = findPrice(inspectResult);
  if (!price) {
    return { allowed: false, reason: 'Monid run blocked: inspect returned no verifiable price.' };
  }
  if (price.currency.toUpperCase() !== 'USD' || price.amount < 0) {
    return { allowed: false, reason: 'Monid run blocked: pricing is not a verifiable non-negative USD amount.' };
  }

  let projectedMaxUsd: number;
  if (price.type.toUpperCase() === 'PER_CALL') {
    projectedMaxUsd = price.amount + (price.flatFee ?? 0);
  } else if (price.type.toUpperCase() === 'PER_RESULT') {
    const marketplaceBound = pinnedMarketplaceBound(inspectResult, runArgs);
    const resultBound = marketplaceBound !== undefined ? marketplaceBound
      : runArgs.provider === 'apify' && runArgs.endpoint === '/starvibe/youtube-video-transcript'
        ? pinnedTranscriptBound(runArgs) : findConservativeResultBound(runArgs.input);
    if (!resultBound) {
      return {
        allowed: false,
        reason: 'Monid run blocked: per-result pricing requires a bounded result count such as maxItems or limit.',
      };
    }
    projectedMaxUsd = (price.flatFee ?? 0) + (price.amount * resultBound);
  } else {
    return { allowed: false, reason: `Monid run blocked: unsupported price model ${price.type}.` };
  }

  projectedMaxUsd = roundUsd(projectedMaxUsd);
  if (projectedMaxUsd > singleCallCapUsd) {
    return {
      allowed: false,
      reason: `Monid run blocked: projected maximum $${projectedMaxUsd.toFixed(2)} exceeds the $${singleCallCapUsd.toFixed(2)} single-call cap.`,
    };
  }
  return { allowed: true, projectedMaxUsd };
}

export function extractMonidActualCostUsd(runResult: unknown): number | undefined {
  const visit = (value: unknown, seen = new Set<unknown>()): number | undefined => {
    if (typeof value === 'string') return visit(parseJsonText(value), seen);
    if (!value || typeof value !== 'object' || seen.has(value)) return undefined;
    seen.add(value);
    const record = value as Record<string, unknown>;
    if (record.cost && typeof record.cost === 'object') {
      const cost = record.cost as Record<string, unknown>;
      if (typeof cost.value === 'number' && Number.isFinite(cost.value) && cost.value >= 0) return cost.value;
    }
    for (const child of Object.values(record)) {
      const found = visit(child, seen);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return visit(runResult);
}
