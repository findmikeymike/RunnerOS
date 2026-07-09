import { createHash } from 'node:crypto';

export function computeApprovalDigest(action, browserPlan) {
  const canonical = JSON.stringify(canonicalize({ action, browserPlan }));
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().flatMap((key) => {
      const item = value[key];
      return item === undefined ? [] : [[key, canonicalize(item)]];
    }));
  }
  return value;
}
