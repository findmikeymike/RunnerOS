/**
 * Run: bun scripts/test-video-studio-ui.ts
 * Requires installed Google Chrome and FFmpeg; PLAYWRIGHT_CHANNEL can override Chrome.
 * Runs real VideoStudioPage and native media in a disposable browser profile.
 * Shell, presentation wrappers, and IO use synthetic fixtures; no app profile or providers.
 */
import { build } from 'esbuild';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const base = resolve(import.meta.dir, '..');
const stubs: Record<string, string> = {
    outputs: `const getOutput = (...args) => window.fixture.getOutput(...args); export const useOutputs = () => ({getOutput});`,
    shell: `export const useAppShellContext = () => ({onInputChange: (sessionId,text) => window.fixture.drafts.push({sessionId,text})});`,
    navigation: `export const useNavigation = () => ({navigate: route => window.fixture.navigations.push(route)});`,
    toast: `export const toast = Object.fromEntries(['success','warning','error','info'].map(kind => [kind, message => window.fixture.toasts.push({kind,message})]));`,
    button: `import React from 'react'; export const Button=({children,size,variant,...props}) => React.createElement('button',props,children);`,
    menu: `import React from 'react'; const Box=({children}) => React.createElement('div',null,children); export const DropdownMenu=Box, DropdownMenuTrigger=Box, StyledDropdownMenuContent=Box; export const StyledDropdownMenuSeparator=()=>null; export const StyledDropdownMenuItem=({children,onSelect,...props}) => React.createElement('button',{...props,onClick:props.onClick||onSelect},children);`,
};
const boundaries: Record<string, string> = {
    '@/hooks/useOutputs': 'outputs', '@/context/AppShellContext': 'shell', '@/contexts/NavigationContext': 'navigation',
    sonner: 'toast', '@/components/ui/button': 'button', '@/components/ui/styled-dropdown': 'menu',
};
const bundle = await build({
    entryPoints: [resolve(import.meta.dir, 'fixtures/video-studio-ui.tsx')],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    tsconfig: resolve(base, 'apps/electron/tsconfig.json'),
    plugins: [{
        name: 'fixture-boundaries',
        setup(builder) {
            builder.onResolve({ filter: /.*/ }, args => {
                const key = boundaries[args.path];
                return key ? { path: key, namespace: 'fixture' } : undefined;
            });
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({
                contents: stubs[args.path],
                loader: 'jsx',
                resolveDir: base,
            }));
        },
    }],
});

const temporary = mkdtempSync(join(tmpdir(), 'video-studio-ui-'));
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let passed = 0, failed = 0;
try {
    for (const [name, color, duration] of [['source', 'red', '6'], ['render', 'blue', '2']]) {
        const made = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=160x90:r=10`, '-t', duration!, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(temporary, `${name}.mp4`)], { encoding: 'utf8' });
        assert.equal(made.status, 0, made.stderr);
    }
    const clock = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=320x240:r=10:d=1', '-f', 'lavfi', '-i', 'color=lime:s=320x240:r=10:d=1', '-f', 'lavfi', '-i', 'color=blue:s=320x240:r=10:d=2', '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(temporary, 'clock.mp4')], { encoding: 'utf8' });
    assert.equal(clock.status, 0, clock.stderr);
    const overlay = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=80x80,drawbox=x=40:y=0:w=40:h=80:color=yellow:t=fill', '-frames:v', '1', join(temporary, 'overlay.png')], { encoding: 'utf8' });
    assert.equal(overlay.status, 0, overlay.stderr);
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    await page.route('https://video-studio-fixture.test/**', route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/overlay.png') return route.fulfill({ contentType: 'image/png', body: readFileSync(join(temporary, 'overlay.png')) });
        if (path === '/source.mp4' || path === '/render.mp4' || path === '/clock.mp4') {
            const bytes = readFileSync(join(temporary, path.slice(1)));
            const range = route.request().headers()['range']?.match(/bytes=(\d+)-(\d*)/);
            if (range) {
                const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
                return route.fulfill({ status: 206, contentType: 'video/mp4', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${bytes.length}` }, body: bytes.subarray(start, end + 1) });
            }
            return route.fulfill({ contentType: 'video/mp4', headers: { 'Accept-Ranges': 'bytes' }, body: bytes });
        }
        if (path === '/fixture.js')
            return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0]!.text });
        return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="root"></div><script src="/fixture.js"></script></body></html>' });
    });
    page.setDefaultTimeout(6000);
    page.on('dialog', dialog => dialog.accept());
    let errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const fixture = () => page.evaluate(() => ({ calls: (window as any).fixture.calls, navigations: (window as any).fixture.navigations, drafts: (window as any).fixture.drafts, disk: (window as any).fixture.disk(), initialText: (window as any).fixture.initialText, toasts: (window as any).fixture.toasts }));
    const reopen = async () => { await page.evaluate(() => { (window as any).fixture.unmount(); (window as any).fixture.mount(); }); await page.getByRole('button', { name: 'Restore draft', exact: true }).waitFor(); };
    const edit = () => page.getByRole('button', { name: 'Add title', exact: true }).click();
    const raw = async () => { if (!await page.locator('textarea').count())
        await page.getByRole('button', { name: /Developer details/ }).click(); return page.locator('textarea').last(); };
    const save = () => page.getByRole('button', { name: 'Save project', exact: true }).click();
    const check = async (name: string, body: () => Promise<void>) => {
        try {
            errors = [];
            await page.goto('https://video-studio-fixture.test/');
            await page.evaluate(() => localStorage.clear());
            await page.reload();
            await page.getByRole('button', { name: 'Add title', exact: true }).waitFor();
            await body();
            assert.deepEqual(errors, []);
            passed++;
            console.log(`PASS ${name}`);
        }
        catch (error) {
            failed++;
            console.error(`FAIL ${name}: ${error instanceof Error ? error.stack : error}`);
            if (errors.length)
                console.error(errors);
            console.error(await page.evaluate(() => ({ video: document.querySelector('video') ? { time: document.querySelector('video')!.currentTime, duration: document.querySelector('video')!.duration, seekable: document.querySelector('video')!.seekable.length ? document.querySelector('video')!.seekable.end(0) : 0, seeking: document.querySelector('video')!.seeking, ready: document.querySelector('video')!.readyState } : null, markers: Array.from(document.querySelectorAll('div[aria-hidden="true"][style]')).map(e => (e as HTMLElement).style.cssText) })));
        }
    };
    await check('real page edit saves against exact original disk bytes', async () => {
        await edit();
        await save();
        await page.waitForFunction(() => (window as any).fixture.calls.length === 1);
        const state = await fixture();
        assert.equal(state.calls[0].expected, state.initialText);
        assert.equal(JSON.parse(state.disk).timeline.tracks.flatMap((t: any) => t.clips).length, 2);
        assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('artist-os:video-draft:')).length), 0);
    });
    await check('navigation retains invalid raw draft and explicit discard removes it', async () => {
        await (await raw()).fill('{ unfinished private fixture');
        await reopen();
        await page.getByRole('button', { name: 'Restore draft', exact: true }).click();
        assert.equal(await (await raw()).inputValue(), '{ unfinished private fixture');
        await page.reload();
        await page.getByRole('button', { name: 'Restore draft', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
        await page.getByRole('button', { name: 'Add title', exact: true }).waitFor();
        assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('artist-os:video-draft:')).length), 0);
        assert.equal((await fixture()).disk, (await fixture()).initialText);
    });
    await check('restored draft cannot overwrite newer external disk project', async () => {
        await edit();
        await page.evaluate(() => (window as any).fixture.external('Newer disk'));
        await reopen();
        await page.getByRole('button', { name: 'Restore draft', exact: true }).click();
        await save();
        assert.equal((await fixture()).calls.length, 0);
        assert.equal(JSON.parse((await fixture()).disk).title, 'Newer disk');
        assert.equal(await page.getByRole('button', { name: 'Download draft', exact: true }).count(), 1);
        assert.equal(JSON.parse(await (await raw()).inputValue()).timeline.tracks.flatMap((t: any) => t.clips).length, 2);
    });
    await check('render review uses returned output media and normal output clock', async () => {
        await page.locator('video').waitFor();
        await page.waitForFunction(() => document.querySelector('video')!.readyState >= 1);
        assert.equal(await page.locator('video').evaluate(v => (v as HTMLVideoElement).playbackRate), 2);
        await page.getByRole('button', { name: 'Render & review', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('video')?.getAttribute('src')?.endsWith('/render.mp4'));
        await page.waitForFunction(() => document.querySelector('video')!.readyState >= 1);
        assert.equal(await page.getByRole('button', { name: 'Rendered', exact: true }).getAttribute('aria-pressed'), 'true');
        assert.equal(await page.locator('video').evaluate(v => (v as HTMLVideoElement).playbackRate), 1);
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        await page.waitForFunction(() => document.querySelector('video')!.readyState === 4 && !document.querySelector('video')!.seeking);
        await page.locator('video').evaluate(v => { (v as HTMLVideoElement).currentTime = 1.25; });
        await page.waitForFunction(() => Math.abs(parseFloat((document.querySelector('div[aria-hidden="true"][style]') as HTMLElement).style.left) - (1250 / 12 + 12)) < 1);
        assert.deepEqual((await fixture()).calls.map((c: any) => c.action), ['save', 'export']);
        await edit();
        assert.ok((await page.textContent('body'))!.includes('edited since render'));
        await page.getByRole('button', { name: 'Source', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('video')?.getAttribute('src')?.endsWith('/source.mp4'));
    });
    const openAgent = async () => { await page.getByRole('button', { name: 'Video Agent', exact: true }).click(); await page.getByPlaceholder('Make this a 9:16 punchy short...').fill('Synthetic trim request'); };
    await check('agent saves first and deferred-save double click launches once', async () => {
        await page.evaluate(() => (window as any).fixture.holdSave = true);
        await openAgent();
        await page.getByTitle('Send to Video Agent').evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
        await page.waitForFunction(() => Boolean((window as any).fixture.finishSave));
        assert.deepEqual((await fixture()).calls.map((c: any) => c.action), ['save']);
        await page.evaluate(() => (window as any).fixture.finishSave());
        await page.waitForFunction(() => (window as any).fixture.navigations.length === 1);
        const state = await fixture();
        assert.deepEqual(state.calls.map((c: any) => c.action), ['save', 'agent']);
        assert.deepEqual(state.navigations, ['allSessions/session/fixture-session']);
        assert.equal(await page.getByPlaceholder('Make this a 9:16 punchy short...').inputValue(), '');
    });
    await check('draft and pending handoffs navigate honestly with retry context preserved', async () => {
        for (const status of ['draft', 'pending']) {
            await page.evaluate(status => { (window as any).fixture.status = status; }, status);
            await openAgent();
            await page.getByTitle('Send to Video Agent').click();
            await page.waitForFunction(count => (window as any).fixture.navigations.length === count, status === 'draft' ? 1 : 2);
            assert.equal(await page.getByPlaceholder('Make this a 9:16 punchy short...').inputValue(), 'Synthetic trim request');
            await page.getByTitle('Close Video Agent').click();
        }
        const state = await fixture();
        assert.deepEqual(state.drafts, [{ sessionId: 'fixture-session', text: 'Saved edit request: Synthetic trim request' }]);
        assert.deepEqual(state.navigations, ['allSessions/session/fixture-session', 'allSessions/session/fixture-session']);
        assert.equal(state.toasts.filter((t: any) => t.kind === 'warning').length, 2);
    });
    const openComposition = async () => {
        await page.evaluate(() => (window as any).fixture.composition());
        const button = page.getByRole('button', { name: 'Composition', exact: true });
        await button.focus();
        await page.keyboard.press('Space');
        assert.equal(await button.getAttribute('aria-pressed'), 'true', 'Space must activate the focused Composition button');
    };
    const seekComposition = async (timeMs: number) => {
        await page.getByLabel('Composition time', { exact: true }).evaluate((input, value) => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(value));
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }, timeMs);
    };
    const readyComposition = async (timeMs: number) => {
        await page.waitForFunction(time => {
            const canvas = document.querySelector('canvas[aria-label="Composition preview"]');
            return canvas?.getAttribute('data-state') === 'ready' && Number(canvas.getAttribute('data-time-ms')) === time;
        }, timeMs);
    };
    const canvasPixel = (x: number, y: number) => page.getByLabel('Composition preview', { exact: true }).evaluate((canvas, point) =>
        [...(canvas as HTMLCanvasElement).getContext('2d')!.getImageData(point.x, point.y, 1, 1).data], { x, y });
    const whitePixels = (top: number, bottom: number) => page.getByLabel('Composition preview', { exact: true }).evaluate((canvas, region) => {
        const c = canvas as HTMLCanvasElement;
        const pixels = c.getContext('2d')!.getImageData(0, region.top, c.width, region.bottom - region.top).data;
        let count = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i]! > 190 && pixels[i + 1]! > 190 && pixels[i + 2]! > 190) count++;
        return count;
    }, { top, bottom });
    await check('composition renders layers, crop, opacity, movement and retimed source frames', async () => {
        await openComposition();
        await seekComposition(100); await readyComposition(100);
        const purple = await canvasPixel(96, 55);
        assert.ok(purple[0]! > 100 && purple[0]! < 155 && purple[1]! < 20 && purple[2]! > 100 && purple[2]! < 155, `expected half-blue over red, got ${purple}`);
        assert.ok((await canvasPixel(230, 220))[0]! > 230);
        assert.equal(await whitePixels(0, 240), 0, 'hidden, disabled and future text must not render');
        await seekComposition(400); await readyComposition(400);
        const retimed = await canvasPixel(230, 220);
        assert.ok(retimed[1]! > 230 && retimed[0]! < 20, `sourceIn500 + speed2 must show green at400ms, got ${retimed}`);
        const moved = await canvasPixel(144, 55);
        assert.ok(moved[1]! > 100 && moved[1]! < 155 && moved[2]! > 100, `moving blue image must blend over green, got ${moved}`);
        assert.ok((await canvasPixel(96, 55))[2]! < 20, 'old image position must be clear');
    });
    await check('composition respects title and remapped-caption windows and clears gaps', async () => {
        await openComposition();
        await seekComposition(700); await readyComposition(700);
        assert.ok(await whitePixels(85, 145) > 100, 'active title must be drawn');
        await seekComposition(1200); await readyComposition(1200);
        assert.equal(await whitePixels(85, 145), 0, 'ended title must disappear');
        assert.ok(await whitePixels(145, 210) > 100, 'caption must follow moved clip timing');
        await seekComposition(1800); await readyComposition(1800);
        assert.equal(await whitePixels(0, 240), 0);
        const gap = await canvasPixel(160, 120);
        assert.ok(gap[0]! < 25 && gap[1]! < 25 && gap[2]! < 25, `gap must clear prior content, got ${gap}`);
    });
    await check('composition ignores stale async loading after a newer seek', async () => {
        await page.evaluate(() => { (window as any).fixture.holdMedia = 'video-media-overlay'; });
        await openComposition();
        await page.waitForFunction(() => Boolean((window as any).fixture.pendingMedia['video-media-overlay']));
        await seekComposition(1800);
        await readyComposition(1800);
        await page.evaluate(() => (window as any).fixture.pendingMedia['video-media-overlay']());
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        assert.equal(await page.getByLabel('Composition preview', { exact: true }).getAttribute('data-time-ms'), '1800');
        const pixel = await canvasPixel(160, 120);
        assert.ok(pixel[0]! < 25 && pixel[1]! < 25 && pixel[2]! < 25);
    });
    await check('composition shows missing-media errors without pretending a frame is ready', async () => {
        await page.evaluate(() => { (window as any).fixture.missingMedia = 'video-media-overlay'; });
        await openComposition();
        await page.getByRole('alert').filter({ hasText: /Media unavailable|media unavailable/ }).waitFor();
        assert.equal(await page.getByLabel('Composition preview', { exact: true }).getAttribute('data-state'), 'error');
        await page.evaluate(() => { (window as any).fixture.missingMedia = null; });
        await page.getByRole('button', { name: 'Retry preview', exact: true }).focus();
        await page.keyboard.press('Space');
        await readyComposition(0);
        assert.equal(await page.getByRole('alert').count(), 0, 'Space must activate Retry after missing media is repaired');
    });
    await check('composition rejects a relinked source identity instead of drawing the old asset', async () => {
        await openComposition();
        await seekComposition(100); await readyComposition(100);
        const requests = await page.evaluate(() => (window as any).fixture.mediaRequests);
        assert.ok(requests.some((request: any) => request.asset === 'video-media-overlay' && request.expectedSourcePath === '/synthetic/overlay.png'));
        await page.evaluate(() => (window as any).fixture.relink('overlay', '/synthetic/relinked.png'));
        await page.getByRole('alert').filter({ hasText: /source mismatch/ }).waitFor();
        const canvas = page.getByLabel('Composition preview', { exact: true });
        assert.equal(await canvas.getAttribute('data-state'), 'error');
        assert.equal(await canvas.getAttribute('data-time-ms'), null, 'old successful frame timestamp must be cleared');
        assert.equal((await canvasPixel(96, 55))[3], 0, 'old composited pixels must be cleared');
    });
}
finally {
    try {
        await browser?.close();
    }
    finally {
        rmSync(temporary, { recursive: true, force: true });
    }
}
console.log(`${passed} passed; ${failed} failed`);
if (failed)
    process.exitCode = 1;
