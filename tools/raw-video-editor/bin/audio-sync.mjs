import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export const MASTER_SYNC_SAMPLE_RATE = 4_000;
// Conservative automatic-acceptance floors. These are intentionally stricter
// than "a peak exists": real camera playback must correlate across windows and
// separate clearly from the next-best song position.
export const MASTER_SYNC_MIN_CONFIDENCE = 0.55;
export const MASTER_SYNC_MIN_CORRELATION = 0.26;

const FEATURE_FREQUENCIES = [90, 140, 220, 340, 520, 800, 1_200, 1_700];
const FRAME_SECONDS = 0.08;
const HOP_SECONDS = 0.02;
const WINDOW_SECONDS = 6;
const MIN_WINDOW_SECONDS = 3;
const MAX_WINDOWS = 5;
const MAX_ANCHOR_CANDIDATES = 8;
// Phone/camera clocks normally drift far less than 1%. Anything beyond this is
// treated as a wrong or unstable match instead of being stretched into place.
const MAX_DRIFT_RATE = 0.01;
// Search cost grows with source length. This feature is for songs and ordinary
// performance takes, not hour-scale recordings or DJ mixes.
const MAX_ANALYSIS_SECONDS = 30 * 60;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function quantile(values, q) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(Math.round((sorted.length - 1) * q), 0, sorted.length - 1);
  return sorted[index];
}

function run(command, args) {
  return spawnSync(command, args, { encoding: 'utf-8' });
}

function extractMonoPcm(inputPath, outputPath, sampleRate) {
  const result = run('ffmpeg', [
    '-v', 'error',
    '-y',
    '-i', inputPath,
    '-vn',
    '-ac', '1',
    '-ar', String(sampleRate),
    '-af', `highpass=f=70,lowpass=f=${Math.floor(sampleRate / 2 - 100)}`,
    '-f', 'f32le',
    outputPath,
  ]);
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Could not extract audio from ${inputPath}`);
  }
}

function readFloat32(path) {
  const bytes = readFileSync(path);
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Float32Array(copy);
}

function hannWindow(size) {
  const values = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    values[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, size - 1));
  }
  return values;
}

/**
 * Build compact, gain-independent spectral fingerprints. The implementation is
 * Runner-owned and uses the public Goertzel recurrence rather than code from an
 * external synchronizer.
 */
export function spectralFingerprint(samples, sampleRate = MASTER_SYNC_SAMPLE_RATE) {
  const frameSize = Math.max(32, Math.round(sampleRate * FRAME_SECONDS));
  const hopSize = Math.max(8, Math.round(sampleRate * HOP_SECONDS));
  const frames = Math.max(0, 1 + Math.floor((samples.length - frameSize) / hopSize));
  const bands = FEATURE_FREQUENCIES.filter((frequency) => frequency < sampleRate / 2 - 25);
  const data = new Float32Array(frames * bands.length);
  const energy = new Float32Array(frames);
  const window = hannWindow(frameSize);
  const coefficients = bands.map((frequency) => 2 * Math.cos((2 * Math.PI * frequency) / sampleRate));

  for (let frame = 0; frame < frames; frame += 1) {
    const sampleStart = frame * hopSize;
    let frameEnergy = 0;
    const raw = new Float64Array(bands.length);

    for (let band = 0; band < bands.length; band += 1) {
      let previous = 0;
      let previousTwo = 0;
      const coefficient = coefficients[band];
      for (let i = 0; i < frameSize; i += 1) {
        const sample = samples[sampleStart + i] * window[i];
        if (band === 0) frameEnergy += sample * sample;
        const current = sample + coefficient * previous - previousTwo;
        previousTwo = previous;
        previous = current;
      }
      const power = Math.max(0, previousTwo * previousTwo + previous * previous - coefficient * previous * previousTwo);
      raw[band] = Math.log1p(power);
    }

    energy[frame] = Math.log1p(frameEnergy / frameSize);
    const mean = raw.reduce((sum, value) => sum + value, 0) / Math.max(1, raw.length);
    let norm = 0;
    for (let band = 0; band < raw.length; band += 1) {
      raw[band] -= mean;
      norm += raw[band] * raw[band];
    }
    norm = Math.sqrt(norm);
    if (norm < 1e-8) continue;
    for (let band = 0; band < raw.length; band += 1) {
      data[frame * raw.length + band] = raw[band] / norm;
    }
  }

  return {
    data,
    energy,
    frames,
    bands: bands.length,
    hopSeconds: hopSize / sampleRate,
    durationSeconds: samples.length / sampleRate,
  };
}

function sliceFingerprint(fingerprint, startFrame, frameCount) {
  const safeStart = clamp(startFrame, 0, Math.max(0, fingerprint.frames - frameCount));
  const safeCount = clamp(frameCount, 0, fingerprint.frames - safeStart);
  return {
    data: fingerprint.data.slice(
      safeStart * fingerprint.bands,
      (safeStart + safeCount) * fingerprint.bands,
    ),
    energy: fingerprint.energy.slice(safeStart, safeStart + safeCount),
    frames: safeCount,
    bands: fingerprint.bands,
    hopSeconds: fingerprint.hopSeconds,
    durationSeconds: safeCount * fingerprint.hopSeconds,
  };
}

function queryWeights(query) {
  const levels = Array.from(query.energy);
  const low = quantile(levels, 0.2);
  const high = Math.max(low + 1e-6, quantile(levels, 0.85));
  const weights = new Float32Array(query.frames);
  for (let i = 0; i < query.frames; i += 1) {
    weights[i] = 0.15 + 0.85 * clamp((query.energy[i] - low) / (high - low), 0, 1);
  }
  return weights;
}

export function fingerprintSimilarity(reference, query, lagFrame, weights = queryWeights(query)) {
  if (lagFrame < 0 || lagFrame + query.frames > reference.frames) return -1;
  let score = 0;
  let weightTotal = 0;
  for (let frame = 0; frame < query.frames; frame += 1) {
    const weight = weights[frame];
    let dot = 0;
    const referenceOffset = (lagFrame + frame) * reference.bands;
    const queryOffset = frame * query.bands;
    for (let band = 0; band < query.bands; band += 1) {
      dot += reference.data[referenceOffset + band] * query.data[queryOffset + band];
    }
    score += dot * weight;
    weightTotal += weight;
  }
  return weightTotal > 0 ? score / weightTotal : -1;
}

export function findFingerprintMatches(reference, query, options = {}) {
  if (!query.frames || query.frames > reference.frames) return [];
  const maxLag = reference.frames - query.frames;
  const requestedStart = Math.floor(options.startFrame ?? 0);
  const requestedEnd = Math.ceil(options.endFrame ?? maxLag);
  if (requestedEnd < 0 || requestedStart > maxLag || requestedEnd < requestedStart) return [];
  const startFrame = clamp(requestedStart, 0, maxLag);
  const endFrame = clamp(
    requestedEnd,
    startFrame,
    maxLag,
  );
  const limit = Math.max(1, Math.floor(options.limit ?? 1));
  const separationFrames = Math.max(1, Math.floor(options.separationFrames ?? 1 / reference.hopSeconds));
  const weights = queryWeights(query);
  const candidates = [];

  for (let lag = startFrame; lag <= endFrame; lag += 1) {
    const score = fingerprintSimilarity(reference, query, lag, weights);
    if (candidates.length < limit || score > candidates[candidates.length - 1].score) {
      candidates.push({ lagFrame: lag, score });
      candidates.sort((a, b) => b.score - a.score);
      for (let i = 0; i < candidates.length; i += 1) {
        for (let j = i + 1; j < candidates.length;) {
          if (Math.abs(candidates[i].lagFrame - candidates[j].lagFrame) < separationFrames) {
            candidates.splice(j, 1);
          } else {
            j += 1;
          }
        }
      }
      if (candidates.length > limit) candidates.length = limit;
    }
  }
  return candidates;
}

function windowCandidates(fingerprint) {
  const desiredFrames = Math.round(WINDOW_SECONDS / fingerprint.hopSeconds);
  const minimumFrames = Math.round(MIN_WINDOW_SECONDS / fingerprint.hopSeconds);
  const windowFrames = Math.min(desiredFrames, fingerprint.frames);
  if (windowFrames < minimumFrames) return [];
  const maxStart = Math.max(0, fingerprint.frames - windowFrames);
  const requested = Math.min(MAX_WINDOWS, Math.max(1, Math.floor(fingerprint.durationSeconds / 4)));
  const starts = new Set();
  for (let i = 0; i < requested; i += 1) {
    starts.add(Math.round((maxStart * i) / Math.max(1, requested - 1)));
  }
  return [...starts].map((startFrame) => {
    let energy = 0;
    for (let frame = startFrame; frame < startFrame + windowFrames; frame += 1) energy += fingerprint.energy[frame];
    return {
      startFrame,
      startSeconds: startFrame * fingerprint.hopSeconds,
      energy: energy / windowFrames,
      fingerprint: sliceFingerprint(fingerprint, startFrame, windowFrames),
    };
  });
}

export function fitLinearMapping(observations) {
  if (!observations.length) return null;
  if (observations.length === 1) {
    return {
      slope: 1,
      intercept: observations[0].masterSeconds - observations[0].videoSeconds,
      residualSeconds: 0,
    };
  }
  let totalWeight = 0;
  let meanX = 0;
  let meanY = 0;
  for (const observation of observations) {
    const weight = Math.max(0.01, observation.weight ?? 1);
    totalWeight += weight;
    meanX += observation.videoSeconds * weight;
    meanY += observation.masterSeconds * weight;
  }
  meanX /= totalWeight;
  meanY /= totalWeight;
  let covariance = 0;
  let variance = 0;
  for (const observation of observations) {
    const weight = Math.max(0.01, observation.weight ?? 1);
    covariance += weight * (observation.videoSeconds - meanX) * (observation.masterSeconds - meanY);
    variance += weight * (observation.videoSeconds - meanX) ** 2;
  }
  const slope = variance > 1e-9 ? covariance / variance : 1;
  const intercept = meanY - slope * meanX;
  let residual = 0;
  for (const observation of observations) {
    const weight = Math.max(0.01, observation.weight ?? 1);
    const error = observation.masterSeconds - (slope * observation.videoSeconds + intercept);
    residual += weight * error * error;
  }
  return {
    slope,
    intercept,
    residualSeconds: Math.sqrt(residual / totalWeight),
  };
}

function mappingResiduals(observations, mapping) {
  return observations.map((observation) => Math.abs(
    observation.masterSeconds - (mapping.slope * observation.videoSeconds + mapping.intercept),
  ));
}

export function fitRobustLinearMapping(observations) {
  const baseline = fitLinearMapping(observations);
  if (!baseline || observations.length < 4) return baseline;

  const candidates = [
    baseline,
    ...observations.map((_, omittedIndex) => fitLinearMapping(
      observations.filter((__, index) => index !== omittedIndex),
    )).filter(Boolean),
  ];
  const best = candidates.reduce((winner, candidate) => (
    quantile(mappingResiduals(observations, candidate), 0.5)
      < quantile(mappingResiduals(observations, winner), 0.5)
      ? candidate
      : winner
  ));
  const residuals = mappingResiduals(observations, best);
  const threshold = Math.max(0.04, quantile(residuals, 0.5) * 3);
  const inliers = observations.filter((_, index) => residuals[index] <= threshold);
  return inliers.length >= 3 && inliers.length < observations.length
    ? fitLinearMapping(inliers)
    : best;
}

function stableMappingForClip(observations) {
  const mapping = fitRobustLinearMapping(observations);
  if (!mapping || observations.length < 2) return mapping;
  const times = observations.map((item) => item.videoSeconds);
  const spanSeconds = Math.max(...times) - Math.min(...times);
  if (observations.length >= 3 && spanSeconds >= 15) return mapping;

  let totalWeight = 0;
  let intercept = 0;
  for (const observation of observations) {
    const weight = Math.max(0.01, observation.weight ?? 1);
    totalWeight += weight;
    intercept += (observation.masterSeconds - observation.videoSeconds) * weight;
  }
  intercept /= totalWeight;
  let residual = 0;
  for (const observation of observations) {
    const weight = Math.max(0.01, observation.weight ?? 1);
    const error = observation.masterSeconds - (observation.videoSeconds + intercept);
    residual += weight * error * error;
  }
  return {
    slope: 1,
    intercept,
    residualSeconds: Math.sqrt(residual / totalWeight),
  };
}

function trajectoryFromAnchor(reference, windows, anchor, anchorMatch) {
  const observations = [];
  for (const window of windows) {
    const deltaSeconds = window.startSeconds - anchor.startSeconds;
    const predictedSeconds = anchorMatch.lagFrame * reference.hopSeconds + deltaSeconds;
    const searchRadiusSeconds = Math.max(0.8, Math.abs(deltaSeconds) * MAX_DRIFT_RATE + 0.25);
    const matches = findFingerprintMatches(reference, window.fingerprint, {
      startFrame: Math.round((predictedSeconds - searchRadiusSeconds) / reference.hopSeconds),
      endFrame: Math.round((predictedSeconds + searchRadiusSeconds) / reference.hopSeconds),
      limit: 1,
    });
    const match = matches[0];
    if (!match) continue;
    observations.push({
      videoSeconds: window.startSeconds,
      masterSeconds: match.lagFrame * reference.hopSeconds,
      correlation: match.score,
      weight: clamp((match.score + 1) / 2, 0.05, 1) ** 2,
    });
  }
  const mapping = stableMappingForClip(observations);
  if (!mapping) return null;
  const meanCorrelation = observations.reduce((sum, item) => sum + item.correlation, 0) / observations.length;
  const driftPenalty = Math.max(0, Math.abs(mapping.slope - 1) - MAX_DRIFT_RATE) * 50;
  const score = meanCorrelation - mapping.residualSeconds * 1.5 - driftPenalty;
  return { observations, mapping, meanCorrelation, score };
}

export function alignFingerprints(master, scratch) {
  const windows = windowCandidates(scratch);
  if (!windows.length) throw new Error('The camera audio is too short to analyze reliably.');
  const anchor = [...windows].sort((a, b) => b.energy - a.energy)[0];
  const anchorMatches = findFingerprintMatches(master, anchor.fingerprint, {
    limit: MAX_ANCHOR_CANDIDATES,
    separationFrames: Math.round(1.5 / master.hopSeconds),
  });
  if (!anchorMatches.length) throw new Error('No usable match candidates were found in the master audio.');

  const trajectories = anchorMatches
    .map((match) => trajectoryFromAnchor(master, windows, anchor, match))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  const best = trajectories[0];
  if (!best) throw new Error('No consistent audio alignment could be calculated.');
  const second = trajectories[1];
  const ambiguityGap = second ? best.score - second.score : 1;
  const correlationConfidence = clamp((best.meanCorrelation - 0.12) / 0.58, 0, 1);
  const residualConfidence = clamp(1 - best.mapping.residualSeconds / 0.12, 0, 1);
  const ambiguityConfidence = clamp(ambiguityGap / 0.12, 0, 1);
  const coverageConfidence = clamp(best.observations.length / Math.min(3, windows.length), 0, 1);
  const confidence = clamp(
    correlationConfidence * 0.55
      + residualConfidence * 0.2
      + ambiguityConfidence * 0.15
      + coverageConfidence * 0.1,
    0,
    1,
  );

  return {
    masterStartSeconds: best.mapping.intercept,
    playbackRate: best.mapping.slope,
    driftPpm: (best.mapping.slope - 1) * 1_000_000,
    residualMs: best.mapping.residualSeconds * 1_000,
    meanCorrelation: best.meanCorrelation,
    ambiguityGap,
    confidence,
    windowsAnalyzed: windows.length,
    observations: best.observations,
  };
}

export function analyzeMasterSync(videoPath, masterPath, options = {}) {
  if (!existsSync(videoPath)) throw new Error(`Video file not found: ${videoPath}`);
  if (!existsSync(masterPath)) throw new Error(`Master audio file not found: ${masterPath}`);
  const sampleRate = options.sampleRate ?? MASTER_SYNC_SAMPLE_RATE;
  const tempDir = mkdtempSync(join(tmpdir(), 'runneros-master-sync-'));
  try {
    const scratchPcm = join(tempDir, 'scratch.f32le');
    const masterPcm = join(tempDir, 'master.f32le');
    extractMonoPcm(videoPath, scratchPcm, sampleRate);
    extractMonoPcm(masterPath, masterPcm, sampleRate);
    const scratchSamples = readFloat32(scratchPcm);
    const masterSamples = readFloat32(masterPcm);
    const maxAnalysisSeconds = options.maxAnalysisSeconds ?? MAX_ANALYSIS_SECONDS;
    if (scratchSamples.length > sampleRate * maxAnalysisSeconds || masterSamples.length > sampleRate * maxAnalysisSeconds) {
      const limitLabel = maxAnalysisSeconds >= 60
        ? `${Math.round(maxAnalysisSeconds / 60)} minutes`
        : `${Math.round(maxAnalysisSeconds)} seconds`;
      throw new Error(`Automatic synchronization supports sources up to ${limitLabel}.`);
    }
    if (scratchSamples.length < sampleRate * MIN_WINDOW_SECONDS) {
      throw new Error(`Camera audio must be at least ${MIN_WINDOW_SECONDS}s for automatic synchronization.`);
    }
    if (masterSamples.length <= scratchSamples.length / 4) {
      throw new Error('The selected master audio is too short for this camera clip.');
    }
    const result = alignFingerprints(
      spectralFingerprint(masterSamples, sampleRate),
      spectralFingerprint(scratchSamples, sampleRate),
    );
    const minConfidence = options.minConfidence ?? MASTER_SYNC_MIN_CONFIDENCE;
    return {
      ...result,
      minConfidence,
      minMeanCorrelation: MASTER_SYNC_MIN_CORRELATION,
      accepted: result.confidence >= minConfidence
        && result.meanCorrelation >= MASTER_SYNC_MIN_CORRELATION
        && Math.abs(result.playbackRate - 1) <= MAX_DRIFT_RATE,
      method: 'runner-spectral-window-alignment-v1',
      sampleRate,
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export function renderMasterSync({
  videoPath,
  masterPath,
  outputPath,
  videoDuration,
  masterDuration,
  analysis,
  cameraMix = 0,
  masterOffsetMs = 0,
}) {
  const adjustedStart = analysis.masterStartSeconds + masterOffsetMs / 1_000;
  const preRoll = Math.max(0, -adjustedStart);
  const sourceStart = Math.max(0, adjustedStart);
  const usableVideoDuration = videoDuration - preRoll;
  const sourceDuration = Math.min(
    Math.max(0, masterDuration - sourceStart),
    usableVideoDuration * analysis.playbackRate,
  );
  if (!Number.isFinite(videoDuration) || videoDuration <= 0) throw new Error('Video duration is unavailable.');
  if (usableVideoDuration <= 0.05) throw new Error('The detected master begins after the camera video has ended.');
  if (sourceStart >= masterDuration || sourceDuration <= 0.05) {
    throw new Error('The detected master position falls outside the selected master audio.');
  }
  const delayMs = Math.round(preRoll * 1_000);
  const masterFilters = [
    `atrim=start=${sourceStart.toFixed(6)}:duration=${sourceDuration.toFixed(6)}`,
    'asetpts=PTS-STARTPTS',
    `atempo=${analysis.playbackRate.toFixed(8)}`,
    ...(delayMs > 0 ? [`adelay=${delayMs}:all=1`] : []),
    `apad=pad_dur=${videoDuration.toFixed(6)}`,
    `atrim=duration=${videoDuration.toFixed(6)}`,
  ];
  let filterComplex = `[1:a]${masterFilters.join(',')}[master]`;
  let outputLabel = '[master]';
  if (cameraMix > 0) {
    filterComplex += `;[0:a]volume=${cameraMix.toFixed(4)}[camera];[master][camera]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]`;
    outputLabel = '[aout]';
  }
  const baseArgs = [
    '-v', 'error',
    '-y',
    '-i', videoPath,
    '-i', masterPath,
    '-filter_complex', filterComplex,
    '-map', '0:v:0',
    '-map', outputLabel,
  ];
  const outputArgs = [
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    '-shortest',
    outputPath,
  ];
  let result = run('ffmpeg', [...baseArgs, '-c:v', 'copy', ...outputArgs]);
  if (result.status !== 0) {
    result = run('ffmpeg', [
      ...baseArgs,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      ...outputArgs,
    ]);
  }
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'FFmpeg could not render the synchronized preview.');
}
