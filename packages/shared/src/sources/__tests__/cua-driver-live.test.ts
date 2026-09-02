import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

import {
  CUA_DRIVER_GUIDE_TOOL_NAMES,
  getCuaDriverMcpPath,
} from '../builtin-sources.ts';

const runLiveContract = process.env.CRAFT_TEST_CUA_DRIVER_LIVE === '1';

describe.skipIf(!runLiveContract)('installed cua-driver contract', () => {
  test('exposes every tool taught by the workflow guide', () => {
    const binaryPath = getCuaDriverMcpPath();
    expect(binaryPath).not.toBeNull();

    const result = spawnSync(binaryPath!, ['list-tools'], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);

    const exposedTools = new Set(
      result.stdout
        .split('\n')
        .map((line) => line.match(/^([a-z][a-z0-9_]*)\s*:/)?.[1])
        .filter((toolName): toolName is string => Boolean(toolName)),
    );

    for (const toolName of CUA_DRIVER_GUIDE_TOOL_NAMES) {
      expect(exposedTools.has(toolName)).toBe(true);
    }
  });
});
