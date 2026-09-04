import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import type { SessionToolContext } from '../context.ts';
import type { CreateOutputToolInput, CreateOutputResult } from './outputs.ts';
import { handleArtworkCompose } from './artwork-compose.ts';

/**
 * With `PANGOCAIRO_BACKEND=fontconfig` in the environment — which the root
 * `test` script sets — this whole file runs in under a second. Without it,
 * libvips rasterizes SVG text through Pango's CoreText backend and every
 * render takes 20-45s on macOS. See packages/shared/src/config/pango-backend.ts.
 *
 * Bun ignores `process.env` writes for native libraries, so this file cannot
 * set it itself. Rather than pick one number that hides the difference, the
 * budget follows the environment: tight where the fix is present, so a real
 * regression still shows up, and generous where it is not, so running this
 * file directly is slow and explains itself rather than failing as a mystery.
 */
const TEXT_RENDERING_FIXED = process.platform !== 'darwin'
  || process.env['PANGOCAIRO_BACKEND'] === 'fontconfig';
if (!TEXT_RENDERING_FIXED) {
  console.warn(
    '[artwork_compose] PANGOCAIRO_BACKEND is unset, so each SVG text render will take 20-45s.\n'
    + '  Run `bun run test`, or export PANGOCAIRO_BACKEND=fontconfig, for the normal sub-second path.',
  );
}
setDefaultTimeout(TEXT_RENDERING_FIXED ? 10_000 : 300_000);

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'artwork-compose-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeCtx(createOutput?: (input: CreateOutputToolInput) => Promise<CreateOutputResult>): SessionToolContext {
  return {
    sessionId: 'session-1',
    workspacePath: root,
    workingDirectory: root,
    get sourcesPath() {
      return join(root, 'sources');
    },
    get skillsPath() {
      return join(root, 'skills');
    },
    plansFolderPath: join(root, 'plans'),
    callbacks: {
      onPlanSubmitted: () => {},
      onAuthRequest: () => {},
    },
    fs: {
      exists: existsSync,
      readFile: (path: string) => readFileSync(path, 'utf-8'),
      readFileBuffer: (path: string) => readFileSync(path),
      writeFile: (path: string, content: string) => writeFileSync(path, content),
      isDirectory: () => false,
      readdir: () => [],
      stat: () => ({ size: 0, isDirectory: () => false }),
    },
    loadSourceConfig: () => null,
    createOutput,
  } as SessionToolContext;
}

describe('artwork_compose', () => {
  test('writes editable SVG, PNG preview, and layout spec', async () => {
    const ctx = makeCtx();

    const result = await handleArtworkCompose(ctx, {
      title: 'Midnight Cover',
      width: 1200,
      height: 1200,
      backgroundColor: '#101010',
      texts: [{
        text: 'MIDNIGHT',
        x: 600,
        y: 1040,
        fontSize: 92,
        anchor: 'middle',
        letterSpacing: 8,
      }],
      shapes: [{
        type: 'rect',
        x: 80,
        y: 80,
        width: 1040,
        height: 1040,
        stroke: '#f5f1e8',
        strokeWidth: 6,
      }],
    });

    expect(result.isError).toBe(false);
    const content = result.structuredContent as { svgPath: string; pngPath: string; specPath: string };
    expect(existsSync(content.svgPath)).toBe(true);
    expect(existsSync(content.pngPath)).toBe(true);
    expect(existsSync(content.specPath)).toBe(true);
    const svg = readFileSync(content.svgPath, 'utf-8');
    expect(svg).toContain('MIDNIGHT');
    expect(svg).toContain('letter-spacing="8"');
    expect(content.svgPath).toContain(`${join('.artifacts', 'artwork')}`);
    expect(result.content[0]?.text).not.toContain('.artifacts');
  });

  test('default output paths are unique for repeated titles', async () => {
    const ctx = makeCtx();

    const first = await handleArtworkCompose(ctx, {
      title: 'Repeat Cover',
      exportPng: false,
      texts: [{ text: 'ONE', x: 100, y: 100, fontSize: 50 }],
    });
    const second = await handleArtworkCompose(ctx, {
      title: 'Repeat Cover',
      exportPng: false,
      texts: [{ text: 'TWO', x: 100, y: 100, fontSize: 50 }],
    });

    expect(first.isError).toBe(false);
    expect(second.isError).toBe(false);
    const firstPath = (first.structuredContent as { svgPath: string }).svgPath;
    const secondPath = (second.structuredContent as { svgPath: string }).svgPath;
    expect(dirname(firstPath)).not.toBe(dirname(secondPath));
    expect(readFileSync(firstPath, 'utf-8')).toContain('ONE');
    expect(readFileSync(secondPath, 'utf-8')).toContain('TWO');
  });

  test('embeds a base image before rendering PNG typography layer', async () => {
    const baseImagePath = join(root, 'base.png');
    await sharp({
      create: {
        width: 512,
        height: 512,
        channels: 4,
        background: '#ff0000',
      },
    }).png().toFile(baseImagePath);
    const ctx = makeCtx();

    const result = await handleArtworkCompose(ctx, {
      title: 'Base Image Cover',
      width: 512,
      height: 512,
      baseImagePath,
      texts: [{ text: 'BASE', x: 256, y: 280, fontSize: 80, anchor: 'middle' }],
    });

    expect(result.isError).toBe(false);
    const content = result.structuredContent as { svgPath: string; pngPath: string };
    expect(existsSync(content.pngPath)).toBe(true);
    expect(readFileSync(content.svgPath, 'utf-8')).toContain('data:image/png;base64');
    expect(readFileSync(content.svgPath, 'utf-8')).toContain('BASE');
  });

  test('publishes Canvas-visible output with PNG primary and SVG source', async () => {
    let captured: CreateOutputToolInput | undefined;
    const ctx = makeCtx(async (input) => {
      captured = input;
      return { ok: true, outputId: 'output-1', route: '/outputs/output-1', shownInCanvas: true };
    });

    const result = await handleArtworkCompose(ctx, {
      title: 'Poster Lockup',
      exportPng: true,
      showInCanvas: true,
      texts: [{ text: 'POSTER', x: 200, y: 200, fontSize: 80 }],
    });

    expect(result.isError).toBe(false);
    expect(captured?.kind).toBe('image');
    expect(captured?.showInCanvas).toBe(true);
    expect(captured?.files?.[0]?.role).toBe('primary');
    expect(captured?.files?.some((file) => file.role === 'source' && file.path.endsWith('.svg'))).toBe(true);
    expect((result.structuredContent as { outputId?: string }).outputId).toBe('output-1');
  });

  test('rejects paths outside the working directory', async () => {
    const ctx = makeCtx();

    const result = await handleArtworkCompose(ctx, {
      title: 'Bad Path',
      outputDir: '../escape',
      texts: [{ text: 'NO', x: 10, y: 10, fontSize: 20 }],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.type).toBe('text');
    expect(result.content[0]?.text).toContain('outputDir must stay inside');
  });
});
