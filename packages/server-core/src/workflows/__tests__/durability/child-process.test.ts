import { expect, test } from 'bun:test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fixtureRoot,fixtureKey,startProcess } from './process-support.ts';
for(const boundary of ['before-launch','before-join'])test(`SIGKILL ${boundary} preserves one child and one native read across restart`,async()=>{
 const root=fixtureRoot(),env={DURABILITY_FIXTURE_KEY:fixtureKey().toString('hex')},worker=join(import.meta.dir,'child-worker.ts');
 const first=startProcess([worker,root,boundary],env);
 try{await first.line(line=>line.startsWith(boundary==='before-launch'?'CHILD_ADMITTED':'CHILD_COMPLETED'));first.child.kill('SIGKILL');expect((await first.done).signal).toBe('SIGKILL');if(boundary==='before-launch')expect(existsSync(join(root,'read-oracle'))).toBe(false);
 const resumed=await startProcess([worker,root,'recover'],env).done;expect(resumed.code).toBe(0);expect(resumed.stderr).toBe('');expect(resumed.stdout).toContain('JOINED');expect(readFileSync(join(root,'read-oracle'),'utf8')).toBe('read\n');
 const duplicate=await startProcess([worker,root,'recover'],env).done;expect(duplicate.code).toBe(0);expect(duplicate.stdout).toBe(resumed.stdout);expect(readFileSync(join(root,'read-oracle'),'utf8')).toBe('read\n');
 }finally{if(first.child.exitCode===null)first.child.kill('SIGKILL');await first.done;rmSync(root,{recursive:true,force:true})}
},30000);
