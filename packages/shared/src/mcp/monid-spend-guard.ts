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
    const resultBound = runArgs.provider === 'apify' && runArgs.endpoint === '/starvibe/youtube-video-transcript'
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
