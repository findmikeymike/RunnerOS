import { MORPH_NAMES } from './facial-controller.mjs';

const clamp = (value, low, high) => Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : 0;
const copyQuaternion = quaternion => ({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w });
const multiply = (a, b) => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});
const rotation = (axis, angle) => {
  const sine = Math.sin(angle / 2);
  return { x: axis[0] * sine, y: axis[1] * sine, z: axis[2] * sine, w: Math.cos(angle / 2) };
};
const writeQuaternion = (target, value) => target.set(value.x, value.y, value.z, value.w);
function normalizedAxis(value, label) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) throw new TypeError(`${label} must contain three finite numbers`);
  const length = Math.hypot(...value);
  if (length < 1e-8) throw new RangeError(`${label} must be nonzero`);
  return value.map(component => component / length);
}

/** Bind an already-loaded Three.js-compatible Object3D. No loader or runtime dependency. */
export function bindAvatar(root, {
  strict = true,
  eyeNames = { left: 'eyeLeft', right: 'eyeRight' },
  // Candidate axes for eye bones whose local +Y is forward. VISUALLY UNVERIFIED.
  yawAxis = [0, 0, 1],
  pitchAxis = [1, 0, 0],
  maxYawRadians = 0.25,
  maxPitchRadians = 0.15,
} = {}) {
  if (!root || typeof root.traverse !== 'function') throw new TypeError('root must support Object3D.traverse');
  if (!eyeNames || typeof eyeNames.left !== 'string' || typeof eyeNames.right !== 'string' || !eyeNames.left || !eyeNames.right || eyeNames.left === eyeNames.right) throw new TypeError('Use distinct, nonempty eye bone names');
  const yaw = normalizedAxis(yawAxis, 'yawAxis');
  const pitch = normalizedAxis(pitchAxis, 'pitchAxis');
  if (Math.abs(yaw.reduce((sum, value, i) => sum + value * pitch[i], 0)) > 0.999) throw new RangeError('Gaze axes must not be parallel');
  for (const angle of [maxYawRadians, maxPitchRadians]) {
    if (!Number.isFinite(angle) || angle < 0 || angle > Math.PI / 2) throw new RangeError('Gaze limits must be 0..PI/2 radians; flip an axis to reverse direction');
  }

  const bindings = [];
  const eyes = [];
  const found = new Set();
  const eyeMatches = new Map([[eyeNames.left, []], [eyeNames.right, []]]);
  root.traverse(object => {
    if (object.isBone && eyeMatches.has(object.name)) eyeMatches.get(object.name).push(object);
    const dictionary = object.morphTargetDictionary;
    const influences = object.morphTargetInfluences;
    if (!dictionary || !influences) return;
    const usedIndices = new Set();
    for (const name of MORPH_NAMES) {
      if (!Object.hasOwn(dictionary, name)) continue;
      const index = dictionary[name];
      if (!Number.isInteger(index) || index < 0 || index >= influences.length || !Number.isFinite(influences[index])) throw new TypeError(`Invalid morph binding: ${object.name || 'mesh'}/${name}`);
      if (usedIndices.has(index)) throw new TypeError(`Aliased facial morph index: ${object.name || 'mesh'}/${name}`);
      usedIndices.add(index);
      bindings.push({ influences, index, name, original: influences[index] });
      found.add(name);
    }
  });
  for (const [name, matches] of eyeMatches) {
    if (matches.length > 1) throw new Error(`Ambiguous eye bone name: ${name}`);
    if (!matches.length) continue;
    const quaternion = matches[0].quaternion;
    if (!quaternion || typeof quaternion.set !== 'function' || ![quaternion.x, quaternion.y, quaternion.z, quaternion.w].every(Number.isFinite) || Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w) < 1e-8) throw new TypeError(`Invalid eye quaternion: ${name}`);
    eyes.push({ quaternion, original: copyQuaternion(quaternion) });
  }
  const report = Object.freeze({
    missingMorphs: Object.freeze(MORPH_NAMES.filter(name => !found.has(name))),
    missingEyes: Object.freeze([...eyeMatches].filter(([, matches]) => matches.length === 0).map(([name]) => name)),
    morphBindingCount: bindings.length,
    eyeCount: eyes.length,
    gazeCalibration: 'unverified: calibrate axes and limits against the exported avatar',
  });
  if (strict && (report.missingMorphs.length || report.missingEyes.length)) throw new Error(`Incomplete avatar rig: missing morphs [${report.missingMorphs.join(', ')}]; missing eyes [${report.missingEyes.join(', ')}]`);
  let disposed = false;
  const resetEyes = () => { for (const eye of eyes) writeQuaternion(eye.quaternion, eye.original); };

  return Object.freeze({
    report,
    /** Caller must filter generation IDs through FacialController before this method. */
    apply(pose) {
      if (disposed || pose == null) return false;
      if (!pose.morphs || typeof pose.morphs !== 'object') throw new TypeError('Expected a controller pose with morphs');
      for (const binding of bindings) binding.influences[binding.index] = clamp(pose.morphs[binding.name], 0, 1);
      const x = clamp(pose.gaze?.x, -1, 1);
      const y = clamp(pose.gaze?.y, -1, 1);
      if (x === 0 && y === 0) resetEyes();
      else {
        // Authored rest * local yaw * local pitch. Never accumulate last frame.
        const offset = multiply(rotation(yaw, x * maxYawRadians), rotation(pitch, y * maxPitchRadians));
        for (const eye of eyes) writeQuaternion(eye.quaternion, multiply(eye.original, offset));
      }
      return true;
    },
    /** Reset facial controls to neutral while preserving authored eye rest rotations. */
    reset() {
      if (disposed) return false;
      for (const binding of bindings) binding.influences[binding.index] = 0;
      resetEyes();
      return true;
    },
    /** Restore pre-bind values. Does not dispose meshes, textures, or shared materials. */
    dispose() {
      if (disposed) return;
      for (const binding of bindings) binding.influences[binding.index] = binding.original;
      resetEyes();
      bindings.length = 0;
      eyes.length = 0;
      disposed = true;
    },
  });
}
