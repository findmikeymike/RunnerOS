import { describe, expect, test } from 'bun:test';
import { validateRenderCapabilities } from './render-engine.mjs';

function project(clipFields = {}) {
  return {
    title: 'Capabilities', settings: { width: 320, height: 240, fps: 30 },
    media: [{ id: 'image', type: 'image', path: '/unused/image.png', width: 320, height: 240 }],
    timeline: { durationMs: 1000, tracks: [{ id: 'video', clips: [{ id: 'clip', type: 'image', mediaId: 'image', startMs: 0, durationMs: 1000, ...clipFields }] }] },
    captions: [], effects: [], overlays: [], templates: [],
  };
}

describe('shared renderer capabilities', () => {
  test('accepts composition and finite linear x/y motion', () => {
    const result = validateRenderCapabilities(project({
      crop: { x: 20, y: 10, width: 200, height: 100 },
      transform: { x: 40, y: -30, scale: 0.7, rotateDeg: 25 }, opacity: 0.5,
      keyframes: [{ property: 'x', timeMs: 0, value: -40, easing: 'linear' }, { property: 'x', timeMs: 1000, value: 40 }],
    }));
    expect(result).toEqual({ ok: true, issues: [] });
  });
  test.each([
    { transitionIn: { type: 'crossfade', durationMs: 200 } },
    { transitionOut: { type: 'wipe', durationMs: 200 } },
    { effects: ['blur'] },
    { keyframes: [{ property: 'scale', timeMs: 0, value: 1 }] },
    { keyframes: [{ property: 'x', timeMs: 0, value: 20, easing: 'ease-in' }] },
    { keyframes: [{ property: 'x', timeMs: 1500, value: 20 }] },
    { keyframes: [{ property: 'x', timeMs: 0, value: 20 }, { property: 'x', timeMs: 0, value: 40 }] },
    { crop: { x: 310, y: 0, width: 20, height: 100 } },
    { opacity: 2 },
    { transform: { scale: 0 } },
  ])('rejects unsupported or invalid clip fields %j', (fields) => {
    const result = validateRenderCapabilities(project(fields));
    expect(result.ok).toBe(false);
    expect(result.issues[0].clipId).toBe('clip');
    expect(result.issues[0].message.length).toBeGreaterThan(20);
  });
  test('disabled clips and hidden tracks do not block active exports', () => {
    const disabled = project({ disabled: true, transitionIn: { type: 'wipe', durationMs: 200 } });
    expect(validateRenderCapabilities(disabled).ok).toBe(true);
    disabled.timeline.tracks[0].clips[0].disabled = false;
    disabled.timeline.tracks[0].hidden = true;
    expect(validateRenderCapabilities(disabled).ok).toBe(true);
  });
  test.each(['effects', 'overlays', 'templates'])('rejects unimplemented project %s', (field) => {
    const value = project(); value[field] = [{ id: 'unsupported' }];
    expect(validateRenderCapabilities(value).ok).toBe(false);
  });
});
