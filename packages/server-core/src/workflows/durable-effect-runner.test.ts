import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DurableJournal } from '../../../shared/src/durable-execution/index.ts';
import { DURABLE_RUNTIME_MANIFEST } from '../../../shared/src/protocol/durable-execution.ts';
import { createDurableArtifactAdapter } from './durable-artifact-adapter.ts';
import { DurableEffectRunner } from './durable-effect-runner.ts';
function fixture() {
 const root=mkdtempSync(join(tmpdir(),'artist-effect-'));mkdirSync(join(root,'artifacts'));
 const key=randomBytes(32);const journal=new DurableJournal({configRoot:root,key});
 journal.admit({runId:'r',workspaceId:'w',commandId:'a',engine:'sqlite-v2-readonly-1',credentialIdentity:'a'.repeat(64),runtimeManifest:DURABLE_RUNTIME_MANIFEST,createdAt:Date.now(),deadlineAt:Date.now()+120000,allowedTools:['read'],model:'fixture',maxOutputTokens:100,maxModelAttempts:2,costPolicy:{unit:'trusted-upper-bound',maxTotalUnits:3,maxUnitsPerAttempt:1},authority:{},context:{}});
 const claim=journal.claim('r','w');const adapter=createDurableArtifactAdapter(join(root,'artifacts'),()=>{});
 const intent={slotId:'file',adapterId:adapter.id,adapterVersion:adapter.version,credentialIdentity:adapter.credentialIdentity,effectClass:adapter.effectClass,idempotencyKey:'key',input:{content:'hello'},outputSchema:{id:adapter.outputSchema.id,version:adapter.outputSchema.version},maxAttempts:2,maxUnitsPerAttempt:1};
 return {root,key,journal,claim,adapter,intent,close(){journal.close();rmSync(root,{recursive:true,force:true});}};
}
test('lost acknowledgement reconciles before any retry and preserves reservation',async()=>{
 const f=fixture();try {const original=f.adapter.invoke;let calls=0;f.adapter.invoke=async i=>{calls++;await original(i);throw new Error('lost reply');};const runner=new DurableEffectRunner(f.journal,[f.adapter]);
 expect((await runner.execute(f.claim,f.intent)).status).toBe('unknown');expect((await runner.execute(f.claim,f.intent)).status).toBe('succeeded');expect(calls).toBe(1);expect(f.journal.get('r','w').reservedUnits).toBe(1);
 }finally{f.close();}
});
test('unavailable reconciliation never retries; proven absence requires a separate command',async()=>{
 const f=fixture();try {let calls=0;f.adapter.invoke=async()=>{calls++;throw new Error('network');};f.adapter.reconcile=async()=>{throw new Error('lookup');};const runner=new DurableEffectRunner(f.journal,[f.adapter]);
 expect((await runner.execute(f.claim,f.intent)).status).toBe('unknown');expect((await runner.execute(f.claim,f.intent)).status).toBe('unknown');expect(calls).toBe(1);
 f.adapter.reconcile=async()=>({kind:'not-applied',reason:'authoritative absence'});expect((await runner.execute(f.claim,f.intent)).status).toBe('intent');expect(calls).toBe(1);await runner.execute(f.claim,f.intent);expect(calls).toBe(2);
 }finally{f.close();}
});
test('pause during authorization fences invocation; duplicate concurrent command cannot dispatch twice',async()=>{
 const f=fixture();try {let unblock!:()=>void;const wait=new Promise<void>(resolve=>{unblock=resolve;});f.adapter.authorize=()=>wait;const runner=new DurableEffectRunner(f.journal,[f.adapter]);const pending=runner.execute(f.claim,f.intent,'one');
 f.journal.command({runId:'r',workspaceId:'w',action:'pause',expectedVersion:f.journal.get('r','w').version,commandId:'pause'});unblock();await expect(pending).rejects.toThrow('dispatch-blocked');expect(readdirSync(join(f.root,'artifacts'))).toHaveLength(0);
 }finally{f.close();}
 const g=fixture();try{let calls=0;const original=g.adapter.invoke;g.adapter.invoke=async i=>{calls++;return original(i);};const runner=new DurableEffectRunner(g.journal,[g.adapter]);await Promise.all([runner.execute(g.claim,g.intent,'same'),runner.execute(g.claim,g.intent,'same')]);expect(calls).toBe(1);}finally{g.close();}
});
test('preexisting conflicting artifact is never overwritten or declared successful',async()=>{
 const f=fixture();try{const runner=new DurableEffectRunner(f.journal,[f.adapter]);await runner.execute(f.claim,f.intent);const file=readdirSync(join(f.root,'artifacts'))[0]!;writeFileSync(join(f.root,'artifacts',file),'conflict');expect((await f.adapter.reconcile(f.intent)).kind).toBe('failed');}finally{f.close();}
});

test('malformed Unicode is rejected before an artifact attempt',async()=>{const f=fixture();try {f.intent.input.content=String.fromCharCode(0xd800);await expect(new DurableEffectRunner(f.journal,[f.adapter]).execute(f.claim,f.intent)).rejects.toThrow('input-invalid');expect(f.journal.getOperation('r','w','file')!.attempts).toHaveLength(0);expect(readdirSync(join(f.root,'artifacts'))).toHaveLength(0);}finally{f.close();}});

test('authorization cannot mutate pinned input or swap adapter credentials across an await',async()=>{const f=fixture();try {f.adapter.authorize=async intent=>{(intent.input as any).content='changed';};await expect(new DurableEffectRunner(f.journal,[f.adapter]).execute(f.claim,f.intent)).rejects.toThrow();expect(f.journal.getOperation('r','w','file')!.attempts).toHaveLength(0);f.adapter.authorize=async()=>{f.adapter.credentialIdentity='b'.repeat(64);};await expect(new DurableEffectRunner(f.journal,[f.adapter]).execute(f.claim,f.intent)).rejects.toThrow('binding-changed');expect(readdirSync(join(f.root,'artifacts'))).toHaveLength(0);}finally{f.close();}});

test('replacement artifact directory changes persistent credential identity',async()=>{const f=fixture();try{renameSync(join(f.root,'artifacts'),join(f.root,'displaced'));mkdirSync(join(f.root,'artifacts'));const replacement=createDurableArtifactAdapter(join(f.root,'artifacts'),()=>{});expect(replacement.credentialIdentity).not.toBe(f.adapter.credentialIdentity);await expect(new DurableEffectRunner(f.journal,[replacement]).execute(f.claim,f.intent)).rejects.toThrow('binding-changed');}finally{f.close();}});

test('caller cannot update an old continuation claim after pause and resume',async()=>{const f=fixture();try{let unblock!:()=>void;const wait=new Promise<void>(resolve=>{unblock=resolve;});f.adapter.authorize=()=>wait;const pending=new DurableEffectRunner(f.journal,[f.adapter]).execute(f.claim,f.intent);for(const action of ['pause','resume'] as const) f.journal.command({runId:'r',workspaceId:'w',action,expectedVersion:f.journal.get('r','w').version,commandId:action});f.claim.controlRevision=f.journal.get('r','w').controlRevision;unblock();await expect(pending).rejects.toThrow('dispatch-blocked');expect(readdirSync(join(f.root,'artifacts'))).toHaveLength(0);}finally{f.close();}});

test('cancelled effect reconciles after restart without revival or another write',async()=>{const f=fixture();let reopened:DurableJournal|undefined;try{const original=f.adapter.invoke;let calls=0;f.adapter.invoke=async intent=>{calls++;await original(intent);throw new Error('lost reply');};await new DurableEffectRunner(f.journal,[f.adapter]).execute(f.claim,f.intent);f.journal.command({runId:'r',workspaceId:'w',action:'cancel',expectedVersion:f.journal.get('r','w').version,commandId:'cancel'});f.journal.release(f.claim);reopened=new DurableJournal({configRoot:f.root,key:f.key});const observation=reopened.claimObservation('r','w');const result=await new DurableEffectRunner(reopened,[f.adapter]).execute(observation,f.intent);expect(result.status).toBe('succeeded');expect(reopened.get('r','w').status).toBe('cancelled');expect(calls).toBe(1);expect(()=>reopened!.startOperation(observation,'file','new')).toThrow();reopened.release(observation);}finally{reopened?.close();f.close();}});
