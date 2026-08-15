import { describe, expect, test } from 'bun:test';
import { createDefaultServerConfig } from '../server-config.ts';

describe('product-specific embedded server defaults', () => {
  test('uses the selected product port without changing server-mode semantics', () => {
    expect(createDefaultServerConfig(9100)).toEqual({ enabled: false, port: 9100 });
    expect(createDefaultServerConfig(9200)).toEqual({ enabled: false, port: 9200 });
  });
});
