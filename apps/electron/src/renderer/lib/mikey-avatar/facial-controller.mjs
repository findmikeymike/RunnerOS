// Portable pose evaluation only. The host owns speech playback and its cursor.
export const VISEME_MAP = Object.freeze({
  aei: Object.freeze({ viseme_aa: 1 }), o: Object.freeze({ viseme_O: 1 }),
  ee: Object.freeze({ viseme_E: 1 }), bmp: Object.freeze({ viseme_PP: 1 }),
  fv: Object.freeze({ viseme_FF: 1 }), l: Object.freeze({ viseme_nn: 1 }),
  r: Object.freeze({ viseme_RR: 1 }), th: Object.freeze({ viseme_TH: 1 }),
  qw: Object.freeze({ viseme_U: 1 }), chjsh: Object.freeze({ viseme_CH: 1 }),
  cdgknstxyz: Object.freeze({ viseme_DD: 0.65 }),
});
export const MORPH_NAMES = Object.freeze([
  'viseme_aa', 'viseme_E', 'viseme_O', 'viseme_PP', 'viseme_FF', 'viseme_nn',
  'viseme_RR', 'viseme_TH', 'viseme_U', 'viseme_CH', 'viseme_DD',
  'blinkLeft', 'blinkRight', 'browInnerUp', 'mouthSmileLeft', 'mouthSmileRight',
]);
const SILENCE = new Set(['sil', 'silence', 'sp', 'spn', 'pau', '<sil>', '[sil]', '_']);
const FACE = ['blinkLeft', 'blinkRight', 'browInnerUp', 'mouthSmileLeft', 'mouthSmileRight'];
const unit = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const gazeUnit = value => Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
const neutral = () => Object.fromEntries(MORPH_NAMES.map(name => [name, 0]));
const symbol = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const isGeneration = value => Number.isSafeInteger(value) && value >= 0;
const validTime = value => Number.isFinite(value) && value >= 0;
const mappedPose = cue => cue.isSilence === true || SILENCE.has(symbol(cue.phoneSymbol))
  ? null : (Object.hasOwn(VISEME_MAP, symbol(cue.visemeSymbol)) ? VISEME_MAP[symbol(cue.visemeSymbol)] : null);

/** Timings use seconds relative to the SAME generation origin as consumedSeconds. */
export class FacialController {
  #generation = null;
  #lastGeneration = -1;
  #cursor = 0;
  #cues = [];
  #maxCues;
  #maxFutureSeconds;
  #blendSeconds;

  constructor({ maxCues = 512, maxFutureSeconds = 30, blendSeconds = 0.025 } = {}) {
    if (!Number.isSafeInteger(maxCues) || maxCues < 1 || maxCues > 4096) throw new RangeError('maxCues must be 1..4096');
    if (!Number.isFinite(maxFutureSeconds) || maxFutureSeconds <= 0 || maxFutureSeconds > 120) throw new RangeError('maxFutureSeconds must be >0 and <=120');
    if (!Number.isFinite(blendSeconds) || blendSeconds < 0 || blendSeconds > 0.1) throw new RangeError('blendSeconds must be 0..0.1');
    this.#maxCues = maxCues;
    this.#maxFutureSeconds = maxFutureSeconds;
    this.#blendSeconds = blendSeconds;
  }

  /** Generation IDs must strictly increase, including after Stop. */
  beginGeneration(generationId) {
    if (!isGeneration(generationId) || generationId <= this.#lastGeneration) throw new RangeError('Use a new increasing generationId');
    this.#lastGeneration = generationId;
    this.#generation = generationId;
    this.#cursor = 0;
    this.#cues = [];
  }

  /** Stale Stop events cannot stop a newer turn. Apply the returned neutral pose. */
  stop(generationId) {
    if (generationId !== this.#generation || this.#generation === null) return null;
    this.#generation = null;
    this.#cues = [];
    this.#cursor = 0;
    return { generationId, morphs: neutral(), gaze: { x: 0, y: 0 }, active: false };
  }

  /** Batches are copied and accepted atomically; callers own retry/backpressure. */
  enqueue(generationId, cues) {
    if (generationId !== this.#generation || this.#generation === null) return { accepted: false, reason: 'stale-generation' };
    if (!Array.isArray(cues) || cues.length > this.#maxCues) return { accepted: false, reason: 'invalid-batch' };
    const copy = [];
    for (const cue of cues) {
      if (!cue || !validTime(cue.startSeconds) || !validTime(cue.endSeconds) || cue.endSeconds <= cue.startSeconds) return { accepted: false, reason: 'invalid-timing' };
      if (cue.endSeconds <= this.#cursor) continue;
      if (cue.endSeconds > this.#cursor + this.#maxFutureSeconds) return { accepted: false, reason: 'future-limit' };
      copy.push({ startSeconds: cue.startSeconds, endSeconds: cue.endSeconds, pose: mappedPose(cue) });
    }
    // Retain one predecessor within the blend window for continuous transitions.
    const existing = this.#cues.filter(cue => cue.endSeconds > this.#cursor - this.#blendSeconds);
    const merged = [...existing, ...copy].sort((a, b) => a.startSeconds - b.startSeconds);
    if (merged.length > this.#maxCues) return { accepted: false, reason: 'capacity' };
    for (let i = 1; i < merged.length; i++) {
      if (merged[i].startSeconds < merged[i - 1].endSeconds) return { accepted: false, reason: 'overlap' };
    }
    this.#cues = merged;
    return { accepted: true, count: copy.length };
  }

  /** Returns null for stale/invalid cursor samples: the host must not apply them. */
  sample({ generationId, consumedSeconds, playbackState, controls = {}, gaze = {} }) {
    if (generationId !== this.#generation || this.#generation === null) return null;
    if (!validTime(consumedSeconds) || consumedSeconds < this.#cursor) return null;
    if (!['playing', 'paused', 'underrun', 'stopped'].includes(playbackState)) throw new TypeError('Explicit playbackState required');
    if (playbackState === 'stopped') return this.stop(generationId);
    this.#cursor = consumedSeconds;
    this.#cues = this.#cues.filter(cue => cue.endSeconds > consumedSeconds - this.#blendSeconds);
    const morphs = neutral();
    for (const name of FACE) morphs[name] = unit(controls[name]);
    if (playbackState === 'playing') this.#speechPose(consumedSeconds, morphs);
    return { generationId, morphs, gaze: { x: gazeUnit(gaze.x), y: gazeUnit(gaze.y) }, active: playbackState === 'playing' };
  }

  get status() { return { generationId: this.#generation, consumedSeconds: this.#cursor, queuedCues: this.#cues.length }; }

  #speechPose(time, morphs) {
    const index = this.#cues.findIndex(cue => cue.startSeconds <= time && cue.endSeconds > time);
    const current = this.#cues[index];
    if (!current?.pose) return; // Silence, gaps and unknown groups always close.
    const previous = this.#cues[index - 1];
    const next = this.#cues[index + 1];
    const duration = current.endSeconds - current.startSeconds;
    const blend = Math.min(this.#blendSeconds, duration / 2);
    const add = (pose, amount) => { for (const [name, weight] of Object.entries(pose)) morphs[name] += weight * amount; };
    if (blend === 0) { add(current.pose, 1); return; }
    const previousBlend = previous?.pose && previous.endSeconds === current.startSeconds
      ? Math.min(blend, (previous.endSeconds - previous.startSeconds) / 2) : 0;
    const nextBlend = next?.pose && current.endSeconds === next.startSeconds
      ? Math.min(blend, (next.endSeconds - next.startSeconds) / 2) : 0;
    if (previousBlend && time < current.startSeconds + previousBlend) {
      const alpha = 0.5 + (time - current.startSeconds) / (2 * previousBlend);
      add(previous.pose, 1 - alpha); add(current.pose, alpha);
    } else if (nextBlend && time > current.endSeconds - nextBlend) {
      const alpha = 0.5 - (current.endSeconds - time) / (2 * nextBlend);
      add(current.pose, 1 - alpha); add(next.pose, alpha);
    } else {
      const attack = previousBlend ? 1 : unit((time - current.startSeconds) / blend);
      const release = nextBlend ? 1 : unit((current.endSeconds - time) / blend);
      add(current.pose, Math.min(attack, release));
    }
  }
}
