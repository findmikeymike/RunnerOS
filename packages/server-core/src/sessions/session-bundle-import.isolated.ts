import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

test('real import rejects aliases and partial payloads, preserves disk collisions, and disarms queued replay', () => {
  const root = mkdtempSync('/tmp/session-import-host-')
  const tree = join(import.meta.dir, '../../../../..')
  const fixture = join(root, 'fixture.ts')
  mkdirSync(join(root, 'profile'))
  mkdirSync(join(root, 'workspace'))
  writeFileSync(join(root, 'profile/config.json'), JSON.stringify({ workspaces: [{ id: 'target', name: 'Target', slug: 'target', artistWorkspaceScope: 'campaign', rootPath: join(root, 'workspace'), createdAt: 1 }], activeWorkspaceId: 'target' }))
  writeFileSync(join(root, 'workspace/config.json'), JSON.stringify({ id: 'target', name: 'Target', createdAt: 1, updatedAt: 1 }))
  writeFileSync(fixture, `
    import { SessionManager } from ${JSON.stringify(join(import.meta.dir, 'SessionManager.ts'))};
    const manager = new SessionManager();
    manager.sendEvent = () => {};
    const bundle = id => ({version:1,session:{header:{id,createdAt:1},messages:[{id:'queued',type:'user',content:'pending',isQueued:true}]},files:[]});
    await manager.importSession('target',bundle('original'),'move');
    for (const payload of [bundle('alias/original'),{...bundle('partial'),files:[{relativePath:'ok',size:0,contentBase64:''},{relativePath:'../bad',size:0,contentBase64:''}]}]) {
      try { await manager.importSession('target',payload,'move'); throw Error('Unexpected import success'); }
      catch(e) { if (e.message==='Unexpected import success') throw e; }
    }
    const fresh = new SessionManager(); fresh.sendEvent = () => {};
    try { await fresh.importSession('target',bundle('original'),'move'); throw Error('Unexpected overwrite'); }
    catch(e) { if(e.message==='Unexpected overwrite') throw e; }
  `)
  try {
    const result = spawnSync(process.execPath, [fixture], { env: { ...process.env, CRAFT_CONFIG_DIR: join(root,'profile'), CRAFT_PRODUCT_VARIANT:'artist-os', CRAFT_BUNDLED_ASSETS_ROOT:join(tree,'apps/electron') }, encoding:'utf8' })
    expect(result.status, result.stderr).toBe(0)
    expect(existsSync(join(root,'workspace/sessions/partial'))).toBe(false)
    const message = JSON.parse(readFileSync(join(root,'workspace/sessions/original/session.jsonl'),'utf8').split('\n')[1]!)
    expect(message.isQueued).toBe(false)
  } finally { rmSync(root,{recursive:true,force:true}) }
})
