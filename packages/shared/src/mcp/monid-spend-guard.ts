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
    if (
      typeof price.type === 'string' &&
      typeof price.amount === 'number' &&
      Number.isFinite(price.amount) &&
      typeof price.currency === 'string'
    ) {
      return {
        type: price.type,
        amount: price.amount,
        flatFee: typeof price.flatFee === 'number' && Number.isFinite(price.flatFee) ? price.flatFee : undefined,
        currency: price.currency,
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
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function evaluateMonidSpendLimit(
  inspectResult: unknown,
  runArgs: Record<string, unknown>,
  singleCallCapUsd = DEFAULT_MONID_SINGLE_CALL_CAP_USD,
): MonidSpendDecision {
  const price = findPrice(inspectResult);
  if (!price) {
    return { allowed: false, reason: 'Monid run blocked: inspect returned no verifiable price.' };
  }
  if (price.currency.toUpperCase() !== 'USD' || price.amount < 0) {
    return { allowed: false, reason: 'Monid run blocked: pricing is not a verifiable non-negative USD amount.' };
  }

  let projectedMaxUsd: number;
  if (price.type.toUpperCase() === 'PER_CALL') {
    projectedMaxUsd = price.amount;
  } else if (price.type.toUpperCase() === 'PER_RESULT') {
    const resultBound = findConservativeResultBound(runArgs.input);
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
