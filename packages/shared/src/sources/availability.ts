import type { LoadedSource } from './types.ts';

/**
 * Check whether a loaded source is enabled and has any required credentials.
 *
 * This module is intentionally side-effect free so renderer code can share the
 * same decision without pulling Node-only source storage into the browser bundle.
 */
export function isSourceUsable(source: LoadedSource): boolean {
  if (!source.config.enabled) return false;

  const authType = source.config.mcp?.authType || source.config.api?.authType;

  // Provider-router local sources represent key-backed external APIs. They do
  // not spawn a server, but they still require at least one configured key.
  if (source.config.type === 'local' && source.config.local?.format === 'provider-router') {
    return source.config.isAuthenticated === true;
  }

  if (authType === 'none' || authType === undefined) return true;

  return source.config.isAuthenticated === true;
}
