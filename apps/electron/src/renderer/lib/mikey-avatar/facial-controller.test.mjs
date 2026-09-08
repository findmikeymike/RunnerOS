import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FacialController, MORPH_NAMES, VISEME_MAP } from './facial-controller.mjs';

const cue = (visemeSymbol, startSeconds = 0, endSeconds = 1, extra = {}) => ({ visemeSymbol, startSeconds, endSeconds, ...extra });
const setup = options => { const controller = new FacialController(options); controller.beginGeneration(1); return controller; };
const sample = (controller, consumedSeconds, playbackState = 'playing', generationId = 1, extra = {}) => controller.sample({ generationId, consumedSeconds, playbackState, ...extra });
const closed = result => MORPH_NAMES.filter(name => name.startsWith('viseme_')).every(name => result.morphs[name] === 0);

test('mapping matches the checked-in provider contract and every group reaches its pose', () => {
  const contract = JSON.parse(readFileSync(new URL('./lip-sync-contract.json', import.meta.url)));
  assert.deepEqual(VISEME_MAP, contract.provider_to_morph);
  for (const [group, expected] of Object.entries(contract.provider_to_morph)) {
    const c = setup(); c.enqueue(1, [cue(group)]);
    const result = sample(c, 0.5);
    for (const name of MORPH_NAMES) assert.equal(result.morphs[name], expected[name] ?? 0);
  }
});

test('mouth follows only consumed speech position; repeated samples never advance', () => {
  const c = setup(); c.enqueue(1, [cue('aei', 1, 2)]);
  assert.ok(closed(sample(c, 0.5)));
  const initial = sample(c, 1.4);
  for (let i = 0; i < 1000; i++) assert.deepEqual(sample(c, 1.4), initial);
  assert.equal(initial.morphs.viseme_aa, 1);
  assert.ok(closed(sample(c, 2)));
});

test('silence phonemes override bmp; unknown groups and explicit silence close', () => {
  for (const input of [cue('bmp', 0, 1, { phoneSymbol: ' SIL ' }), cue('aei', 0, 1, { isSilence: true }), cue('unknown'), cue('__proto__'), cue('constructor')]) {
    const c = setup(); c.enqueue(1, [input]); assert.ok(closed(sample(c, 0.5)));
  }
});

test('adjacent known poses crossfade continuously, without opening silence or gaps', () => {
  const c = setup(); c.enqueue(1, [cue('aei'), cue('o', 1, 2), cue('bmp', 2, 3, { isSilence: true }), cue('ee', 4, 5)]);
  const before = sample(c, 0.999999).morphs;
  const at = sample(c, 1).morphs;
  assert.ok(Math.abs(before.viseme_aa - at.viseme_aa) < 0.0001);
  assert.equal(at.viseme_aa, 0.5); assert.equal(at.viseme_O, 0.5);
  assert.ok(closed(sample(c, 2))); assert.ok(closed(sample(c, 3.5)));
  assert.ok(sample(c, 4.5).morphs.viseme_E === 1);
});

test('paused and underrun immediately close, then resume at the unchanged cursor', () => {
  const c = setup(); c.enqueue(1, [cue('o')]);
  assert.equal(sample(c, 0.4).morphs.viseme_O, 1);
  assert.ok(closed(sample(c, 0.4, 'paused'))); assert.ok(closed(sample(c, 0.4, 'underrun')));
  assert.equal(sample(c, 0.4).morphs.viseme_O, 1);
});

test('Stop invalidates buffers, stale callbacks and reused generation IDs', () => {
  const c = setup(); c.enqueue(1, [cue('aei')]);
  assert.ok(closed(sample(c, 0.4, 'stopped')));
  assert.equal(c.status.queuedCues, 0);
  assert.equal(c.enqueue(1, [cue('o')]).accepted, false);
  assert.equal(sample(c, 0.5), null);
  assert.throws(() => c.beginGeneration(1), RangeError);
  c.beginGeneration(2); c.enqueue(2, [cue('ee')]);
  assert.equal(c.stop(1), null);
  assert.equal(sample(c, 0.2, 'playing', 1), null);
  assert.equal(sample(c, 0.2, 'playing', 2).morphs.viseme_E, 1);
});

test('cursor regression and nonfinite values never corrupt the active generation', () => {
  const c = setup(); c.enqueue(1, [cue('aei')]); sample(c, 0.5);
  for (const bad of [0.4, -1, NaN, Infinity]) assert.equal(sample(c, bad), null);
  assert.equal(c.status.consumedSeconds, 0.5);
  assert.equal(sample(c, 0.6).morphs.viseme_aa, 1);
});

test('bounded queues reject entire batches on malformed timing, overlap, capacity and horizon', () => {
  const c = setup({ maxCues: 2, maxFutureSeconds: 5 });
  assert.equal(c.enqueue(1, [cue('aei')]).accepted, true);
  for (const batch of [[cue('o', 2, 2)], [cue('o', NaN, 2)], [cue('o', 1, 2), cue('ee', 2, 3)], [cue('o', 0.5, 2)], [cue('o', 4, 6)]]) {
    assert.equal(c.enqueue(1, batch).accepted, false); assert.equal(c.status.queuedCues, 1);
  }
  sample(c, 1.1);
  assert.equal(c.status.queuedCues, 0);
  assert.deepEqual(c.enqueue(1, [cue('aei')]), { accepted: true, count: 0 });
  assert.equal(c.enqueue(1, [cue('o', 2, 3)]).accepted, true);
});

test('input arrays, cues and returned poses cannot mutate controller state', () => {
  const c = setup(); const input = [cue('o')]; c.enqueue(1, input);
  input[0].visemeSymbol = 'aei'; input[0].endSeconds = 100; input.push(cue('ee'));
  const first = sample(c, 0.5); first.morphs.viseme_O = 0;
  assert.equal(sample(c, 0.5).morphs.viseme_O, 1);
  assert.ok(closed(sample(c, 1.1)));
});

test('independent blink, expression and gaze controls are clamped and survive pause', () => {
  const c = setup(); c.enqueue(1, [cue('aei')]);
  const result = sample(c, 0.5, 'paused', 1, { controls: { blinkLeft: 2, blinkRight: -2, browInnerUp: NaN, mouthSmileLeft: 0.4, mouthSmileRight: 0.6 }, gaze: { x: -2, y: 0.7 } });
  assert.ok(closed(result)); assert.equal(result.morphs.blinkLeft, 1); assert.equal(result.morphs.blinkRight, 0);
  assert.equal(result.morphs.browInnerUp, 0); assert.equal(result.morphs.mouthSmileLeft, 0.4);
  assert.deepEqual(result.gaze, { x: -1, y: 0.7 });
});

test('short timings remain finite and speech weights stay normalized across transitions', () => {
  const c = setup(); const groups = Object.keys(VISEME_MAP);
  c.enqueue(1, Array.from({ length: 100 }, (_, i) => cue(groups[i % groups.length], i * 0.01, (i + 1) * 0.01)));
  for (let i = 0; i < 1000; i++) {
    const weights = Object.entries(sample(c, i / 1000).morphs).filter(([name]) => name.startsWith('viseme_')).map(([, value]) => value);
    assert.ok(weights.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
    assert.ok(weights.reduce((a, b) => a + b, 0) <= 1.00000000001);
  }
});

test('generation replacement resets cursor and discards old turn shapes', () => {
  const c = setup(); c.enqueue(1, [cue('o')]); sample(c, 0.5);
  c.beginGeneration(2);
  assert.equal(c.status.consumedSeconds, 0); assert.equal(c.status.queuedCues, 0);
  assert.ok(closed(sample(c, 0, 'playing', 2)));
});
