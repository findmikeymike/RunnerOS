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
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    await page.route('https://video-studio-fixture.test/**', route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/source.mp4' || path === '/render.mp4') {
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
