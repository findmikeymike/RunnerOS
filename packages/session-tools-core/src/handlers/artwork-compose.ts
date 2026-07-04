import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import sharp from 'sharp';
import type { SessionToolContext } from '../context.ts';
import { errorResponse } from '../response.ts';
import type { ToolResult } from '../types.ts';

export type ArtworkTextAnchor = 'start' | 'middle' | 'end';

export interface ArtworkComposeTextLayer {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fontFamily?: string;
  fontWeight?: string | number;
  fill?: string;
  anchor?: ArtworkTextAnchor;
  uppercase?: boolean;
  maxWidth?: number;
  lineHeight?: number;
  letterSpacing?: number;
  opacity?: number;
}

export interface ArtworkComposeShapeLayer {
  type: 'rect' | 'circle' | 'line';
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  cx?: number;
  cy?: number;
  r?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
  radius?: number;
}

export interface ArtworkComposeInput {
  title: string;
  width?: number;
  height?: number;
  outputDir?: string;
  fileName?: string;
  baseImagePath?: string;
  backgroundColor?: string;
  texts?: ArtworkComposeTextLayer[];
  shapes?: ArtworkComposeShapeLayer[];
  exportPng?: boolean;
  publishOutput?: boolean;
  showInCanvas?: boolean;
  summary?: string;
  tags?: string[];
}

const DEFAULT_SIZE = 3000;
const MAX_CANVAS_SIZE = 8000;
const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

function baseDir(ctx: SessionToolContext): string {
  return ctx.workingDirectory || ctx.workspacePath;
}

function isInside(base: string, candidate: string): boolean {
  const rel = relative(base, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function resolveInside(base: string, pathValue: string): string | null {
  const resolved = isAbsolute(pathValue) ? resolve(pathValue) : resolve(base, pathValue);
  return isInside(base, resolved) ? resolved : null;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'artwork';
}

function shortId(): string {
  return randomUUID().slice(0, 8);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function wrapText(text: string, fontSize: number, maxWidth?: number): string[] {
  if (!maxWidth || maxWidth <= 0) return text.split('\n');
  const maxChars = Math.max(1, Math.floor(maxWidth / Math.max(1, fontSize * 0.55)));
  const lines: string[] = [];
  for (const rawLine of text.split('\n')) {
    let current = '';
    for (const word of rawLine.split(/\s+/).filter(Boolean)) {
      const next = current ? `${current} ${word}` : word;
      if (next.length > maxChars && current) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
  }
  return lines.length > 0 ? lines : [''];
}

function renderTextLayer(layer: ArtworkComposeTextLayer): string {
  const text = layer.uppercase ? layer.text.toUpperCase() : layer.text;
  const fontFamily = escapeXml(layer.fontFamily || 'Helvetica Neue, Arial, sans-serif');
  const fontWeight = escapeXml(String(layer.fontWeight || 700));
  const fill = escapeXml(layer.fill || '#ffffff');
  const anchor = layer.anchor || 'start';
  const lineHeight = layer.lineHeight || 1.12;
  const opacity = layer.opacity === undefined ? 1 : clampNumber(layer.opacity, 0, 1);
  const letterSpacing = layer.letterSpacing ?? 0;
  const lines = wrapText(text, layer.fontSize, layer.maxWidth);
  const tspans = lines.map((line, index) => {
    const dy = index === 0 ? 0 : layer.fontSize * lineHeight;
    return `<tspan x="${layer.x}" dy="${index === 0 ? 0 : dy}">${escapeXml(line)}</tspan>`;
  }).join('');

  return [
    `<text x="${layer.x}" y="${layer.y}"`,
    ` font-family="${fontFamily}" font-size="${layer.fontSize}" font-weight="${fontWeight}"`,
    ` fill="${fill}" text-anchor="${anchor}" letter-spacing="${letterSpacing}" opacity="${opacity}">`,
    tspans,
    '</text>',
  ].join('');
}

function renderShapeLayer(layer: ArtworkComposeShapeLayer): string {
  const fill = escapeXml(layer.fill || 'none');
  const stroke = escapeXml(layer.stroke || 'none');
  const strokeWidth = layer.strokeWidth ?? 0;
  const opacity = layer.opacity === undefined ? 1 : clampNumber(layer.opacity, 0, 1);
  if (layer.type === 'rect') {
    return `<rect x="${layer.x ?? 0}" y="${layer.y ?? 0}" width="${layer.width ?? 0}" height="${layer.height ?? 0}" rx="${layer.radius ?? 0}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}" />`;
  }
  if (layer.type === 'circle') {
    return `<circle cx="${layer.cx ?? 0}" cy="${layer.cy ?? 0}" r="${layer.r ?? 0}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}" />`;
  }
  return `<line x1="${layer.x1 ?? 0}" y1="${layer.y1 ?? 0}" x2="${layer.x2 ?? 0}" y2="${layer.y2 ?? 0}" stroke="${stroke}" stroke-width="${strokeWidth || 1}" opacity="${opacity}" />`;
}

function imageDataUri(pathValue: string): string {
  const ext = extname(pathValue).toLowerCase();
  const mime = MIME_BY_EXT[ext] || 'application/octet-stream';
  const data = readFileSync(pathValue).toString('base64');
  return `data:${mime};base64,${data}`;
}

function validateArgs(args: ArtworkComposeInput): string | null {
  if (!args.title || typeof args.title !== 'string') return 'title is required.';
  const width = args.width ?? DEFAULT_SIZE;
  const height = args.height ?? DEFAULT_SIZE;
  if (!Number.isInteger(width) || width < 256 || width > MAX_CANVAS_SIZE) return `width must be an integer between 256 and ${MAX_CANVAS_SIZE}.`;
  if (!Number.isInteger(height) || height < 256 || height > MAX_CANVAS_SIZE) return `height must be an integer between 256 and ${MAX_CANVAS_SIZE}.`;
  if (args.texts && !Array.isArray(args.texts)) return 'texts must be an array.';
  if (args.shapes && !Array.isArray(args.shapes)) return 'shapes must be an array.';
  return null;
}

export async function handleArtworkCompose(ctx: SessionToolContext, args: ArtworkComposeInput): Promise<ToolResult> {
  const validationError = validateArgs(args);
  if (validationError) return errorResponse(validationError);

  const root = baseDir(ctx);
  const width = args.width ?? DEFAULT_SIZE;
  const height = args.height ?? DEFAULT_SIZE;
  const stem = slugify(args.fileName || args.title);
  const outputDir = resolveInside(root, args.outputDir || join('.artifacts', 'artwork', slugify(args.title), shortId()));
  if (!outputDir) return errorResponse('outputDir must stay inside the session working directory.');

  let baseImageMarkup = '';
  if (args.baseImagePath) {
    const baseImagePath = resolveInside(root, args.baseImagePath);
    if (!baseImagePath) return errorResponse('baseImagePath must stay inside the session working directory.');
    try {
      const dataUri = imageDataUri(baseImagePath);
      baseImageMarkup = `<image href="${dataUri}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" />`;
    } catch (error) {
      return errorResponse(`Unable to read baseImagePath: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const backgroundColor = escapeXml(args.backgroundColor || '#111111');
  const shapes = (args.shapes || []).map(renderShapeLayer).join('\n  ');
  const texts = (args.texts || []).map(renderTextLayer).join('\n  ');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${backgroundColor}" />
  ${baseImageMarkup}
  ${shapes}
  ${texts}
</svg>
`;

  mkdirSync(outputDir, { recursive: true });
  const svgPath = join(outputDir, `${stem}.svg`);
  const pngPath = join(outputDir, `${stem}.png`);
  const specPath = join(outputDir, `${stem}.layout.json`);
  writeFileSync(svgPath, svg, 'utf-8');
  writeFileSync(specPath, JSON.stringify({ ...args, width, height, svgPath, pngPath: args.exportPng === false ? undefined : pngPath }, null, 2), 'utf-8');

  let renderedPngPath: string | undefined;
  if (args.exportPng !== false) {
    try {
      await sharp(Buffer.from(svg)).png().toFile(pngPath);
      renderedPngPath = pngPath;
    } catch (error) {
      return errorResponse(`SVG was written, but PNG export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  let outputId: string | undefined;
  let outputRoute: string | undefined;
  let shownInCanvas = false;
  if (args.publishOutput !== false && ctx.createOutput) {
    const output = await ctx.createOutput({
      title: args.title,
      kind: 'image',
      summary: args.summary || `Artwork composition with editable SVG/type layer${renderedPngPath ? ' and PNG preview' : ''}.`,
      files: [
        {
          path: renderedPngPath || svgPath,
          label: renderedPngPath ? `${basename(renderedPngPath)} preview` : `${basename(svgPath)} preview`,
          role: 'primary',
        },
        { path: svgPath, label: `${basename(svgPath)} editable SVG`, role: 'source' },
        { path: specPath, label: `${basename(specPath)} layout spec`, role: 'source' },
      ],
      tags: args.tags || ['artwork', 'composition', 'typography'],
      showInCanvas: args.showInCanvas !== false,
    });
    if (!output.ok) return errorResponse(output.error || 'Artwork files were written, but output publishing failed.');
    outputId = output.outputId;
    outputRoute = output.route;
    shownInCanvas = output.shownInCanvas === true;
  }

  return {
    content: [{
      type: 'text',
      text: outputRoute
        ? `Created artwork composition "${args.title}" at ${outputRoute}.`
        : `Created artwork composition "${args.title}".`,
    }],
    structuredContent: {
      ok: true,
      svgPath,
      pngPath: renderedPngPath,
      specPath,
      outputId,
      route: outputRoute,
      shownInCanvas,
    },
    isError: false,
  };
}
