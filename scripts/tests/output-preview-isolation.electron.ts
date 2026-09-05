import { app, BrowserWindow, protocol, session } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { registerOutputAssetProtocolHandler } from '../../apps/electron/src/main/output-asset-protocol'
import { buildRunnerOutputAssetUrl } from '../../packages/shared/src/outputs/web-preview'
import { GENERATED_OUTPUT_SANDBOX } from '../../apps/electron/src/renderer/components/outputs/web-preview'

const temp = process.env.OUTPUT_PREVIEW_SMOKE_DIR ?? process.argv.at(-1)!
mkdirSync(join(temp, 'user-data'), { recursive: true })
app.setPath('userData', join(temp, 'user-data'))
protocol.registerSchemesAsPrivileged([{ scheme: 'runner-output', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
} }])
const attacker = '11111111-1111-4111-8111-111111111111'
const victim = '22222222-2222-4222-8222-222222222222'
const roots = new Map(['attacker', 'victim'].map((id) => [id, { rootPath: join(temp, id) }]))
;(globalThis as any).__previewWorkspaces = roots
const dir = (ws: string, id: string) => join(roots.get(ws)!.rootPath, 'outputs', id)
for (const [ws, id] of [['attacker', attacker], ['attacker', victim], ['victim', victim]]) {
  mkdirSync(dir(ws!, id!), { recursive: true })
}
const otherWorkspace = buildRunnerOutputAssetUrl('victim', victim, 'private.js')
const otherOutput = buildRunnerOutputAssetUrl('attacker', victim, 'private.js')
const image = buildRunnerOutputAssetUrl('victim', victim, 'private.svg')
const legacy = `runner-output://asset/victim/${victim}/private.js`
const url = buildRunnerOutputAssetUrl('attacker', attacker, 'index.html')
const forged = new URL(url)
forged.pathname = new URL(otherWorkspace).pathname
for (const ws of ['attacker', 'victim']) {
  writeFileSync(join(dir(ws, victim), 'private.js'), 'window.result.leaked = true;')
  writeFileSync(join(dir(ws, victim), 'private.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="red"/></svg>')
}
writeFileSync(join(dir('attacker', attacker), 'data.json'), '{"ownData":true}')
writeFileSync(join(dir('attacker', attacker), 'app.js'), 'window.result.classic=true;')
writeFileSync(join(dir('attacker', attacker), 'module.js'), 'window.result.module=true;')
writeFileSync(join(dir('attacker', attacker), 'style.css'), 'body{color:rgb(1,2,3)}')
writeFileSync(join(dir('attacker', attacker), 'index.html'), `<!doctype html>
<link rel="stylesheet" href="style.css"><body>Preview
<script>window.result={};</script><script src="app.js"></script><script type="module" src="module.js"></script>
<script src="${otherWorkspace}"></script><script src="${otherOutput}"></script><script src="${legacy}"></script>
<script>
window.ready=(async()=>{
  result.data=await fetch('./data.json').then(r=>r.json());
  result.forgedStatus=await fetch(${JSON.stringify(forged.href)}).then(r=>r.status);
  try{await fetch(${JSON.stringify(otherWorkspace)});result.crossFetch=true}catch{result.crossFetch=false}
  result.image=await new Promise(resolve=>{const im=new Image();im.onload=()=>resolve('loaded');im.onerror=()=>resolve('blocked');im.src=${JSON.stringify(image)}});
  result.color=getComputedStyle(document.body).color;
  result.requestedDomain=location.hostname.split('.').slice(1).join('.');
  try{document.domain=result.requestedDomain}catch{result.domainBlocked=true}
  result.domain=document.domain;
  await new Promise(r=>setTimeout(r,100));
  return result;
})();
window.ready.then(result=>parent.postMessage({fixtureResult:result},'*'));
</script>`)

app.whenReady().then(async () => {
  console.log('Electron ready; testing production output handler')
  const windows: BrowserWindow[] = []
  try {
    for (const embedded of [true, false]) {
      const ses = session.fromPartition(`preview-smoke-${embedded}`)
      registerOutputAssetProtocolHandler(ses.protocol, 'fixture')
      const win = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } })
      windows.push(win)
      if (embedded) {
        await win.loadURL('data:text/html,' + encodeURIComponent(`<script>window.ready=new Promise(r=>window.addEventListener('message',e=>{if(e.data.fixtureResult)r(e.data.fixtureResult)}))</script><iframe sandbox="${GENERATED_OUTPUT_SANDBOX}" src="${url}"></iframe>`))
      } else {
        // Exercise the actual legacy redirect in the unsandboxed browser path.
        await win.loadURL(`runner-output://asset/attacker/${attacker}/index.html`)
        assert.equal(new URL(win.webContents.getURL()).host, new URL(url).host)
      }
      const result = await win.webContents.executeJavaScript('window.ready')
      assert.deepEqual(result.data, { ownData: true })
      assert.equal(result.classic, true)
      assert.equal(result.module, true)
      assert.equal(result.color, 'rgb(1, 2, 3)')
      assert.equal(result.leaked, undefined)
      assert.equal(result.crossFetch, false)
      assert.equal(result.forgedStatus, 400)
      assert.equal(result.image, 'blocked')
      assert.notEqual(result.domain, result.requestedDomain)
      console.log(JSON.stringify({ surface: embedded ? 'iframe' : 'browser-pane', pass: true, result }))
    }
    console.log('PASS: real Electron output isolation, legacy redirect, and same-bundle scripts/styles/data')
    app.exit(0)
  } catch (error) { console.error(error); app.exit(1) }
}).catch((error) => { console.error(error); app.exit(1) })
