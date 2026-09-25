export interface CubeLut { name: string; size: number; domainMin?: [number, number, number]; domainMax?: [number, number, number]; values: number[]; intensity?: number }
export interface ColorAdjustments { pipeline?: 'rgb-v1'; exposure?: number; contrast?: number; saturation?: number; temperature?: number; tint?: number; highlights?: number; shadows?: number; grain?: number; sharpen?: number; vignette?: number; preset?: string; lut?: CubeLut }
export const RGB_PIPELINE: 'rgb-v1';
export function validateCubeLut(value: unknown): CubeLut;
export function parseCubeLut(text: string, name?: string): CubeLut;
export function sampleLutRgb(lut: CubeLut, r: number, g: number, b: number): [number, number, number];
export function applyLutToRgba(data: Uint8ClampedArray, lut: CubeLut): Uint8ClampedArray;
export function validateColorAdjustments(adjustments: unknown): void;
export function resolveColorLut(adjustments?: ColorAdjustments): CubeLut | null;
export function serializeCubeLut(lut: CubeLut): string;
export const buildColorLut: typeof resolveColorLut;
export function validateColorProjectBudget(project: unknown): void;
