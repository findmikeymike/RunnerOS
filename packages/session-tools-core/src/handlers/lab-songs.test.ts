import { describe, expect, test } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import { handleSaveLabLyrics } from './lab-songs.ts';

describe('Lab song tools', () => {
  test('requires section target when saving to a song section', async () => {
    const result = await handleSaveLabLyrics({} as SessionToolContext, {
      songTitle: 'Test Song',
      captures: [{ text: 'line one', destination: 'section' }],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('sectionId or sectionLabel');
  });

  test('passes exact selected captures to backend callback', async () => {
    let captured: unknown;
    const ctx = {
      saveLabLyrics: async (input: unknown) => {
        captured = input;
        return { id: 'test-song', title: 'Test Song' };
      },
    } as SessionToolContext;

    const result = await handleSaveLabLyrics(ctx, {
      songTitle: 'Test Song',
      captures: [{
        text: 'only option four',
        selectionLabel: 'option 4',
        destination: 'section',
        sectionLabel: 'Chorus',
      }],
    });

    expect(result.isError).toBe(false);
    expect(captured).toEqual({
      songTitle: 'Test Song',
      captures: [{
        text: 'only option four',
        selectionLabel: 'option 4',
        destination: 'section',
        sectionLabel: 'Chorus',
      }],
    });
  });
});
