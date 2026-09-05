import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
const { build } = require('esbuild')
const temp = mkdtempSync(join(tmpdir(), 'board-autosave-'))
try {
  await build({ stdin: { contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {VisualBoardSurface} from '${root}/apps/electron/src/renderer/components/visual-surfaces/VisualBoardSurface.tsx';
import {createEmptyVisualBoardSnapshot} from '@craft-agent/shared/visual-board';
window.saves=[]; window.reads=[]; window.boards={}; window.hold=false; window.fail=false;
window.electronAPI={
 getVisualBoard:async(w,s)=>{window.reads.push(s);return {output:{id:s},board:window.boards[s]??createEmptyVisualBoardSnapshot({workspaceId:w,sessionId:s})}},
 saveVisualBoard:async(w,s,board)=>{
   window.saves.push({sessionId:s,board});
   if(window.hold)await new Promise(r=>window.release=r);
   if(window.fail)throw Error('offline');
   window.boards[s]=structuredClone(board);return {output:{id:s},board};
 }
};
const app=createRoot(document.getElementById('root'));
window.go=sessionId=>app.render(React.createElement(VisualBoardSurface,{workspaceId:'w',sessionId,outputs:[],onOpenOutput(){}}));
window.go('a');`, resolveDir: root, loader: 'tsx' }, bundle: true, platform: 'browser', outfile: join(temp, 'bundle.js'), plugins: [{
    name: 'fixture-ui', setup(b) {
      b.onResolve({ filter: /^@\// }, args => ['@/hooks/useVisualBoard', '@/components/visual-surfaces/board-draft'].includes(args.path)
        ? { path: join(root, 'apps/electron/src/renderer', args.path.slice(2) + '.ts') }
        : { path: args.path, namespace: 'stub' })
      b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ loader: 'tsx', resolveDir: root, contents: args.path.includes('button')
        ? `import React from 'react';export const Button=({children,variant,size,...props})=><button {...props}>{children}</button>`
        : `export const cn=(...args)=>args.filter(Boolean).join(' ');` }))
    },
  }] })
  writeFileSync(join(temp, 'index.html'), '<div id="root"></div><script src="bundle.js"></script>')
  writeFileSync(join(temp, 'probe.cjs'), `
const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(join(temp, 'data'))});
app.whenReady().then(async()=>{try{
 const w=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false}});
 await w.loadFile(${JSON.stringify(join(temp, 'index.html'))});
 const result=await w.webContents.executeJavaScript(\`(async()=>{
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const check=(ok,msg)=>{if(!ok)throw Error(msg)};
 const note=()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Note').click();
 await wait(200);note();await wait(100);window.go('b');await wait(900);window.go('a');await wait(200);
 check(document.querySelectorAll('textarea').length===1,'quick navigation lost note');
 check(window.saves.length===1&&window.saves[0].sessionId==='a','quick save scoped incorrectly');
 window.go('c');await wait(200);window.hold=true;note();await wait(850);
 check(typeof window.release==='function','save did not start');note();await wait(100);window.go('b');await wait(100);
 const readsBeforeReturn=window.reads.filter(s=>s==='c').length;
 window.go('c');await wait(100);
 check(window.reads.filter(s=>s==='c').length===readsBeforeReturn,'return read raced the pending save');
 window.hold=false;window.release();await wait(900);
 check(document.querySelectorAll('textarea').length===2,'in-flight navigation lost queued edit');
 check(window.saves.filter(s=>s.sessionId==='c').length===2,'queued saves were not serialized');
 window.go('d');await wait(200);window.fail=true;note();await wait(100);window.go('b');await wait(200);window.go('d');await wait(200);
 check(document.querySelectorAll('textarea').length===1,'failed draft was lost');
 check(document.querySelector('[role=alert]')?.textContent.includes('offline'),'failure was not shown');
 window.fail=false;Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Retry save').click();await wait(900);
 check(window.boards.d.cards.length===1,'retry did not save recovered draft');
 return {quickNavigation:true,inFlightNavigation:true,failedDraftRecovery:true,wrongBoardWrites:window.saves.filter(s=>s.sessionId==='b').length};
})()\`);
 if(result.wrongBoardWrites!==0)throw Error('wrote to wrong board');
 console.log(JSON.stringify(result));app.exit(0);
}catch(error){console.error(error);app.exit(1)}});
`)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(require('electron'), [join(temp, 'probe.cjs')], { env, encoding: 'utf8', timeout: 20000 })
  process.stdout.write(result.stdout ?? '')
  process.stderr.write(result.stderr ?? '')
  if (result.status !== 0) throw new Error(`Board autosave fixture failed: ${result.error ?? result.signal ?? result.status}`)
} finally { rmSync(temp, { recursive: true, force: true }) }
