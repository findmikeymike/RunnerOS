import { expect, test } from 'bun:test';
import { assertLegacySignalScanSetup } from './legacy-scan-preflight';

test('legacy scans without saved setup fail before execution; unrelated and configured workflows remain available', () => {
  for (const body of [undefined, '', '  ']) expect(() => assertLegacySignalScanSetup('weekly-signal-scan', body)).toThrow('Channels & schedule');
  expect(() => assertLegacySignalScanSetup('signals-industry-scan', undefined)).not.toThrow();
  expect(() => assertLegacySignalScanSetup('custom-workflow', undefined)).not.toThrow();
  expect(() => assertLegacySignalScanSetup('weekly-signal-scan', '{"version":1,"sources":[]}')).not.toThrow();
});
