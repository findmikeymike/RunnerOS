// Browser-safe color contract. Cube values use red-fastest ordering, like .cube.
const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));
export const RGB_PIPELINE = 'rgb-v1';
export function validateCubeLut(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('LUT must be an inline cube object.');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 200) throw new Error('LUT name must contain 1–200 characters.');
  if (!Number.isInteger(value.size) || value.size < 2 || value.size > 33) throw new Error('LUT size must be between 2 and 33.');
  if (!Array.isArray(value.values) || value.values.length !== value.size ** 3 * 3 || Array.from(value.values).some(v => !Number.isFinite(v) || Math.abs(v) > 16)) throw new Error('LUT requires exactly size³ RGB triples with finite values between -16 and 16.');
  for (const key of ['domainMin', 'domainMax']) if (value[key] !== undefined && (!Array.isArray(value[key]) || value[key].length !== 3 || Array.from(value[key]).some(v => !Number.isFinite(v) || Math.abs(v) > 16))) throw new Error('LUT domains must contain three finite numbers between -16 and 16.');
  const min = value.domainMin ?? [0, 0, 0], max = value.domainMax ?? [1, 1, 1];
  if (min.some((v, i) => v >= max[i])) throw new Error('LUT domain maximum must exceed its minimum on every channel.');
  if (value.intensity !== undefined && (!Number.isFinite(value.intensity) || value.intensity < 0 || value.intensity > 1)) throw new Error('LUT intensity must be between 0 and 1.');
  return value;
}

export function parseCubeLut(text, name = 'Imported LUT') {
  if (typeof text !== 'string' || text.length > 8_000_000) throw new Error('Cube file must be text smaller than 8 MB.');
  let size, domainMin, domainMax;
  const values = [];
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const [keyword, ...parts] = line.split(/\s+/);
    if (keyword === 'TITLE') continue;
    if (keyword === 'LUT_3D_SIZE') {
      if (size !== undefined || parts.length !== 1) throw new Error('Cube requires one LUT_3D_SIZE declaration.');
      size = Number(parts[0]);
      if (!Number.isInteger(size) || size < 2 || size > 33) throw new Error('LUT size must be between 2 and 33.');
    } else if (keyword === 'DOMAIN_MIN' || keyword === 'DOMAIN_MAX') {
      if (parts.length !== 3 || (keyword === 'DOMAIN_MIN' ? domainMin : domainMax)) throw new Error('Invalid or duplicate cube domain.');
      if (keyword === 'DOMAIN_MIN') domainMin = parts.map(Number); else domainMax = parts.map(Number);
    } else {
      const triple = [keyword, ...parts];
      if (size === undefined || triple.length !== 3 || triple.some(v => !v.trim() || !Number.isFinite(Number(v)))) throw new Error('Only 3D .cube LUTs with RGB triples are supported.');
      values.push(...triple.map(Number));
      if (values.length > size ** 3 * 3) throw new Error('Cube contains too many RGB entries.');
    }
  }
  return validateCubeLut({ name, size, ...(domainMin ? { domainMin } : {}), ...(domainMax ? { domainMax } : {}), values, intensity: 1 });
}

// Caller validates once before processing an image, rather than once per pixel.
export function sampleLutRgb(lut, r, g, b) {
  const input = [r, g, b], min = lut.domainMin ?? [0, 0, 0], max = lut.domainMax ?? [1, 1, 1];
  const pos = input.map((v, i) => clamp((v - min[i]) / (max[i] - min[i])) * (lut.size - 1));
  const low = pos.map(Math.floor), high = low.map(v => Math.min(v + 1, lut.size - 1)), fraction = pos.map((v, i) => v - low[i]);
  const out = [0, 0, 0];
  for (let blue = 0; blue < 2; blue++) for (let green = 0; green < 2; green++) for (let red = 0; red < 2; red++) {
    const index = (((blue ? high[2] : low[2]) * lut.size + (green ? high[1] : low[1])) * lut.size + (red ? high[0] : low[0])) * 3;
    const weight = (red ? fraction[0] : 1 - fraction[0]) * (green ? fraction[1] : 1 - fraction[1]) * (blue ? fraction[2] : 1 - fraction[2]);
    for (let channel = 0; channel < 3; channel++) out[channel] += lut.values[index + channel] * weight;
  }
  const intensity = lut.intensity ?? 1;
  return out.map((v, i) => clamp(input[i] + (v - input[i]) * intensity));
}

export function applyLutToRgba(data, lut) {
  validateCubeLut(lut);
  const axis = [0, 1, 2].map(channel => {
    const low = new Int32Array(256), high = new Int32Array(256), fraction = new Float64Array(256);
    const min = lut.domainMin?.[channel] ?? 0, max = lut.domainMax?.[channel] ?? 1;
    const stride = 3 * lut.size ** channel;
    for (let i = 0; i < 256; i++) {
      const position = clamp((i / 255 - min) / (max - min)) * (lut.size - 1), floor = Math.floor(position);
      low[i] = floor * stride; high[i] = Math.min(floor + 1, lut.size - 1) * stride; fraction[i] = position - floor;
    }
    return { low, high, fraction };
  });
  const intensity = lut.intensity ?? 1, values = lut.values;
  for (let offset = 0; offset < data.length; offset += 4) {
    const red = data[offset], green = data[offset + 1], blue = data[offset + 2];
    const fr = axis[0].fraction[red], fg = axis[1].fraction[green], fb = axis[2].fraction[blue];
    let outR = 0, outG = 0, outB = 0;
    for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) {
      const index = (r ? axis[0].high[red] : axis[0].low[red]) + (g ? axis[1].high[green] : axis[1].low[green]) + (b ? axis[2].high[blue] : axis[2].low[blue]);
      const weight = (r ? fr : 1 - fr) * (g ? fg : 1 - fg) * (b ? fb : 1 - fb);
      outR += values[index] * weight; outG += values[index + 1] * weight; outB += values[index + 2] * weight;
    }
    data[offset] = Math.round(clamp(red / 255 + (outR - red / 255) * intensity) * 255);
    data[offset + 1] = Math.round(clamp(green / 255 + (outG - green / 255) * intensity) * 255);
    data[offset + 2] = Math.round(clamp(blue / 255 + (outB - blue / 255) * intensity) * 255);
  }
  return data;
}

const ranges = { exposure: [-1, 1], contrast: [0, 3], saturation: [0, 3], temperature: [-1, 1], tint: [-1, 1], highlights: [-1, 1], shadows: [-1, 1], grain: [0, 1], sharpen: [0, 1], vignette: [0, 1] };
export function validateColorAdjustments(adjustments) {
  if (adjustments === undefined) return;
  if (!adjustments || typeof adjustments !== 'object' || Array.isArray(adjustments)) throw new Error('Color adjustments must be an object.');
  if (adjustments.pipeline !== undefined && adjustments.pipeline !== RGB_PIPELINE) throw new Error('Unsupported color pipeline.');
  if (adjustments.lut !== undefined) validateCubeLut(adjustments.lut);
  for (const [key, [low, high]] of Object.entries(ranges)) if (adjustments[key] !== undefined && (!Number.isFinite(adjustments[key]) || (adjustments.pipeline === RGB_PIPELINE && (adjustments[key] < low || adjustments[key] > high)))) throw new Error(`${key} must be finite and between ${low} and ${high}.`);
}

function rgbTransform(input, adjustments) {
  let rgb = input.map(v => v * 2 ** (adjustments.exposure ?? 0));
  const temperature = (adjustments.temperature ?? 0) * 0.15, tint = (adjustments.tint ?? 0) * 0.15;
  rgb = rgb.map((v, i) => v + (i === 0 ? temperature + tint / 2 : i === 1 ? -tint : -temperature + tint / 2));
  rgb = rgb.map(v => {
    const tone = clamp(v);
    return (v + (adjustments.shadows ?? 0) * (1 - tone) ** 2 * 0.25 + (adjustments.highlights ?? 0) * tone ** 2 * 0.25 - 0.5) * (adjustments.contrast ?? 1) + 0.5;
  });
  const luma = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return rgb.map(v => clamp(luma + (v - luma) * (adjustments.saturation ?? 1)));
}

function bake(name, size, transform) {
  const values = [];
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) values.push(...transform([r / (size - 1), g / (size - 1), b / (size - 1)]));
  return { name, size, values, intensity: 1 };
}

/** Both browser and FFmpeg consume this exact baked table; legacy controls stay legacy. */
export function resolveColorLut(adjustments) {
  validateColorAdjustments(adjustments);
  if (!adjustments || (adjustments.pipeline !== RGB_PIPELINE && !adjustments.lut)) return null;
  const imported = adjustments.lut;
  return bake(imported?.name ?? 'RGB color', imported ? 33 : 17, input => {
    const rgb = adjustments.pipeline === RGB_PIPELINE ? rgbTransform(input, adjustments) : input;
    return imported ? sampleLutRgb(imported, ...rgb) : rgb;
  });
}

/** Intensity is baked to RGB values; no filename/title from user data enters FFmpeg. */
export function serializeCubeLut(lut) {
  validateCubeLut(lut);
  const normalized = bake(lut.name, lut.size, rgb => sampleLutRgb(lut, ...rgb));
  const lines = ['TITLE "Artist OS color"', `LUT_3D_SIZE ${normalized.size}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
  for (let i = 0; i < normalized.values.length; i += 3) lines.push(normalized.values.slice(i, i + 3).map(v => v.toFixed(9)).join(' '));
  return lines.join('\n') + '\n';
}

export const buildColorLut = resolveColorLut;

// Inline LUT tables repeat per clip. Bound the whole document so content plus
// its expected revision remains comfortably below the RPC transport limit.
export function validateColorProjectBudget(project) {
  const tracks = project?.timeline?.tracks;
  if (!Array.isArray(tracks) || !tracks.some(track => Array.isArray(track?.clips) && track.clips.some(clip => clip?.adjustments?.lut !== undefined))) return;
  const bytes = new TextEncoder().encode(`${JSON.stringify(project, null, 2)}\n`).byteLength;
  if (bytes > 16 * 1024 * 1024) throw new Error('Projects with embedded LUTs must be 16 MB or smaller. Apply the LUT to fewer clips or use a smaller cube. No changes were saved.');
}
