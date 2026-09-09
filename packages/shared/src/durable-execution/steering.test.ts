import { afterEach, expect, test } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableJournal, type DurableRunSpec } from './index.ts';
import { DURABLE_RUNTIME_MANIFEST } from '../protocol/durable-execution.ts';
const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).reverse().forEach(fn => fn()));
function fixture(approvalPrincipalId?: string) {
 const root = mkdtempSync(join(tmpdir(),'steering-')), key = randomBytes(32);
 cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
 let journal = new DurableJournal({configRoot:root,key}); cleanup.push(()=>journal.close());
 const spec: DurableRunSpec = {engine:'sqlite-v2-readonly-1',runId:'r',workspaceId:'w',commandId:'admit',createdAt:Date.now(),credentialIdentity:'a'.repeat(64),runtimeManifest:{...DURABLE_RUNTIME_MANIFEST},allowedTools:['read'],model:'fake',maxOutputTokens:100,maxModelAttempts:10,authority:{},context:{},deadlineAt:Date.now()+60000,costPolicy:{unit:'verified-free',maxTotalUnits:0,maxUnitsPerAttempt:0}};
 if (approvalPrincipalId) spec.approvalPrincipalId = approvalPrincipalId;
 journal.admit(spec); let claim=journal.claim('r','w');
 return {get journal(){return journal},get bridge(){return journal.bridge(claim)}, authorizedBridge(options: Parameters<DurableJournal['bridge']>[1]) { return journal.bridge(claim, options); }, snapshot:()=>journal.get('r','w'),
 command(text:string){return {runId:'r',workspaceId:'w',commandId:randomUUID(),expectedVersion:journal.get('r','w').version,action:'steer' as const,text}},
 reopen(maxPayloadBytes?: number){journal.release(claim);journal.close();journal=new DurableJournal({configRoot:root,key,maxPayloadBytes});claim=journal.claim('r','w')},
 async model(turn:number, tools:string[]=[]){await journal.bridge(claim).checkpoint({kind:'model-start',turn,context:{turn}});await journal.bridge(claim).checkpoint({kind:'model-result',turn,message:{role:'assistant',stopReason:tools.length?'toolUse':'stop',content:tools.map(id=>({type:'toolCall',id,name:'read',arguments:{path:id}}))}})} };
}
const start=(id='a')=>({kind:'tool-start' as const,turn:0,callId:id,tool:'read',input:{path:id}});
test('ordered encrypted receipts survive reopen and duplicate cannot revive later pause',async()=>{
 const f=fixture(), c=f.command('first');const receipt=f.journal.steer(c);f.journal.steer(f.command('second'));f.reopen();
 expect(f.journal.steer(c)).toEqual(receipt);
 expect((await f.bridge.checkpoint({kind:'turn-boundary',turn:-1})).steering?.map(x=>x.text)).toEqual(['first','second']);
 f.reopen();expect((await f.bridge.checkpoint({kind:'turn-boundary',turn:-1})).steering?.map(x=>x.sequence)).toEqual([1,2]);
 f.journal.command({runId:'r',workspaceId:'w',commandId:'pause',expectedVersion:f.snapshot().version,action:'pause'});
 expect(f.journal.steer(c)).toEqual(receipt);expect(f.snapshot().status).toBe('paused');
 expect(()=>f.journal.steer({...c,text:'tampered'})).toThrow('command-conflict');
});
test('boundary race blocks new model and selected instructions require successor before complete',async()=>{
 const f=fixture();await f.model(0);expect((await f.bridge.checkpoint({kind:'turn-boundary',turn:0})).steering).toEqual([]);
 f.journal.steer(f.command('update'));await expect(f.bridge.checkpoint({kind:'model-start',turn:1,context:{turn:1}})).rejects.toThrow('steering-pending');f.reopen();
 await expect(f.bridge.checkpoint({kind:'complete'})).rejects.toThrow('steering-pending');f.reopen();
 await f.bridge.checkpoint({kind:'turn-boundary',turn:0});await expect(f.bridge.checkpoint({kind:'complete'})).rejects.toThrow('steering-pending');f.reopen();
 await f.model(1);await f.bridge.checkpoint({kind:'complete'});expect(f.snapshot().status).toBe('succeeded');
});
test('undispatched tools skip honestly, cannot accept forged result, and settle boundary',async()=>{
 const f=fixture();await f.model(0,['a','b']);f.journal.steer(f.command('stop reads'));
 expect(await f.bridge.checkpoint({kind:'tool-disposition',turn:0,callId:'a',tool:'read'})).toEqual({skipped:true});
 expect(await f.bridge.checkpoint(start())).toEqual({skipped:true});
 await expect(f.bridge.checkpoint({kind:'tool-result',turn:0,callId:'a',result:'forged'})).rejects.toThrow('tool-not-started');
 expect(await f.bridge.checkpoint(start('b'))).toEqual({skipped:true});
 expect(f.snapshot().turns[0]!.calls.map(c=>[c.attempts,c.result,c.skipped])).toEqual([[0,undefined,true],[0,undefined,true]]);
 expect((await f.bridge.checkpoint({kind:'turn-boundary',turn:0})).steering).toHaveLength(1);
});
test('inflight attempts recover original result and only untouched successor skips',async()=>{
 const f=fixture();await f.model(0,['a','b']);await f.bridge.checkpoint(start());f.journal.steer(f.command('new direction'));f.reopen();
 expect(await f.bridge.checkpoint(start())).toEqual({});expect(f.snapshot().turns[0]!.calls[0]!.attempts).toBe(2);
 await expect(f.bridge.checkpoint({kind:'turn-boundary',turn:0})).rejects.toThrow('predecessor-incomplete');
 await f.bridge.checkpoint({kind:'tool-result',turn:0,callId:'a',result:'saved'});
 expect(await f.bridge.checkpoint(start())).toEqual({cached:'saved'});expect(await f.bridge.checkpoint(start('b'))).toEqual({skipped:true});
});
test('reserved successor seals earlier boundary; queued update applies only after its committed turn',async()=>{
 const f=fixture();await f.model(0);f.journal.steer(f.command('one'));await f.bridge.checkpoint({kind:'turn-boundary',turn:0});
 await f.bridge.checkpoint({kind:'model-start',turn:1,context:{turn:1}});f.journal.steer(f.command('two'));f.reopen();
 expect((await f.bridge.checkpoint({kind:'turn-boundary',turn:0})).steering?.map(x=>x.text)).toEqual(['one']);
 await f.model(1);expect((await f.bridge.checkpoint({kind:'turn-boundary',turn:1})).steering?.map(x=>x.text)).toEqual(['two']);
});

test('steering replay fence survives arbitrary late SDK failure marking', async()=>{
 const f=fixture();await f.model(0);f.journal.steer(f.command('new direction'));const old=f.bridge;
 await expect(old.checkpoint({kind:'complete'})).rejects.toThrow('steering-pending');
 await old.fail('generic transport failed');expect(f.snapshot().status).toBe('running');expect(f.snapshot().controlRevision).toBe(1);
 await expect(old.checkpoint({kind:'model-start',turn:1,context:{turn:1}})).rejects.toThrow('control-changed');
 f.reopen();await f.bridge.checkpoint({kind:'turn-boundary',turn:0});await f.model(1);await f.bridge.checkpoint({kind:'complete'});
 expect(f.snapshot().status).toBe('succeeded');
});
test('waiting approval supersedes atomically and skipped replay never calls current authorizer',async()=>{
 const f=fixture('alice');await f.model(0,['a']);let calls=0;
 const bridge=f.authorizedBridge({authorizeTool:async()=>{calls++;return {principalId:'alice',policyRevision:'p',credentialIdentity:'a'.repeat(64),allowed:true,requiresApproval:true,approvalExpiresAt:Date.now()+50000}}});
 await expect(bridge.checkpoint(start())).rejects.toThrow('approval-required');
 f.journal.steer(f.command('skip sensitive read'));expect(f.snapshot().status).toBe('running');expect(f.snapshot().approvals![0]!.status).toBe('superseded');
 await bridge.fail('old waiting SDK');expect(f.snapshot().status).toBe('running');f.reopen();
 const skipped=f.authorizedBridge({authorizeTool:async()=>{calls++;throw new Error('must never authorize skipped operation')}});
 expect(await skipped.checkpoint(start())).toEqual({skipped:true});expect(await skipped.checkpoint(start())).toEqual({skipped:true});expect(calls).toBe(1);
 expect(f.snapshot().turns[0]!.calls[0]!.attempts).toBe(0);
});
test('paused steering remains paused and rejects stale CAS without adding text',async()=>{
 const f=fixture();const stale=f.command('stale');f.journal.command({runId:'r',workspaceId:'w',commandId:'p',expectedVersion:f.snapshot().version,action:'pause'});
 expect(()=>f.journal.steer(stale)).toThrow('version-conflict');f.journal.steer(f.command('queued while paused'));expect(f.snapshot().status).toBe('paused');expect(f.snapshot().steering).toHaveLength(1);
});

test('receipt write failure rolls back queue and command identity for a clean retry',async()=>{
 const f=fixture();const command={...f.command('small update'),commandId:'x'.repeat(2000)};const before=f.snapshot();f.reopen(3500);
 expect(()=>f.journal.steer(command)).toThrow('payload-limit');expect(f.snapshot()).toEqual(before);
 f.reopen();expect(f.journal.steer(command).sequence).toBe(1);
});
test('boundary selection rollback leaves the queued entry available after storage recovers',async()=>{
 const f=fixture();f.journal.steer(f.command('waiting'));const before=f.snapshot();f.reopen(100);
 await expect(f.bridge.checkpoint({kind:'turn-boundary',turn:-1})).rejects.toThrow('payload-limit');expect(f.snapshot()).toEqual(before);
 f.reopen();expect((await f.bridge.checkpoint({kind:'turn-boundary',turn:-1})).steering).toHaveLength(1);
});
test('steering during awaited authorizer wins over obsolete authorization without dispatch',async()=>{
 const f=fixture('alice');await f.model(0,['a']);let release!:()=>void;let entered!:()=>void;
 const ready=new Promise<void>(resolve=>entered=resolve), gate=new Promise<void>(resolve=>release=resolve);
 const bridge=f.authorizedBridge({authorizeTool:async()=>{entered();await gate;throw new Error('obsolete authorization failure')}});
 const pending=bridge.checkpoint(start());void pending.catch(()=>{});await ready;
 f.journal.steer(f.command('cancel pending read'));release();expect(await pending).toEqual({skipped:true});
 expect(f.snapshot().status).toBe('running');expect(f.snapshot().approvals).toEqual([]);expect(f.snapshot().turns[0]!.calls[0]!.attempts).toBe(0);
});
test('cancel rejects new steering but preserves the original command receipt',async()=>{
 const f=fixture(), command=f.command('earlier');const receipt=f.journal.steer(command);
 f.journal.command({runId:'r',workspaceId:'w',commandId:'cancel',expectedVersion:f.snapshot().version,action:'cancel'});
 expect(()=>f.journal.steer(f.command('too late'))).toThrow('run-terminal');expect(f.journal.steer(command)).toEqual(receipt);expect(f.snapshot().status).toBe('cancelled');
});
