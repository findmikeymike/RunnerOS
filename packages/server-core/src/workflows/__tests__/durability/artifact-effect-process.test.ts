import { test, expect } from 'bun:test';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fixtureKey, fixtureRoot, startProcess } from './process-support.ts';
test('SIGKILL after native artifact fsync before journal outcome recovers without another invocation',async()=>{
 const root=fixtureRoot(),env={DURABILITY_FIXTURE_KEY:fixtureKey().toString('hex')};
 const worker=join(import.meta.dir,'artifact-effect-worker.ts');
 const first=startProcess([worker,root,'write'],env);
 try {
  await first.line(line=>line==='EFFECT_DURABLE_BEFORE_ACK');first.child.kill('SIGKILL');expect((await first.done).signal).toBe('SIGKILL');
  const second=await startProcess([worker,root,'recover'],env).done;
  expect(second.stderr).toBe('');expect(second.code).toBe(0);expect(second.stdout).toContain('RECOVERED_WITHOUT_REINVOKING');
  expect(readFileSync(join(root,'invocations'),'utf8')).toBe('invoke\n');expect(readdirSync(join(root,'artifacts')).length).toBe(1);
 } finally {if(first.child.exitCode===null)first.child.kill('SIGKILL');await first.done;rmSync(root,{recursive:true,force:true});}
},30000);
