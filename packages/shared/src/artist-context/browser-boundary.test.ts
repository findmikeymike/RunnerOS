import { expect, test } from 'bun:test';
import { join } from 'node:path';

test('artist-context public exports bundle for browsers without server storage or SDKs', async () => {
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, 'index.ts')],
    target: 'browser',
  });

  expect(result.logs.filter((log) => log.level === 'error')).toEqual([]);
  expect(result.success).toBe(true);
});
