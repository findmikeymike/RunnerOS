import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parsePermissionsJson } from '../permissions-config.ts';

describe('Monid default Explore permissions', () => {
  it('allows only Monid discovery, not paid execution', () => {
    const path = resolve(import.meta.dir, '../../../../../apps/electron/resources/permissions/default.json');
    const config = parsePermissionsJson(readFileSync(path, 'utf8'));
    const patterns = config.allowedMcpPatterns.map((pattern) => new RegExp(pattern));

    expect(patterns.some((pattern) => pattern.test('mcp__monid__discover'))).toBe(true);
    expect(patterns.some((pattern) => pattern.test('mcp__monid__run'))).toBe(false);
  });
});
