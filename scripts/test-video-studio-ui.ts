/**
 * Run: bun scripts/test-video-studio-ui.ts
 * Requires installed Google Chrome and FFmpeg; PLAYWRIGHT_CHANNEL can override Chrome.
 * Runs real VideoStudioPage and native media in a disposable browser profile.
 * Shell, presentation wrappers, and IO use synthetic fixtures; no app profile or providers.
 */
import { build } from 'esbuild';
import { build as buildStyles } from 'vite';
import tailwindcss from '@tailwindcss/vite';
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
const buildFixture = (realPresentation = false) => build({
    entryPoints: [resolve(import.meta.dir, 'fixtures/video-studio-ui.tsx')],
    bundle: true,
    write: false,
    outdir: '/tmp/video-studio-fixture-bundle',
    platform: 'browser',
    loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' },
    format: 'iife',
    jsx: 'automatic',
    tsconfig: resolve(base, 'apps/electron/tsconfig.json'),
    plugins: [{
        name: 'fixture-boundaries',
        setup(builder) {
            builder.onResolve({ filter: /.*/ }, args => {
                const key = boundaries[args.path];
                if (realPresentation && key === 'menu') return { path: resolve(base, 'packages/ui/src/components/ui/StyledDropdown.tsx') };
                return key && !(realPresentation && ['button', 'menu'].includes(key)) ? { path: key, namespace: 'fixture' } : undefined;
            });
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({
                contents: stubs[args.path],
                loader: 'jsx',
                resolveDir: base,
            }));
        },
    }],
});

const bundle = await buildFixture();
const layoutBundle = await buildFixture(true);
const styleBuild = await buildStyles({
    configFile: false, root: base, logLevel: 'error', plugins: [tailwindcss()],
    build: { write: false, minify: false, rollupOptions: { input: resolve(base, 'apps/electron/src/renderer/index.css') } },
});
assert.ok('output' in styleBuild, 'CSS build must return assets');
const stylesheet = styleBuild.output.find(asset => asset.type === 'asset' && asset.fileName.endsWith('.css'));
assert.ok(stylesheet?.type === 'asset', 'real compiled design CSS is required');

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
    for (const [name, frequency] of [['tone-video', 440], ['tone-audio', 880]] as const) {
        const args = name === 'tone-video'
            ? ['-f', 'lavfi', '-i', 'color=red:s=320x240:r=10:d=8', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=8`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac']
            : ['-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=8`, '-c:a', 'aac'];
        const made = spawnSync('ffmpeg', ['-v', 'error', ...args, join(temporary, `${name}.mp4`)], { encoding: 'utf8' });
        assert.equal(made.status, 0, made.stderr);
    }
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', args: ['--mute-audio'] });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    await page.addInitScript(() => {
        const captured = (window as any).audioCapture = { analysers: [] as AnalyserNode[], masters: [] as GainNode[], masterCommands: [] as Array<{param:AudioParam;value:number;time:number;wall:number}>, sources: [] as any[], measure: () => 0 };
        const sinks = new WeakMap<BaseAudioContext, AnalyserNode>();
        const connect = AudioNode.prototype.connect;
        AudioNode.prototype.connect = function (destination: any, ...args: any[]) {
            if (destination === this.context.destination) {
                if (this instanceof GainNode) captured.masters.push(this);
                let analyser = sinks.get(this.context);
                if (!analyser) {
                    analyser = this.context.createAnalyser(); analyser.fftSize = 4096;
                    const silentSink = (this.context as AudioContext).createMediaStreamDestination();
                    connect.call(analyser, silentSink);
                    sinks.set(this.context, analyser); captured.analysers.push(analyser);
                }
                destination = analyser;
            }
            return (connect as any).call(this, destination, ...args);
        } as typeof connect;
        const setValueAtTime=AudioParam.prototype.setValueAtTime;
        AudioParam.prototype.setValueAtTime=function(value:number,time:number) {
            if(captured.masters.some(master=>master.gain===this)) captured.masterCommands.push({param:this,value,time,wall:performance.now()});
            return setValueAtTime.call(this,value,time);
        };
        const createSource = AudioContext.prototype.createMediaElementSource;
        AudioContext.prototype.createMediaElementSource = function (element) {
            captured.sources.push(element);
            return createSource.call(this, element);
        };
        captured.measure = () => {
            let sum = 0, count = 0;
            for (const analyser of captured.analysers) {
                const samples = new Float32Array(analyser.fftSize);
                analyser.getFloatTimeDomainData(samples);
                for (const sample of samples) { sum += sample * sample; count++; }
            }
            return count ? Math.sqrt(sum / count) : 0;
        };
    });
    await page.route('https://video-studio-fixture.test/**', route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/overlay.png') return route.fulfill({ contentType: 'image/png', body: readFileSync(join(temporary, 'overlay.png')) });
        if (path === '/source.mp4' || path === '/render.mp4' || path === '/clock.mp4' || path === '/tone-video.mp4' || path === '/tone-audio.mp4') {
            const bytes = readFileSync(join(temporary, path.slice(1)));
            const range = route.request().headers()['range']?.match(/bytes=(\d+)-(\d*)/);
            if (range) {
                const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
                return route.fulfill({ status: 206, contentType: 'video/mp4', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${bytes.length}` }, body: bytes.subarray(start, end + 1) });
            }
            return route.fulfill({ contentType: 'video/mp4', headers: { 'Accept-Ranges': 'bytes' }, body: bytes });
        }
        if (path === '/fixture.css') return route.fulfill({ contentType: 'text/css', body: String(stylesheet.source) + '\n' + layoutBundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n') });
        if (path === '/fixture-layout.js') return route.fulfill({ contentType: 'text/javascript', body: layoutBundle.outputFiles[0]!.text });
        if (path === '/fixture.js')
            return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0]!.text });
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="dark"><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root" style="height:100vh;min-width:0"></div><script src="/${new URL(route.request().url()).searchParams.has('layout') ? 'fixture-layout' : 'fixture'}.js"></script></body></html>` });
    });
    page.setDefaultTimeout(6000);
    page.on('dialog', dialog => dialog.accept());
    let errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const fixture = () => page.evaluate(() => ({ calls: (window as any).fixture.calls, navigations: (window as any).fixture.navigations, drafts: (window as any).fixture.drafts, disk: (window as any).fixture.disk(), initialText: (window as any).fixture.initialText, toasts: (window as any).fixture.toasts }));
    const reopen = async () => { await page.evaluate(() => { (window as any).fixture.unmount(); (window as any).fixture.mount(); }); await page.getByRole('button', { name: 'Restore draft', exact: true }).waitFor(); };
    const edit = () => page.getByRole('button', { name: 'Add title', exact: true }).click();
    const openInspector = async () => { const toggle = page.getByRole('button', { name: 'Toggle inspector', exact: true }); if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click(); };
    const raw = async () => { await openInspector(); const details=page.getByRole('button', { name: /Developer details/ }); if ((await details.textContent())?.endsWith('Show'))
        await details.click(); return page.locator('textarea').last(); };
    const save = () => page.getByRole('button', { name: 'Save project', exact: true }).click();
    const check = async (name: string, body: () => Promise<void>, layout = false) => {
        if (process.env.VIDEO_UI_LAYOUT_ONLY && !layout) return;
        if (process.env.VIDEO_UI_MATCH && !name.includes(process.env.VIDEO_UI_MATCH)) return;
        try {
            errors = [];
            await page.goto(`https://video-studio-fixture.test/${layout ? '?layout=1' : ''}`);
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
            console.error(await page.evaluate(() => ({ canvas: document.querySelector('canvas[aria-label="Composition preview"]')?.outerHTML, alerts: [...document.querySelectorAll('[role="alert"]')].map(e => e.textContent), video: document.querySelector('video') ? { time: document.querySelector('video')!.currentTime, duration: document.querySelector('video')!.duration, seekable: document.querySelector('video')!.seekable.length ? document.querySelector('video')!.seekable.end(0) : 0, seeking: document.querySelector('video')!.seeking, ready: document.querySelector('video')!.readyState } : null, markers: Array.from(document.querySelectorAll('div[aria-hidden="true"][style]')).map(e => (e as HTMLElement).style.cssText) })));
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
    for (const command of ['Inspect','Dry run']) for (const ok of [true,false]) {
      await check(`history survives ${command} ${ok ? 'success' : 'failure'}`, async () => {
        await edit();
        const selection=await page.getByPlaceholder('Clip Name',{exact:true}).inputValue();
        await page.evaluate(value=>(window as any).fixture.reportOk=value,ok);
        await page.getByRole('button',{name:command,exact:true}).click();
        await page.waitForFunction(()=>!(document.querySelector('button[title="Undo"]') as HTMLButtonElement)?.disabled);
        assert.equal(await page.getByPlaceholder('Clip Name',{exact:true}).inputValue(),selection);
        await page.getByRole('button',{name:'Undo',exact:true}).click();
        const project=JSON.parse(await (await raw()).inputValue());
        assert.equal(project.timeline.tracks.flatMap((track:any)=>track.clips).length,1);
        assert.equal(project.agentEvents[0].id,'metadata-event');
        assert.ok(project.versions.length>0);
        await page.getByRole('button',{name:'Redo',exact:true}).click();
        assert.equal(JSON.parse(await (await raw()).inputValue()).timeline.tracks.flatMap((track:any)=>track.clips).length,2);
      });
    }
    for (const ripple of [false,true]) await check(`accurate timeline contiguous trim ${ripple ? 'ripple' : 'normal'}`, async () => {
      await page.evaluate(()=>(window as any).fixture.contiguousClips());
      const rawInput=await raw();
      const first=page.locator('[data-video-clip-id="clip"]'), next=page.locator('[data-video-clip-id="next"]');
      await next.waitFor();
      const a=await first.boundingBox(), b=await next.boundingBox(); assert.ok(a&&b);
      assert.ok(Math.abs(a.width-1000/12)<0.1,`accurate first width ${a.width}`);
      assert.ok(Math.abs(a.x+a.width-b.x)<0.1,'contiguous clips share their true boundary');
      const tail=await page.locator('[data-video-clip-id="gap-tail"]').boundingBox();assert.ok(tail);
      assert.ok(Math.abs(tail.width-10000/12)<0.1,'long cards must not cap at640px');
      assert.ok(Math.abs(tail.x-(b.x+b.width)-1000/12)<0.1,'real gaps remain visible');
      if(ripple) await page.locator('button[title="Ripple trim and delete"]').click();
      const edge=await first.locator('[data-trim-edge="end"]').boundingBox();assert.ok(edge);
      const x=edge.x+edge.width/2,y=edge.y+edge.height/2;
      assert.equal(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.getAttribute('data-trim-edge'),{x,y}),'end','next clip must not cover prior trim handle');
      await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+(ripple ? 500 : -400)/12,y,{steps:8});await page.mouse.up();
      const clips=JSON.parse(await rawInput.inputValue()).timeline.tracks[0].clips;
      assert.ok(Math.abs(clips[0].durationMs-(ripple?1500:600))<=12,JSON.stringify(clips));
      assert.ok(Math.abs(clips[1].startMs-(ripple?1500:1000))<=12);
    });
    await check('accurate timeline short clips at minimum zoom keep controls inside time bounds', async () => {
      await page.evaluate(()=>(window as any).fixture.contiguousClips(true));
      await page.locator('[data-video-clip-id="next"]').waitFor();
      await page.getByRole('slider',{name:'Zoom',exact:true}).fill('0.5');
      const first=page.locator('[data-video-clip-id="clip"]'),next=page.locator('[data-video-clip-id="next"]');
      const a=await first.boundingBox(),b=await next.boundingBox();assert.ok(a&&b);
      assert.ok(Math.abs(a.width-100/24)<0.1,`short width ${a.width}`);
      assert.ok(a.x+a.width<=b.x+0.1,'short cards cannot overlap neighbors');
      const start=await first.locator('[data-trim-edge="start"]').boundingBox(),end=await first.locator('[data-trim-edge="end"]').boundingBox();assert.ok(start&&end);
      assert.ok(start.x>=a.x && end.x+end.width<=a.x+a.width+0.1 && start.x+start.width<end.x,'trim targets must stay inside their own card and leave a move target');
      await page.mouse.click(a.x+a.width/2,a.y+a.height/2);
      assert.equal(await page.getByPlaceholder('Clip Name',{exact:true}).inputValue(),'Synthetic clip');
      assert.match(await first.getAttribute('title') || '',/Zoom in/);
      await page.getByRole('slider',{name:'Zoom',exact:true}).fill('2.5');
      const expanded=await first.boundingBox();assert.ok(expanded);
      assert.ok(expanded.width>a.width*4.9,'zoom makes precise trimming usable without altering time');
    });
    for (const ripple of [false, true]) await check(`trailing trim source drag ${ripple ? 'ripple' : 'normal'}`, async () => {
      await page.evaluate(value => (window as any).fixture.trimBounds(value), ripple);
      const rawInput = await raw();
      await page.waitForFunction(() => document.querySelectorAll('textarea').length > 0 && [...document.querySelectorAll('textarea')].some(input => input.value.includes('Next clip')));
      if (ripple) await page.locator('button[title="Ripple trim and delete"]').click();
      const clipButton = page.getByRole('button', { name: /Synthetic clip/ }).last();
      const handle = clipButton.locator('span.cursor-ew-resize').last();
      const box = await handle.boundingBox(); assert.ok(box);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down(); await page.mouse.move(box.x + 600, box.y + box.height / 2, { steps: 12 }); await page.mouse.up();
      const project = JSON.parse(await rawInput.inputValue());
      const clips = project.timeline.tracks[0].clips;
      assert.equal(clips[0].durationMs, ripple ? 2000 : 1500);
      assert.equal(clips[1].startMs, ripple ? 2500 : 1500);
    });
    await check('history survives export output notifications and retains render metadata', async () => {
      await edit();
      const selection=await page.getByPlaceholder('Clip Name',{exact:true}).inputValue();
      await page.getByRole('button',{name:'Render & review',exact:true}).click();
      await page.waitForFunction(()=>!!(window as any).fixture.calls.find((call:any)=>call.action==='export') && !(document.querySelector('button[title="Undo"]') as HTMLButtonElement)?.disabled);
      assert.equal(await page.getByPlaceholder('Clip Name',{exact:true}).inputValue(),selection);
      await page.getByRole('button',{name:'Undo',exact:true}).click();
      const project=JSON.parse(await (await raw()).inputValue());
      assert.equal(project.exports[0].id,'render-receipt');
      assert.equal(project.timeline.tracks.flatMap((track:any)=>track.clips).length,1);
    });
    await check('history and dirty edits survive metadata-only external notifications', async () => {
      await edit();
      await page.evaluate(()=>(window as any).fixture.metadata());
      await raw();
      await page.waitForFunction(()=>JSON.parse((Array.from(document.querySelectorAll('textarea')).at(-1) as HTMLTextAreaElement).value).agentEvents?.length>0);
      await page.getByRole('button',{name:'Undo',exact:true}).click();
      assert.equal(JSON.parse(await (await raw()).inputValue()).timeline.tracks.flatMap((track:any)=>track.clips).length,1);
      await page.getByRole('button',{name:'Redo',exact:true}).click();
      await save();
      assert.equal(JSON.parse((await fixture()).disk).timeline.tracks.flatMap((track:any)=>track.clips).length,2);
    });
    await check('history is preserved when an external composition arrives during inspect', async () => {
      await edit();
      await page.evaluate(()=>(window as any).fixture.holdReport=true);
      await page.getByRole('button',{name:'Inspect',exact:true}).click();
      await page.waitForFunction(()=>!!(window as any).fixture.finishReport);
      await page.evaluate(()=>{(window as any).fixture.external('External composition');(window as any).fixture.finishReport()});
      await page.getByRole('button',{name:'Reload',exact:true}).last().waitFor();
      assert.equal(await page.getByLabel('Project title',{exact:true}).inputValue(),'Synthetic video');
      await page.getByRole('button',{name:'Undo',exact:true}).click();
      assert.equal(JSON.parse(await (await raw()).inputValue()).timeline.tracks.flatMap((track:any)=>track.clips).length,1);
      assert.equal(JSON.parse((await fixture()).disk).title,'External composition');
    });
    await check('history and old render freshness survive an external composition during export', async () => {
      await page.getByRole('button',{name:'Render & review',exact:true}).click();
      await page.getByText('rendered result',{exact:true}).waitFor();
      await edit();
      await page.getByText('edited since render · render again',{exact:true}).waitFor();
      await page.evaluate(()=>(window as any).fixture.holdExport=true);
      await page.getByRole('button',{name:'Render & review',exact:true}).click();
      await page.waitForFunction(()=>!!(window as any).fixture.finishExport);
      await page.evaluate(()=>{(window as any).fixture.external('External export composition');(window as any).fixture.finishExport()});
      await page.getByRole('button',{name:'Reload',exact:true}).last().waitFor();
      assert.equal(await page.getByLabel('Project title',{exact:true}).inputValue(),'Synthetic video');
      await page.getByText('edited since render · render again',{exact:true}).waitFor();
      await page.getByRole('button',{name:'Undo',exact:true}).click();
      assert.equal(JSON.parse(await (await raw()).inputValue()).timeline.tracks.flatMap((track:any)=>track.clips).length,1);
      assert.equal(JSON.parse((await fixture()).disk).title,'External export composition');
    });
    await check('saving preserves undo and redo without treating saved history as a dirty draft', async () => {
        await edit(); await page.keyboard.press(process.platform==='darwin'?'Meta+s':'Control+s');
        await page.waitForFunction(()=>(window as any).fixture.calls.length===1);
        await page.getByRole('button',{name:'Undo',exact:true}).click();
        assert.equal(JSON.parse(await (await raw()).inputValue()).timeline.tracks.flatMap((t:any)=>t.clips).length,1);
        await page.getByRole('button',{name:'Redo',exact:true}).click();
        assert.equal(JSON.parse(await (await raw()).inputValue()).timeline.tracks.flatMap((t:any)=>t.clips).length,2);
        await save();
        await page.waitForFunction(()=>(window as any).fixture.calls.length===2);
        await page.evaluate(()=>(window as any).fixture.external('External after saved history'));
        await page.waitForFunction(()=>document.querySelector<HTMLInputElement>('input[aria-label="Project title"]')?.value==='External after saved history');
        assert.equal(await page.getByRole('button',{name:'Undo',exact:true}).isEnabled(),false,'external load starts a new history');
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
    const openAgent = async () => { await openInspector(); await page.getByRole('button', { name: 'Video Agent', exact: true }).click(); await page.getByPlaceholder('Make this a 9:16 punchy short...').fill('Synthetic trim request'); };
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
    await check('silent composition playback advances through layers, titles, captions and gaps then stops at end', async () => {
        await openComposition(); await readyComposition(0);
        await page.evaluate(() => {
            const fixture = (window as any).fixture;
            fixture.playbackFrames = {};
            fixture.playbackRequestBaseline = fixture.mediaRequests.length;
            document.querySelector('button[title="Play"]')!.addEventListener('click', () => { fixture.playbackStartedAt = performance.now(); }, { once: true });
            const sample = () => {
                const canvas = document.querySelector('canvas[aria-label="Composition preview"]') as HTMLCanvasElement | null;
                if (!canvas) return;
                const time = Number(canvas.dataset.timeMs);
                if (canvas.dataset.state === 'ready') {
                    const bucket = time >= 50 && time < 450 ? 'layer' : time >= 600 && time < 850 ? 'title' : time >= 1100 && time < 1300 ? 'caption' : time >= 1750 && time < 1950 ? 'gap' : time >= 2250 ? 'tail' : null;
                    if (bucket && !fixture.playbackFrames[bucket]) {
                        const ctx = canvas.getContext('2d')!;
                        const white = (top: number, bottom: number) => {
                            const data = ctx.getImageData(0, top, canvas.width, bottom - top).data;
                            let count = 0;
                            for (let i = 0; i < data.length; i += 4) if (data[i]! > 190 && data[i + 1]! > 190 && data[i + 2]! > 190) count++;
                            return count;
                        };
                        fixture.playbackFrames[bucket] = { time, pixel: [...ctx.getImageData(160, 120, 1, 1).data], layerPixel: [...ctx.getImageData(Math.min(319, Math.round(80 + time * 0.16)), 55, 1, 1).data], title: white(85, 145), caption: white(145, 210) };
                    }
                }
                if (time >= 2400) fixture.playbackElapsed = performance.now() - fixture.playbackStartedAt;
                else fixture.playbackSampleFrame = requestAnimationFrame(sample);
            };
            fixture.playbackSampleFrame = requestAnimationFrame(sample);
        });
        await page.getByTitle('Play', { exact: true }).click();
        await page.waitForFunction(() => Number((document.querySelector('input[aria-label="Composition time"]') as HTMLInputElement)?.value) >= 2400);
        await page.getByTitle('Play', { exact: true }).waitFor();
        await readyComposition(2400);
        const observations = await page.evaluate(() => {
            cancelAnimationFrame((window as any).fixture.playbackSampleFrame);
            const fixture = (window as any).fixture;
            return { frames: fixture.playbackFrames, requests: fixture.mediaRequests.slice(fixture.playbackRequestBaseline), elapsed: fixture.playbackElapsed };
        });
        assert.deepEqual(Object.keys(observations.frames).sort(), ['caption', 'gap', 'layer', 'tail', 'title']);
        assert.ok(observations.elapsed >= 2300 && observations.elapsed <= 2900, `2400ms timeline must track wall time after media is ready, took ${observations.elapsed}ms`);
        assert.ok(observations.frames.layer.layerPixel[2] > 100 && observations.frames.layer.layerPixel[2] < 155, 'moving half-opacity image must remain composited during playback');
        assert.ok(observations.frames.title.title > 100);
        assert.ok(observations.frames.caption.caption > 100);
        assert.equal(observations.frames.gap.title + observations.frames.gap.caption, 0);
        assert.ok(observations.frames.gap.pixel.slice(0, 3).every((value: number) => value < 25));
        for (const asset of ['video-media-clock', 'video-media-overlay']) {
            assert.equal(observations.requests.filter((request: any) => request.asset === asset && request.expectedSourcePath).length, 0, 'playback must retain media instead of loading it on each frame');
        }
    });
    await check('composition pause is stable and seeking during playback reanchors the clock', async () => {
        await openComposition(); await readyComposition(0);
        await page.getByTitle('Play', { exact: true }).click();
        await page.waitForFunction(() => Number((document.querySelector('input[aria-label="Composition time"]') as HTMLInputElement)?.value) > 300);
        await page.getByTitle('Pause', { exact: true }).click();
        await page.waitForTimeout(80); // Allow the already requested frame to settle.
        const paused = await page.getByLabel('Composition time', { exact: true }).inputValue();
        await page.waitForTimeout(200);
        assert.equal(await page.getByLabel('Composition time', { exact: true }).inputValue(), paused);
        await page.getByTitle('Play', { exact: true }).click();
        await seekComposition(1750);
        await page.waitForFunction(() => {
            const canvas = document.querySelector('canvas[aria-label="Composition preview"]');
            const time = Number(canvas?.getAttribute('data-time-ms'));
            return canvas?.getAttribute('data-state') === 'ready' && time > 1800 && time < 2150;
        });
        assert.ok((await canvasPixel(160, 120)).slice(0, 3).every(value => value < 25));
        await page.getByTitle('Pause', { exact: true }).click();
        const reanchored = Number(await page.getByLabel('Composition time', { exact: true }).inputValue());
        assert.ok(reanchored > 1750 && reanchored < 2300, `seek must continue from requested time, got ${reanchored}`);
    });
    await check('switching from playing composition disposes its old clock', async () => {
        await openComposition(); await readyComposition(0);
        await page.getByTitle('Play', { exact: true }).click();
        await page.waitForFunction(() => Number((document.querySelector('input[aria-label="Composition time"]') as HTMLInputElement)?.value) > 300);
        await page.evaluate(() => { (window as any).fixture.retiredCanvas = document.querySelector('canvas[aria-label="Composition preview"]'); });
        await page.getByRole('button', { name: 'Source', exact: true }).click();
        await page.getByTitle('Play', { exact: true }).waitFor();
        assert.equal(await page.getByLabel('Composition preview', { exact: true }).count(), 0);
        const stopped = await page.evaluate(() => (window as any).fixture.retiredCanvas.dataset.timeMs);
        await page.waitForTimeout(250);
        assert.equal(await page.evaluate(() => (window as any).fixture.retiredCanvas.dataset.timeMs), stopped);
        assert.equal(await page.getByTitle('Pause', { exact: true }).count(), 0);
    });
    await check('hiding composition pauses playback and showing it does not resume the old clock', async () => {
        await openComposition(); await readyComposition(0);
        await page.getByTitle('Play', { exact: true }).click();
        await page.waitForFunction(() => Number((document.querySelector('input[aria-label="Composition time"]') as HTMLInputElement)?.value) > 300);
        await page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
            Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.getByTitle('Play', { exact: true }).waitFor();
        await page.waitForTimeout(80);
        const stopped = await page.getByLabel('Composition time', { exact: true }).inputValue();
        await page.waitForTimeout(250);
        assert.equal(await page.getByLabel('Composition time', { exact: true }).inputValue(), stopped);
        await page.evaluate(() => {
            delete (document as any).visibilityState;
            delete (document as any).hidden;
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.waitForTimeout(250);
        assert.equal(await page.getByLabel('Composition time', { exact: true }).inputValue(), stopped);
        assert.equal(await page.getByTitle('Pause', { exact: true }).count(), 0);
        // Repeat while a future image is still loading: visibility restoration must redraw paused.
        await page.evaluate(() => { (window as any).fixture.holdMedia = 'video-media-overlay'; });
        await openComposition();
        await seekComposition(1800); await readyComposition(1800);
        await page.getByTitle('Play', { exact: true }).click();
        await page.waitForFunction(() => {
            const canvas = document.querySelector('canvas[aria-label="Composition preview"]');
            return canvas?.getAttribute('data-state') === 'loading' && !!(window as any).fixture.pendingMedia['video-media-overlay'];
        });
        await page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
            Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.getByTitle('Play', { exact: true }).waitFor();
        await page.evaluate(() => {
            delete (document as any).visibilityState;
            delete (document as any).hidden;
            (window as any).fixture.holdMedia = null;
            (window as any).fixture.pendingMedia['video-media-overlay']();
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.waitForFunction(() => document.querySelector('canvas[aria-label="Composition preview"]')?.getAttribute('data-state') === 'ready');
        const restored = await page.getByLabel('Composition time', { exact: true }).inputValue();
        await page.waitForTimeout(200);
        assert.equal(await page.getByLabel('Composition time', { exact: true }).inputValue(), restored);
        assert.equal(await page.getByTitle('Pause', { exact: true }).count(), 0);
    });
    await check('slow native play buffers without turning a delayed start into a fatal error', async () => {
        await openComposition(); await readyComposition(0);
        await page.evaluate(() => {
            const originalPlay = HTMLMediaElement.prototype.play;
            let delayed = false;
            HTMLMediaElement.prototype.play = function () {
                if (delayed) return originalPlay.call(this);
                delayed = true;
                (window as any).fixture.delayedNativePlay = true;
                const native = originalPlay.call(this);
                return Promise.all([native, new Promise(resolve => setTimeout(resolve, 350))]).then(() => {});
            };
        });
        await page.getByTitle('Play', { exact: true }).click();
        await page.waitForFunction(() => (window as any).fixture.delayedNativePlay === true);
        await page.waitForFunction(() => {
            const canvas = document.querySelector('canvas[aria-label="Composition preview"]');
            return canvas?.getAttribute('data-state') === 'ready' && Number(canvas.getAttribute('data-time-ms')) > 500;
        });
        assert.equal(await page.getByRole('alert').count(), 0);
        await page.getByTitle('Pause', { exact: true }).click();
    });
    await check('overlapping clips of one source keep separate retimed video decoders', async () => {
        await page.evaluate(() => (window as any).fixture.composition(true));
        await page.getByRole('button', { name: 'Composition', exact: true }).click();
        await seekComposition(500); await readyComposition(500);
        const left = await canvasPixel(80, 120), right = await canvasPixel(240, 120);
        assert.ok(left[0] > 220 && left[1] < 30 && left[2] < 30, `left clip must be red, got ${left}`);
        assert.ok(right[2] > 220 && right[0] < 30, `right clip must be blue at different source time, got ${right}`);
        await seekComposition(1100); await readyComposition(1100);
        assert.ok((await canvasPixel(80, 120))[1] > 220, 'left clip advances into green source segment');
        assert.ok((await canvasPixel(240, 120))[2] > 220, 'slower right clip remains blue');
        await seekComposition(0); await readyComposition(0);
        await page.getByTitle('Play', { exact: true }).click();
        await page.waitForFunction(() => {
            const canvas = document.querySelector('canvas[aria-label="Composition preview"]') as HTMLCanvasElement;
            const time = Number(canvas?.dataset.timeMs);
            if (canvas?.dataset.state !== 'ready' || time < 300 || time > 900) return false;
            const ctx = canvas.getContext('2d')!;
            return ctx.getImageData(80, 120, 1, 1).data[0]! > 220 && ctx.getImageData(240, 120, 1, 1).data[2]! > 220;
        });
        await page.getByTitle('Pause', { exact: true }).click();
    });
    const openAudio = async (mode = 'basic') => {
        await page.evaluate(mode => (window as any).fixture.audio(mode), mode);
        await page.getByRole('button', { name: 'Composition', exact: true }).click();
        await readyComposition(0);
    };
    const rms = () => page.evaluate(() => (window as any).audioCapture.measure() as number);
    const audioAt = async (time: number) => {
        if (await page.getByTitle('Pause', { exact: true }).count()) await page.getByTitle('Pause', { exact: true }).click();
        await seekComposition(time); await readyComposition(time);
        await page.getByTitle('Play', { exact: true }).click();
        await page.waitForFunction(time => Number((document.querySelector('input[aria-label="Composition time"]') as HTMLInputElement)?.value) > time + 150, time);
        const level = await rms();
        await page.getByTitle('Pause', { exact: true }).click();
        return level;
    };
    const assertSilentGraph = async (reason: string) => {
        if(reason==='pause') await page.getByTitle('Play',{exact:true}).waitFor();
        const frames = await page.evaluate(() => {
            const capture=(window as any).audioCapture;
            return { commandCount:capture.masterCommands.length, committedWall:performance.now(),
                sequence:capture.masterCommands.slice(-4).map((event:any)=>({value:event.value,time:event.time,wall:event.wall})),
                gains:capture.masters.map((master:GainNode)=>master.gain.value),
                commands:capture.masters.map((master:GainNode)=>capture.masterCommands.filter((event:any)=>event.param===master.gain).at(-1)?.value),
                clocks:capture.analysers.map((analyser:AnalyserNode)=>({time:analyser.context.currentTime,window:analyser.fftSize/analyser.context.sampleRate})) };
        });
        if(process.env.VIDEO_UI_AUDIO_DIAGNOSTIC) console.log(`AUDIO ${reason} ${JSON.stringify(frames)}`);
        assert.ok(frames.commands.length>0 && frames.commands.every((gain:number)=>gain===0),`${reason}: master must be commanded silent immediately: ${JSON.stringify(frames)}`);
        // Analyser data retains an entire FFT window. Under host load, wall time
        // can advance before the audio clock has produced fresh silent samples.
        await page.waitForFunction((clocks:any[]) => {
            const capture=(window as any).audioCapture;
            return clocks.every((clock,index)=>capture.analysers[index].context.currentTime>=clock.time+clock.window+0.01)
                && capture.measure()<0.0001;
        },frames.clocks,{timeout:2000});
        const laterCommands=await page.evaluate((count:number)=>(window as any).audioCapture.masterCommands.slice(count).map((event:any)=>({value:event.value,time:event.time,wall:event.wall})),frames.commandCount);
        assert.ok(laterCommands.every((event:any)=>event.value===0),`${reason}: audio must never unmute after the committed silence command: ${JSON.stringify(laterCommands)}`);
        assert.ok(await rms()<0.0001,`${reason}: fresh output samples must be silent`);
        assert.equal(await page.evaluate(()=>(window as any).audioCapture.masters.every((master:GainNode)=>master.gain.value===0)),true,`${reason}: settled master gain must be zero`);
    };
    await check('composition audio requires opt-in and measured output goes silent on pause, mute and hide', async () => {
        await openAudio();
        await page.getByTitle('Play', { exact: true }).click();
        await page.waitForTimeout(250);
        assert.equal(await rms(), 0, 'sound is opt-in');
        await page.getByRole('button', { name: 'Enable sound', exact: true }).click();
        await page.waitForFunction(() => (window as any).audioCapture.measure() > 0.015);
        await page.getByTitle('Pause', { exact: true }).click();
        await assertSilentGraph('pause');
        await page.getByTitle('Play', { exact: true }).click();
        await page.waitForFunction(() => (window as any).audioCapture.measure() > 0.015);
        await page.getByRole('button', { name: 'Mute preview', exact: true }).click();
        await assertSilentGraph('mute');
        await page.getByRole('button', { name: 'Enable sound', exact: true }).click();
        await page.waitForFunction(() => (window as any).audioCapture.measure() > 0.015);
        await page.evaluate(() => {
            Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.getByTitle('Play', { exact: true }).waitFor();
        await assertSilentGraph('hidden page');
    });
    await check('real audio output follows seeked volume and fade envelopes', async () => {
        await openAudio('fade');
        await page.getByRole('button', { name: 'Enable sound', exact: true }).click();
        const early = await audioAt(100), middle = await audioAt(2400), late = await audioAt(4600);
        assert.ok(middle > 0.006, `middle fade section must be audible, RMS ${middle}`);
        assert.ok(early < middle * 0.45, `fade in must attenuate: ${early} vs ${middle}`);
        assert.ok(late < middle * 0.45, `fade out must attenuate: ${late} vs ${middle}`);
        assert.ok(middle < 0.035, `volume0.5 with normalized video+audio mix must attenuate full sine RMS, got ${middle}`);
    });
    await check('duplicate audio clips keep independent gain, source offsets and playback speeds', async () => {
        await openAudio('duplicate');
        await page.getByRole('button', { name: 'Enable sound', exact: true }).click();
        const first = await audioAt(100), mixed = await audioAt(1500);
        assert.ok(first > 0.001, `first clip must produce measured audio, got ${first}`);
        assert.ok(mixed > first * 2, `second louder clip must increase measured mix: ${first} -> ${mixed}`);
        const sources = await page.evaluate(() => (window as any).audioCapture.sources.filter((source: HTMLMediaElement) => source.src.endsWith('tone-audio.mp4')).map((source: HTMLMediaElement) => ({ time: source.currentTime, speed: source.playbackRate })));
        assert.ok(sources.some((source: any) => source.speed === 1) && sources.some((source: any) => source.speed === 2), 'same asset needs distinct live speed1 and speed2 decoders');
        const slow = sources.find((source: any) => source.speed === 1), fast = sources.find((source: any) => source.speed === 2);
        assert.ok(fast.time > slow.time + 0.3, `different source offsets must remain independent: ${JSON.stringify(sources)}`);
    });
    await check('audible composition silences its actual graph while buffering and after media failure', async () => {
        await openAudio('stall');
        await page.evaluate(() => { (window as any).fixture.holdMedia = 'video-media-audio'; });
        await page.getByRole('button', { name: 'Enable sound', exact: true }).click();
        await page.getByTitle('Play', { exact: true }).click();
        await page.waitForFunction(() => (window as any).audioCapture.measure() > 0.01);
        await page.waitForFunction(() => !!(window as any).fixture.pendingMedia['video-media-audio'] && document.querySelector('canvas[aria-label="Composition preview"]')?.getAttribute('data-state') === 'loading');
        await page.waitForTimeout(150);
        assert.ok(await rms() < 0.0001, 'buffering must silence already-playing audio');
        await page.evaluate(() => {
            (window as any).fixture.missingMedia = 'video-media-audio';
            (window as any).fixture.pendingMedia['video-media-audio']();
        });
        await page.getByRole('alert').waitFor();
        await page.getByTitle('Play', { exact: true }).waitFor();
        await page.waitForTimeout(150);
        assert.ok(await rms() < 0.0001, 'failed audio must leave the graph silent');
    });
    await check('unknown audio metadata fails visibly instead of guessing the mix', async () => {
        await openAudio();
        await page.evaluate(() => { (window as any).fixture.unknownAudio = true; });
        await page.getByRole('button', { name: 'Enable sound', exact: true }).click();
        await page.getByTitle('Play', { exact: true }).click();
        await page.getByRole('alert').waitFor();
        await page.getByTitle('Play', { exact: true }).waitFor();
        assert.ok(await rms() < 0.0001);
    });
    await check('missing media encountered during composition playback stops with an error', async () => {
        await page.evaluate(() => { (window as any).fixture.missingMedia = 'video-media-overlay'; });
        await openComposition();
        await seekComposition(1800); await readyComposition(1800);
        await page.getByTitle('Play', { exact: true }).click();
        await page.getByRole('alert').filter({ hasText: /Media unavailable|media unavailable/ }).waitFor();
        await page.getByTitle('Play', { exact: true }).waitFor();
        assert.equal(await page.getByLabel('Composition preview', { exact: true }).getAttribute('data-state'), 'error');
        const stopped = await page.getByLabel('Composition time', { exact: true }).inputValue();
        await page.waitForTimeout(200);
        assert.equal(await page.getByLabel('Composition time', { exact: true }).inputValue(), stopped);
    });
    await check('LUT import previews actual pixels, supports intensity, undo, and rejects malformed cubes', async () => {
        await page.getByRole('button', { name: 'Synthetic clip 0:00 - 0:02', exact: true }).click();
        await page.getByRole('button', { name: 'Composition', exact: true }).click();
        await readyComposition(0);
        const red = await canvasPixel(80, 45);
        assert.ok(red[0]! > 200 && red[1]! < 30);
        const cube = 'LUT_3D_SIZE 2\n' + Array(8).fill('0 1 0').join('\n');
        await page.getByLabel('Import LUT file').setInputFiles({name:'green.cube', mimeType:'text/plain', buffer:Buffer.from(cube)});
        await page.getByRole('button', {name:'Remove LUT',exact:true}).waitFor();
        await readyComposition(0);
        const green = await canvasPixel(80, 45);
        assert.ok(green[1]! > 240 && green[0]! < 15 && green[2]! < 15, `LUT pixel ${green}`);
        const intensity = page.locator('label').filter({hasText:'LUT intensity'}).locator('input[type="range"]');
        await intensity.fill('0');
        await readyComposition(0);
        assert.ok((await canvasPixel(80,45))[0]! > 200, 'zero LUT intensity restores source');
        await page.getByRole('button',{name:'Undo',exact:true}).click();
        await readyComposition(0);
        assert.ok((await canvasPixel(80,45))[1]! > 240, 'undo restores LUT strength');
        await page.getByLabel('Import LUT file').setInputFiles({name:'bad.cube', mimeType:'text/plain', buffer:Buffer.from('LUT_3D_SIZE 2\n0 1 0')});
        await page.getByRole('alert').filter({hasText:/LUT|Cube/i}).waitFor();
        assert.ok((await canvasPixel(80,45))[1]! > 240, 'invalid LUT leaves previous look');
        await save();
        assert.equal(JSON.parse((await fixture()).disk).timeline.tracks[0].clips[0].adjustments.lut.name,'green.cube');
    });
    await check('RGB color preview is visible and keyboard undo preserves native text editing', async () => {
        await page.getByRole('button', { name: 'Synthetic clip 0:00 - 0:02', exact: true }).click();
        await page.getByRole('button', { name: 'Composition', exact: true }).click();
        const saturation = page.locator('label').filter({hasText:/^Saturation/}).locator('input[type="range"]');
        await saturation.fill('0');
        await readyComposition(0);
        const gray = await canvasPixel(80,45);
        assert.ok(Math.abs(gray[0]!-gray[1]!)<3 && Math.abs(gray[1]!-gray[2]!)<3, `grayscale ${gray}`);
        await page.getByRole('button',{name:'Toggle inspector',exact:true}).focus();
        await page.keyboard.press(process.platform==='darwin'?'Meta+z':'Control+z');
        await readyComposition(0);
        assert.ok((await canvasPixel(80,45))[0]! > 200, 'keyboard undo restores source');
        await page.keyboard.press(process.platform==='darwin'?'Meta+Shift+z':'Control+Shift+z');
        await readyComposition(0);
        const restored = await canvasPixel(80,45);
        assert.ok(Math.abs(restored[0]!-restored[1]!)<3, 'keyboard redo restores grade');
        const title=page.getByLabel('Project title',{exact:true});
        const originalTitle=await title.inputValue();
        await title.focus(); await page.keyboard.press('End'); await page.keyboard.type('x');
        await page.keyboard.press(process.platform==='darwin'?'Meta+z':'Control+z');
        assert.equal(await title.inputValue(),originalTitle,'native text undo is preserved');
    });
    await check('one slider drag is one undo step; keyboard changes stay separate', async () => {
        await page.getByRole('button', { name: 'Synthetic clip 0:00 - 0:02', exact: true }).click();
        const exposure=page.locator('label').filter({hasText:/^Exposure/}).locator('input[type="range"]');
        await exposure.dispatchEvent('pointerdown',{pointerId:7});
        await exposure.fill('0.1'); await exposure.fill('0.3'); await exposure.fill('0.5');
        await page.evaluate(()=>window.dispatchEvent(new PointerEvent('pointerup',{pointerId:7})));
        await page.getByRole('button',{name:'Undo',exact:true}).click();
        assert.equal(await exposure.inputValue(),'0');
        await page.getByRole('button',{name:'Redo',exact:true}).click();
        assert.equal(await exposure.inputValue(),'0.5');
        await exposure.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
        await page.getByRole('button',{name:'Undo',exact:true}).click();
        assert.equal(await exposure.inputValue(),'0.51');
    });
    await check('GPU color matches CPU across channel changes, orientation, and lost-context fallback', async () => {
        for(const forceCpu of [false,true]) {
            const probes=await page.evaluate(force => (window as any).colorProbe(force), forceCpu);
            for(const probe of probes) for(let i=0;i<probe.actual.length;i++) {
                assert.ok(Math.abs(probe.actual[i]-probe.expected[i])<=2, `color channel ${i}: ${probe.actual[i]} vs ${probe.expected[i]}, CPU ${forceCpu}`);
            }
        }
    });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1100, height: 760 }]) {
        await check(`real styled editor fills ${viewport.width}x${viewport.height} with a dominant stage and visible timeline`, async () => {
            await page.setViewportSize(viewport);
            await page.getByTestId('video-stage').waitFor();
            await page.waitForFunction(() => getComputedStyle(document.querySelector('.video-studio-workspace')!).display === 'grid');
            const stage = await page.getByTestId('video-stage').boundingBox();
            const timeline = await page.getByTestId('video-timeline').boundingBox();
            assert.ok(stage && timeline);
            assert.ok(stage.width > viewport.width * 0.65, `stage should dominate available width: ${JSON.stringify(stage)}`);
            assert.ok(stage.height > viewport.height * 0.35, `stage should dominate available height: ${JSON.stringify(stage)}`);
            assert.ok(timeline.height >= 150 && timeline.y + timeline.height <= viewport.height + 1, `timeline must stay visible: ${JSON.stringify(timeline)}`);
            assert.equal(await page.getByTestId('video-inspector').isVisible(), false);
            await openInspector();
            assert.equal(await page.getByTestId('video-inspector').isVisible(), true);
            await page.getByRole('button', { name: 'Toggle inspector', exact: true }).click();
            assert.equal(await page.getByTestId('video-inspector').isVisible(), false);
            const mediaBounds = await page.locator('.video-studio-media').boundingBox();
            const cardBounds = await page.locator('.video-studio-media').getByRole('button', { name: /Synthetic source/ }).boundingBox();
            assert.ok(mediaBounds && cardBounds && cardBounds.x >= mediaBounds.x && cardBounds.x + cardBounds.width <= mediaBounds.x + mediaBounds.width, 'media card must fit its column');
            const rangeStyles = await page.locator('.video-studio-shell input[type="range"]').evaluateAll(inputs => inputs.map(input => getComputedStyle(input).appearance));
            assert.ok(rangeStyles.length > 0 && rangeStyles.every(appearance => appearance === 'none'), 'ranges must use editor styling');
            await page.getByTestId('video-timeline').getByRole('button', { name: /Synthetic clip/ }).click();
            assert.equal(await page.getByTestId('video-inspector').isVisible(), true, 'clip selection opens inspector');
            await page.getByRole('button', { name: 'Toggle inspector', exact: true }).click();
            assert.equal(await page.getByTestId('video-inspector').isVisible(), false);
            const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
            assert.ok(dimensions.scroll <= dimensions.width + 1, `no document horizontal overflow: ${JSON.stringify(dimensions)}`);
            const zoom = page.getByRole('slider', { name: 'Zoom', exact: true });
            const zoomValue = page.getByRole('button', { name: 'Reset timeline zoom', exact: true });
            await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
            assert.equal(await zoomValue.textContent(), '125%');
            assert.equal(await zoom.inputValue(), '1.25');
            await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
            assert.equal(await zoomValue.textContent(), '100%');
            await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
            await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
            assert.equal(await zoomValue.textContent(), '150%');
            await zoomValue.click();
            assert.equal(await zoom.inputValue(), '1');
            await zoom.focus(); await page.keyboard.press('ArrowRight');
            assert.equal(await zoom.inputValue(), '1.25', 'zoom keyboard increments by25 percent');
            assert.equal(await zoom.getAttribute('aria-valuetext'), '125 percent');
            await page.getByRole('button', { name: 'Composition', exact: true }).click();
            const transport = page.getByRole('group', { name: 'Preview transport', exact: true });
            const seek = page.getByRole('slider', { name: 'Composition time', exact: true });
            await seek.focus(); await page.keyboard.press('Home'); await readyComposition(0);
            assert.equal(await seek.inputValue(), '0');
            await page.keyboard.press('ArrowRight'); await readyComposition(1);
            assert.equal(await seek.inputValue(), '1', 'scrubber supports precise keyboard seek');
            await page.keyboard.press('End'); await readyComposition(2000);
            assert.equal(await seek.inputValue(), '2000');
            await seekComposition(1000); await readyComposition(1000);
            assert.equal(await seek.getAttribute('aria-valuetext'), '00:01.000 of 00:02.000');
            assert.deepEqual(await transport.locator('.video-timecode').allTextContents(), ['00:01.000', '00:02.000']);
            assert.equal(await seek.evaluate(input => getComputedStyle(input).getPropertyValue('--range-fill').trim()), '50%');
            assert.equal(await seek.evaluate(input => getComputedStyle(input).appearance), 'none');
            await seek.evaluate(input => (input as HTMLInputElement).blur());
            await page.screenshot({ path: `/tmp/video-studio-layout-${viewport.width}x${viewport.height}.png` });
            if (viewport.width === 1100) {
                await page.screenshot({ path: '/tmp/video-transport-polish.png' });
                await page.locator('.video-scrubber').screenshot({ path: '/tmp/video-scrubber-polish.png' });
                await page.locator('.video-zoom-control').screenshot({ path: '/tmp/video-zoom-polish.png' });
            }
        }, true);
    }
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
