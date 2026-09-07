import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
const { build } = require('esbuild')
const temp = mkdtempSync(join(tmpdir(), 'signal-briefing-ui-'))
const screenshotDir = process.env.SIGNAL_SCREENSHOTS
try {
  await build({ stdin: { contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {TooltipProvider} from '@craft-agent/ui';
import {BriefingPlayer} from '${root}/apps/electron/src/renderer/components/app-shell/SignalBriefingPlayer.tsx';
import {useSignalReportContent} from '${root}/apps/electron/src/renderer/hooks/useSignalReportContent.ts';
window.calls=[];window.hold=true;window.fail=false;
window.reads=0;
window.electronAPI={readOutputAssetText:async()=>{window.reads++;return 'The full report has the details and sources.'},readSignalBriefingAudio:async(...args)=>{
 window.calls.push(args);
 if(window.hold)await new Promise(r=>window.release=r);
 if(window.fail)throw Error('Connect Inworld in Settings to listen.');
 return {audioDataUrl:window.testAudio};
}};
const app=createRoot(document.getElementById('root'));
window.go=id=>app.render(<TooltipProvider><BriefingPlayer key={id} workspaceId="hq" outputId={id} briefing="Here is what matters for your release this week. Two platform updates could affect how you reach your listeners. The full report has the details and sources."/></TooltipProvider>);
const getOutput=async()=>({primary:{id:'asset'}});
function Reader({id,revision}){
 const {content,loading}=useSignalReportContent('hq',{key:id,kind:'output',summary:'Report',output:{id,updatedAt:revision}},getOutput);
 return <TooltipProvider>{!loading&&content?<BriefingPlayer key={id+content} workspaceId="hq" outputId={id} briefing={content}/>:<span>Loading</span>}</TooltipProvider>;
}
window.reportGo=(id,revision)=>app.render(<Reader id={id} revision={revision}/>);
window.go('first');`, resolveDir: root, loader: 'tsx' }, bundle: true, platform: 'browser', alias: { '@craft-agent/ui': join(root, 'packages/ui/src/components/tooltip.tsx') }, outfile: join(temp, 'bundle.js') })
  let css = ''
  if (process.env.SIGNAL_RENDERER_BUILD) {
    const assets = join(process.env.SIGNAL_RENDERER_BUILD, 'assets')
    css = readdirSync(assets).filter(name => name.endsWith('.css')).map(name => readFileSync(join(assets, name), 'utf8')).join('\n')
  }
  writeFileSync(join(temp, 'index.html'), `<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\nbody{margin:0;background:#111214;color:white;font-family:Arial}#root{padding:16px}</style><div id="root"></div><script src="bundle.js"></script>`)
  // One second of silent PCM proves playback controls without a paid synthesis request.
  const wav = Buffer.alloc(44 + 16000 * 2)
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
  wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40)
  writeFileSync(join(temp, 'probe.cjs'), `
const {app,BrowserWindow}=require('electron');const fs=require('node:fs');
app.setPath('userData',${JSON.stringify(join(temp, 'profile'))});
app.whenReady().then(async()=>{try{
 const w=new BrowserWindow({show:false,width:1000,height:420,webPreferences:{contextIsolation:true,nodeIntegration:false}});
 await w.loadFile(${JSON.stringify(join(temp, 'index.html'))});
 await w.webContents.executeJavaScript('window.testAudio='+${JSON.stringify(JSON.stringify('data:audio/wav;base64,' + wav.toString('base64')))});
 const result=await w.webContents.executeJavaScript(\`(async()=>{
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const check=(ok,msg)=>{if(!ok)throw Error(msg)};
 const click=label=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')===label||b.textContent.includes(label));check(b,'Missing '+label);b.click()};
 await wait(150);check(window.calls.length===0,'generated without click');
 click('Read briefing');await wait(30);check(window.calls.length===0,'reading text generated audio');
 click('Listen');click('Listen');await wait(30);check(window.calls.length===1,'double charge request');
 click('Close briefing audio');window.release();await wait(100);check(!document.querySelector('audio'),'closed request started playback');
 click('Listen');await wait(30);window.go('second');await wait(30);window.release();await wait(100);check(!document.querySelector('audio'),'old report started playback');
 window.hold=false;window.fail=true;click('Listen');await wait(100);check(document.querySelector('[role=alert]').textContent.includes('Connect Inworld'),'missing setup error');
 window.fail=false;click('Listen');await wait(150);check(document.querySelector('audio'),'retry did not produce player');
 const speed=document.querySelector('select');speed.value='1.5';speed.dispatchEvent(new Event('change',{bubbles:true}));await wait(30);
 check(document.querySelector('audio').playbackRate===1.5,'speed not applied');
 check(window.calls.at(-1)[1]==='second','wrong report requested');
 const oldAudio=document.querySelector('audio');let pauseCalls=0;const pause=oldAudio.pause.bind(oldAudio);oldAudio.pause=()=>{pauseCalls++;pause()};
 window.go('third');await wait(100);check(pauseCalls>0&&oldAudio.paused,'unmount did not pause retained audio');
 window.reportGo('stable','1');await wait(100);click('Listen');await wait(150);
 const stableAudio=document.querySelector('audio');const reads=window.reads;
 window.reportGo('stable','1');await wait(100);check(window.reads===reads&&document.querySelector('audio')===stableAudio,'unrelated refresh reset playback');
 window.reportGo('stable','2');await wait(100);check(window.reads===reads+1&&!document.querySelector('audio'),'changed report kept old player');
 click('Listen');await wait(150);click('Read briefing');await wait(30);
 return {onDemand:true,duplicateClicks:true,closeDuringRequest:true,reportSwitch:true,setupError:true,retry:true,speed:true,unmountPause:true,stableRefresh:true,revisionReload:true};
 })()\`);
 if(${JSON.stringify(screenshotDir ?? '')}){
  fs.mkdirSync(${JSON.stringify(screenshotDir ?? '')},{recursive:true});
  for(const width of [1000,390]){
   w.setContentSize(width,420);await new Promise(r=>setTimeout(r,150));
   const overflow=await w.webContents.executeJavaScript('document.documentElement.scrollWidth>innerWidth');
   if(overflow)throw Error('Horizontal overflow at '+width);
   fs.writeFileSync(${JSON.stringify(screenshotDir ?? '')}+'/'+width+'.png',(await w.webContents.capturePage()).toPNG());
  }
 }
 console.log(JSON.stringify(result));w.destroy();app.exit(0);
}catch(e){console.error(e);app.exit(1)}});
`)
  const run = spawnSync(require('electron'), [join(temp, 'probe.cjs')], { cwd: root, encoding: 'utf8', timeout: 30_000 })
  process.stdout.write(run.stdout ?? '')
  process.stderr.write(run.stderr ?? '')
  if (run.error) throw run.error
  if (run.status !== 0) process.exitCode = 1
} finally {
  rmSync(temp, { recursive: true, force: true })
}
