import { describe, expect, test } from 'bun:test';
import { handleImportArtistNetwork, importArtistNetworkSchema, type ImportArtistNetworkInput } from './import-artist-network';
import type { SessionToolContext } from '../context';

describe('network import contract', () => {
  test('rejects invalid addresses, arbitrary paths, oversized batches and external side effects', () => {
    for (const input of [
      { people: [{ name: 'Alex', email: 'not-email' }] },
      { people: [{ name: 'Alex', subscribe: true }] },
      { people: [{ name: 'Alex', distinctPersonConfirmed: true }] },
      { people: [{ name: 'Alex' }], workspaceId: 'other' },
      { people: [{ name: 'Alex' }], filePath: '/private/contacts' },
      { people: Array.from({ length: 101 }, () => ({ name: 'Alex' })) },
    ]) expect(importArtistNetworkSchema.safeParse(input).success).toBe(false);
  });
  test('allows supplied notes without inventing missing addresses', () => {
    expect(importArtistNetworkSchema.parse({ people: [{ name: '  Alex  ', notes: 'Met at venue' }] }))
      .toEqual({ people: [{ name: 'Alex', notes: 'Met at venue' }] });
  });
  test('does not call host for invalid input; returns host receipt for valid input', async () => {
    let calls = 0;
    const ctx = { importArtistNetwork: async () => { calls++; return { counts: { added: 1, existing: 0, needsClarification: 0 } }; } } as unknown as SessionToolContext;
    expect((await handleImportArtistNetwork(ctx, { people: [] } as ImportArtistNetworkInput)).isError).toBe(true);
    expect(calls).toBe(0);
    const result = await handleImportArtistNetwork(ctx, { people: [{ name: 'Alex' }] });
    expect(calls).toBe(1);
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('"added":1') });
  });
  test('fails explicitly when unavailable', async () => {
    expect((await handleImportArtistNetwork({} as SessionToolContext, { people: [{ name: 'Alex' }] })).isError).toBe(true);
  });
});
