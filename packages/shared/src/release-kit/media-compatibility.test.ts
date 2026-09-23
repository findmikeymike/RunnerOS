import { expect, test } from 'bun:test';
import { assertReleaseKitMediaCompatibility as check } from './media-compatibility.ts';

test('restricts media categories using source extension and source-owned MIME', () => {
  for (const path of ['cover.png', 'film.mp4', 'notes.txt', 'plan.pdf']) {
    expect(() => check('audio', path, 'audio/wav')).toThrow(/requires/);
  }
  expect(() => check('artwork', 'song.wav')).toThrow(/requires/);
  expect(() => check('video', 'cover.png')).toThrow(/requires/);
  expect(() => check('audio', 'unknown.bin')).toThrow(/requires/);
  expect(() => check('audio', 'song.wav', 'image/png')).toThrow(/requires/);
});
test('accepts common media, neutral MIME and source-owned MIME for extensionless assets', () => {
  for (const path of ['master.WAV', 'song.aac', 'song.ogg', 'song.opus']) expect(() => check('audio', path, 'application/octet-stream')).not.toThrow();
  expect(() => check('audio', 'asset', 'audio/mpeg')).not.toThrow();
  for (const category of ['artwork', 'images'] as const) {
    for (const path of ['cover.png', 'cover.svg', 'cover.psd']) expect(() => check(category, path)).not.toThrow();
  }
  expect(() => check('video', 'film.mov')).not.toThrow();
});
test('non-media categories remain flexible', () => {
  for (const category of ['documents', 'references', 'merch', 'copy', 'plans'] as const) {
    for (const path of ['song.wav', 'notes.txt', 'plan.pdf', 'custom.asset']) expect(() => check(category, path)).not.toThrow();
  }
});
