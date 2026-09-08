import test from 'node:test';
import assert from 'node:assert/strict';
import { bindAvatar } from './bind-avatar.mjs';
import { MORPH_NAMES } from './facial-controller.mjs';

class QuaternionStub {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.set(x, y, z, w); }
  set(x, y, z, w) { Object.assign(this, { x, y, z, w }); return this; }
}
const quaternionArray = q => [q.x, q.y, q.z, q.w];
const mesh = (names = MORPH_NAMES, value = 0) => ({ name: 'face', morphTargetDictionary: Object.fromEntries(names.map((name, i) => [name, i])), morphTargetInfluences: names.map(() => value) });
const eye = (name, q = new QuaternionStub()) => ({ isBone: true, name, quaternion: q });
const root = objects => ({ traversals: 0, traverse(fn) { this.traversals++; objects.forEach(fn); } });
const pose = (morphs = {}, gaze = {}) => ({ morphs, gaze });
const complete = () => [mesh(), eye('eyeLeft'), eye('eyeRight')];
const close = (actual, expected) => actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-12, `${value} vs ${expected[index]}`));

test('binds matching targets on all meshes once, applies by index, preserves unrelated shapes', () => {
  const a = mesh([...MORPH_NAMES, 'unrelated']);
  a.morphTargetInfluences[MORPH_NAMES.length] = 0.7;
  const b = mesh(['blinkLeft', 'viseme_aa'].reverse());
  const avatar = root([a, b, eye('eyeLeft'), eye('eyeRight')]);
  const bound = bindAvatar(avatar);
  assert.equal(bound.report.morphBindingCount, MORPH_NAMES.length + 2);
  assert.deepEqual(bound.report.missingMorphs, []);
  bound.apply(pose({ viseme_aa: 0.8, blinkLeft: 1 }));
  for (const object of [a, b]) {
    assert.equal(object.morphTargetInfluences[object.morphTargetDictionary.viseme_aa], 0.8);
    assert.equal(object.morphTargetInfluences[object.morphTargetDictionary.blinkLeft], 1);
  }
  assert.equal(a.morphTargetInfluences[MORPH_NAMES.length], 0.7);
  bound.apply(pose()); assert.equal(avatar.traversals, 1);
  assert.equal(a.morphTargetInfluences[0], 0);
});

test('strict validation reports missing controls before any mutation; permissive mode exposes gaps', () => {
  const partial = mesh(['blinkLeft'], 0.6);
  assert.throws(() => bindAvatar(root([partial])), /Incomplete avatar rig/);
  assert.deepEqual(partial.morphTargetInfluences, [0.6]);
  const binding = bindAvatar(root([partial]), { strict: false });
  assert.equal(binding.report.missingMorphs.length, MORPH_NAMES.length - 1);
  assert.deepEqual(binding.report.missingEyes, ['eyeLeft', 'eyeRight']);
  assert.match(binding.report.gazeCalibration, /unverified/);
  binding.apply(pose({ blinkLeft: 1 })); assert.equal(partial.morphTargetInfluences[0], 1);
});

test('authored eye rest is composed with local offsets rather than overwritten or accumulated', () => {
  // Rest = 90 degrees around X. Local Z yaw becomes world -Y.
  const rest = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
  const left = eye('eyeLeft', new QuaternionStub(...rest));
  const right = eye('eyeRight', new QuaternionStub(...rest));
  const bound = bindAvatar(root([mesh(), left, right]), { maxYawRadians: 0.4 });
  const input = pose({}, { x: 1, y: 0 });
  bound.apply(input);
  const expected = [Math.SQRT1_2 * Math.cos(0.2), -Math.SQRT1_2 * Math.sin(0.2), Math.SQRT1_2 * Math.sin(0.2), Math.SQRT1_2 * Math.cos(0.2)];
  close(quaternionArray(left.quaternion), expected);
  close(quaternionArray(right.quaternion), expected);
  for (let i = 0; i < 1000; i++) bound.apply(input);
  close(quaternionArray(left.quaternion), expected);
  bound.apply(pose()); assert.deepEqual(quaternionArray(left.quaternion), rest);
});

test('configurable axes and limits clamp gaze and normalize axes without mutating options', () => {
  const left = eye('left-custom'); const right = eye('right-custom');
  const yawAxis = [0, -5, 0];
  const bound = bindAvatar(root([mesh(), left, right]), { eyeNames: { left: 'left-custom', right: 'right-custom' }, yawAxis, pitchAxis: [1, 0, 0], maxYawRadians: 0.6, maxPitchRadians: 0.2 });
  bound.apply(pose({}, { x: 9, y: NaN }));
  close(quaternionArray(left.quaternion), [0, -Math.sin(0.3), 0, Math.cos(0.3)]);
  assert.deepEqual(yawAxis, [0, -5, 0]);
  yawAxis[1] = 5; bound.apply(pose({}, { x: 9, y: NaN }));
  close(quaternionArray(left.quaternion), [0, -Math.sin(0.3), 0, Math.cos(0.3)]);
  bound.apply(pose({}, { y: -9 }));
  close(quaternionArray(right.quaternion), [-Math.sin(0.1), 0, 0, Math.cos(0.1)]);
});

test('root/head transforms remain untouched and neutral reset restores exact authored eye quaternions', () => {
  const objects = complete();
  const head = eye('head', new QuaternionStub(0, 0.1, 0, Math.sqrt(0.99)));
  const initial = quaternionArray(head.quaternion);
  const bound = bindAvatar(root([...objects, head]));
  bound.apply(pose({ blinkLeft: 1 }, { x: 1, y: 1 }));
  assert.deepEqual(quaternionArray(head.quaternion), initial);
  bound.reset();
  assert.ok(objects[0].morphTargetInfluences.every(value => value === 0));
  assert.deepEqual(quaternionArray(objects[1].quaternion), [0, 0, 0, 1]);
});

test('dispose restores pre-bind morphs and eye rest, is idempotent and prevents future writes', () => {
  const objects = complete(); objects[0].morphTargetInfluences.fill(0.2);
  const bound = bindAvatar(root(objects));
  bound.apply(pose({ viseme_aa: 1 }, { x: 1 })); bound.dispose(); bound.dispose();
  assert.ok(objects[0].morphTargetInfluences.every(value => value === 0.2));
  assert.deepEqual(quaternionArray(objects[1].quaternion), [0, 0, 0, 1]);
  assert.equal(bound.apply(pose({ viseme_aa: 1 })), false); assert.equal(bound.reset(), false);
  assert.ok(objects[0].morphTargetInfluences.every(value => value === 0.2));
});

test('malformed bindings, ambiguous eyes and degenerate options fail before mutation', () => {
  const invalidMesh = mesh(); invalidMesh.morphTargetDictionary.viseme_aa = 999;
  assert.throws(() => bindAvatar(root([invalidMesh])), /Invalid morph binding/);
  const aliased = mesh(); aliased.morphTargetDictionary.viseme_E = 0;
  assert.throws(() => bindAvatar(root([aliased])), /Aliased facial morph/);
  assert.throws(() => bindAvatar(root([...complete(), eye('eyeLeft')])), /Ambiguous eye/);
  for (const options of [{ yawAxis: [0, 0, 0] }, { yawAxis: [NaN, 0, 1] }, { yawAxis: [1, 0, 0] }, { maxYawRadians: -1 }, { maxPitchRadians: Infinity }]) {
    assert.throws(() => bindAvatar(root(complete()), options));
  }
});

test('null stale pose is ignored; invalid and excessive weights cannot poison influences', () => {
  const objects = complete(); const bound = bindAvatar(root(objects));
  assert.equal(bound.apply(null), false);
  bound.apply(pose({ viseme_aa: Infinity, blinkLeft: 4, blinkRight: -2 }));
  assert.ok(objects[0].morphTargetInfluences.every(Number.isFinite));
  assert.equal(objects[0].morphTargetInfluences[objects[0].morphTargetDictionary.blinkLeft], 1);
  assert.equal(objects[0].morphTargetInfluences[objects[0].morphTargetDictionary.blinkRight], 0);
});
