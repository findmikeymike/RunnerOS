import {afterEach, expect, test, spyOn} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {DurableJournal,type DurableRunSpec} from '../../../shared/src/durable-execution/index.ts';
import {DURABLE_RUNTIME_MANIFEST} from '../../../shared/src/protocol/durable-execution.ts';
import {DurableWorkflowControls,type DurableWorkflowControlsOptions} from './durable-workflow-controls.ts';
const cleanup:Array<()=>void>=[];afterEach(()=>cleanup.splice(0).reverse().forEach(fn=>fn()));
const actor={clientId:'connection',workspaceId:'w'};
async function fixture(){
 const root=mkdtempSync(join(tmpdir(),'durable-attention-')),key=randomBytes(32);cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
 let journal=new DurableJournal({configRoot:root,key});cleanup.push(()=>journal.close());
 const spec:DurableRunSpec={engine:'sqlite-v2-readonly-1',runId:'r',workspaceId:'w',commandId:'admit',createdAt:Date.now(),credentialIdentity:'a'.repeat(64),runtimeManifest:{...DURABLE_RUNTIME_MANIFEST},allowedTools:['read'],model:'fake',maxOutputTokens:100,maxModelAttempts:10,authority:{},context:{},deadlineAt:Date.now()+60000,costPolicy:{unit:'verified-free',maxTotalUnits:0,maxUnitsPerAttempt:0},approvalPrincipalId:'alice'};
 journal.admit(spec);const claim=journal.claim('r','w');const bridge=journal.bridge(claim,{authorizeTool:async()=>({principalId:'alice',policyRevision:'p',credentialIdentity:spec.credentialIdentity,allowed:true,requiresApproval:true,approvalExpiresAt:Date.now()+30000})});
 await bridge.checkpoint({kind:'model-start',turn:0,context:{}});await bridge.checkpoint({kind:'model-result',turn:0,message:{role:'assistant',stopReason:'toolUse',content:[{type:'toolCall',id:'a',name:'read',arguments:{path:'relative'}}]}});
 await expect(bridge.checkpoint({kind:'tool-start',turn:0,callId:'a',tool:'read',input:{path:'/exact/normalized',nested:{secret:'visible for review'}}})).rejects.toThrow('approval-required');journal.release(claim);
 const service=(resolvePrincipal:DurableWorkflowControlsOptions['resolvePrincipal']=()=> 'alice')=>new DurableWorkflowControls({journal,resolvePrincipal,runner:{decide:async command=>({receipt:journal.decide(command),execution:Promise.reject(new Error('background failed'))})}});
 return {get journal(){return journal},service,snapshot:()=>journal.get('r','w'),reopen(){journal.close();journal=new DurableJournal({configRoot:root,key})}};
}
test('projection shows exact normalized input without leaking authorization identity',async()=>{
 const f=await fixture(),items=await f.service().listAttention('w',actor);expect(await f.service().listAttention('w',actor,'legacy-run')).toEqual([]);expect(items).toHaveLength(1);expect(items[0]!.toolCall.args).toEqual({path:'/exact/normalized',nested:{secret:'visible for review'}});expect(items[0]!.durable?.reviewable).toBe(true);expect(JSON.stringify(items)).not.toContain('credentialIdentity');expect(JSON.stringify(items)).not.toContain('alice');expect(items[0]!.toolCall.args).toEqual(f.snapshot().approvals![0]!.input);
});
test('workspace and stable actor principal checked before listing or deciding',async()=>{
 const f=await fixture(),service=f.service(),item=(await service.listAttention('w',actor))[0]!;
 await expect(service.listAttention('other',actor)).rejects.toThrow('workspace-mismatch');expect(await f.service(()=> 'mallory').listAttention('w',actor)).toEqual([]);
 await expect(f.service(()=> 'mallory').resolveAttention('w',item.id,'approved',{commandId:'bad',expectedVersion:item.durable!.version},actor)).rejects.toThrow('principal-mismatch');expect(f.snapshot().status).toBe('waiting-approval');
});
test('lost reply retry after reopen and newer pause keeps committed receipt without revival',async()=>{
 const f=await fixture(),service=f.service(),item=(await service.listAttention('w',actor))[0]!,command={commandId:randomUUID(),expectedVersion:item.durable!.version};
 expect((await service.resolveAttention('w',item.id,'approved',command,actor)).status).toBe('approved');
 f.journal.command({runId:'r',workspaceId:'w',commandId:'pause',expectedVersion:f.snapshot().version,action:'pause'});f.reopen();
 expect((await f.service().resolveAttention('w',item.id,'approved',command,actor)).status).toBe('approved');expect(f.snapshot().status).toBe('paused');expect(await f.service().listAttention('w',actor)).toEqual([]);
 await expect(f.service().resolveAttention('w',item.id,'approved',{...command,commandId:'new'},actor)).rejects.toThrow('version-conflict');
});
test('request objects cannot change while trusted identity lookup waits',async()=>{
 const f=await fixture(),item=(await f.service().listAttention('w',actor))[0]!;let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 const command={commandId:'original',expectedVersion:item.durable!.version},requestActor={...actor};
 const service=f.service(async(_workspace,pinned)=>{expect(Object.isFrozen(pinned)).toBe(true);await gate;expect(pinned.clientId).toBe('connection');return 'alice'});
 const pending=service.resolveAttention('w',item.id,'approved',command,requestActor);command.commandId='mutated';command.expectedVersion=0;requestActor.workspaceId='other';requestActor.clientId='attacker';release();expect((await pending).status).toBe('approved');
 expect((await f.service().resolveAttention('w',item.id,'approved',{commandId:'original',expectedVersion:item.durable!.version},actor)).status).toBe('approved');
});

test('expired approval remains visible for stopping but cannot be newly approved',async()=>{
 const f=await fixture();const now=Date.now();const clock=spyOn(Date,'now').mockReturnValue(now+40000);cleanup.push(()=>clock.mockRestore());
 const item=(await f.service().listAttention('w',actor))[0]!;expect(item.durable!.reviewable).toBe(false);
 await expect(f.service().resolveAttention('w',item.id,'approved',{commandId:'expired',expectedVersion:item.durable!.version},actor)).rejects.toThrow('approval-expired');
 f.reopen();const current=(await f.service().listAttention('w',actor));expect(current).toHaveLength(1);expect(current[0]!.durable!.reviewable).toBe(false);
 await f.service().resolveAttention('w',item.id,'rejected',{commandId:'stop-expired',expectedVersion:current[0]!.durable!.version},actor);expect(f.snapshot().status).toBe('cancelled');
});
test('old input-less approval is unreviewable yet can be denied safely',async()=>{
 const f=await fixture();
 // Emulate a readable older encrypted snapshot at the projection boundary.
 const journal=new Proxy(f.journal,{get(target,key){if(key==='listInternal')return (workspace:string)=>target.listInternal(workspace).map(state=>({...state,approvals:state.approvals!.map(approval=>{const old={...approval};delete old.input;return old})}));const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}});
 const service=new DurableWorkflowControls({journal,resolvePrincipal:()=> 'alice',runner:{decide:async command=>({receipt:f.journal.decide(command)})}});
 const item=(await service.listAttention('w',actor))[0]!;expect(item.durable!.reviewable).toBe(false);expect(item.toolCall.args).toBeNull();
 await expect(service.resolveAttention('w',item.id,'approved',{commandId:'no-input',expectedVersion:item.durable!.version},actor)).rejects.toThrow('input-unavailable');
 expect((await service.resolveAttention('w',item.id,'rejected',{commandId:'deny',expectedVersion:item.durable!.version},actor)).status).toBe('rejected');expect(f.snapshot().status).toBe('cancelled');
});
test('unsupported adapter projection refuses approval but keeps stop available',async()=>{
 const f=await fixture();const journal=new Proxy(f.journal,{get(target,key){if(key==='listInternal')return (workspace:string)=>target.listInternal(workspace).map(state=>({...state,spec:{...state.spec,runtimeManifest:{...state.spec.runtimeManifest,adapterRevision:'old'}}}));const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}});
 const service=new DurableWorkflowControls({journal,resolvePrincipal:()=> 'alice',runner:{decide:async command=>({receipt:f.journal.decide(command)})}});
 const item=(await service.listAttention('w',actor))[0]!;expect(item.durable!.reviewable).toBe(false);
 await expect(service.resolveAttention('w',item.id,'approved',{commandId:'old-adapter',expectedVersion:item.durable!.version},actor)).rejects.toThrow('runtime-manifest-changed');
 expect((await service.resolveAttention('w',item.id,'rejected',{commandId:'stop-old',expectedVersion:item.durable!.version},actor)).status).toBe('rejected');
});
test('duplicate approve returns original receipt after supersession and cancellation without rerunning',async()=>{
 const f=await fixture(),item=(await f.service().listAttention('w',actor))[0]!,command={commandId:'approve-once',expectedVersion:item.durable!.version};
 const approved=await f.service().resolveAttention('w',item.id,'approved',command,actor);
 f.journal.steer({runId:'r',workspaceId:'w',commandId:'steer',expectedVersion:f.snapshot().version,action:'steer',text:'new instructions'});
 f.journal.command({runId:'r',workspaceId:'w',commandId:'cancel',expectedVersion:f.snapshot().version,action:'cancel'});f.reopen();
 const service=new DurableWorkflowControls({journal:f.journal,resolvePrincipal:()=> 'alice',runner:{decide:async()=>{throw new Error('duplicate must not invoke runner')}}});
 const retried=await service.resolveAttention('w',item.id,'approved',command,actor);expect(retried.status).toBe('rejected');expect(retried.durable!.decisionReceipt).toEqual(approved.durable!.decisionReceipt);expect(retried.durable!.decisionReceipt!.action).toBe('approve');expect(f.snapshot().status).toBe('cancelled');
});
test('old receipt remains readable after manifest/input incompatibility while new decisions stay blocked',async()=>{
 const f=await fixture(),item=(await f.service().listAttention('w',actor))[0]!,command={commandId:'original-approval',expectedVersion:item.durable!.version};
 const original=await f.service().resolveAttention('w',item.id,'approved',command,actor);let changedManifest=true;
 const journal=new Proxy(f.journal,{get(target,key){if(key==='listInternal')return (workspace:string)=>target.listInternal(workspace).map(state=>({...state,spec:{...state.spec,runtimeManifest:{...state.spec.runtimeManifest,...(changedManifest?{adapterRevision:'old'}:{})}},approvals:state.approvals!.map(approval=>{const old={...approval};delete old.input;return old})}));const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}});
 const service=new DurableWorkflowControls({journal,resolvePrincipal:()=> 'alice',runner:{decide:async()=>{throw new Error('must not invoke runner')}}});
 const retry=await service.resolveAttention('w',item.id,'approved',command,actor);expect(retry.durable!.decisionReceipt).toEqual(original.durable!.decisionReceipt);expect(retry.toolCall.args).toBeNull();
 await expect(service.resolveAttention('w',item.id,'approved',{commandId:'new-manifest',expectedVersion:f.snapshot().version},actor)).rejects.toThrow('runtime-manifest-changed');
 changedManifest=false;
 expect((await service.resolveAttention('w',item.id,'approved',command,actor)).durable!.decisionReceipt).toEqual(original.durable!.decisionReceipt);
 await expect(service.resolveAttention('w',item.id,'approved',{commandId:'new-input',expectedVersion:f.snapshot().version},actor)).rejects.toThrow('input-unavailable');
 await expect(service.resolveAttention('w',item.id,'rejected',command,actor)).rejects.toThrow('command-conflict');
});
function controlService(journal:DurableJournal, resolvePrincipal:DurableWorkflowControlsOptions['resolvePrincipal']=()=> 'alice') {
 return new DurableWorkflowControls({journal,resolvePrincipal,runner:{decide:async command=>({receipt:journal.decide(command)}),control:async command=>({receipt:journal.command(command),execution:new Promise<never>(()=>{})}),steer:async command=>({receipt:journal.steer(command),execution:Promise.reject(new Error('background is observed'))})}});
}
test('control mixed commands acknowledge promptly and duplicate preserves newer pause/cancel',async()=>{
 const f=await fixture(),service=controlService(f.journal);
 const steer={commandId:'update',expectedVersion:f.snapshot().version,action:'steer' as const,text:'private new direction'};
 const first=await service.control('w','r',steer,actor);expect(first.state.pendingUpdates).toBe(1);expect(first.state.continuationRevision).toBe(1);expect(JSON.stringify(first)).not.toContain('private new direction');
 const pause=await service.control('w','r',{commandId:'pause',expectedVersion:f.snapshot().version,action:'pause'},actor);expect(pause.state.status).toBe('paused');
 const resume={commandId:'resume',expectedVersion:f.snapshot().version,action:'resume' as const};const resumed=await service.control('w','r',resume,actor);
 await service.control('w','r',{commandId:'pause-again',expectedVersion:f.snapshot().version,action:'pause'},actor);
 const duplicate=await f.service().control('w','r',resume,actor);expect(duplicate.receipt).toEqual(resumed.receipt);expect(duplicate.state.status).toBe('paused');
 await service.control('w','r',{commandId:'cancel',expectedVersion:f.snapshot().version,action:'cancel'},actor);f.reopen();
 const old=await f.service().control('w','r',steer,actor);expect(old.receipt).toEqual(first.receipt);expect(old.state.status).toBe('cancelled');
});
test('control rejects extra authority, wrong actor/workspace, stale version and mixed command reuse',async()=>{
 const f=await fixture(),service=controlService(f.journal),version=f.snapshot().version;
 for(const command of [{commandId:'x',expectedVersion:version,action:'pause',principalId:'alice'},{commandId:'x',expectedVersion:version,action:'pause',text:'unexpected'},{commandId:'x',expectedVersion:version,action:'steer',text:' '},{commandId:'x',expectedVersion:version,action:'unknown'}]) await expect(service.control('w','r',command as any,actor)).rejects.toThrow('invalid-durable-control-command');
 await expect(service.control('other','r',{commandId:'x',expectedVersion:version,action:'pause'},actor)).rejects.toThrow('workspace-mismatch');
 await expect(controlService(f.journal,()=> 'mallory').control('w','r',{commandId:'x',expectedVersion:version,action:'pause'},actor)).rejects.toThrow('principal-mismatch');
 await service.control('w','r',{commandId:'same',expectedVersion:version,action:'pause'},actor);
 await expect(service.control('w','r',{commandId:'stale',expectedVersion:version,action:'cancel'},actor)).rejects.toThrow('version-conflict');
 await expect(service.control('w','r',{commandId:'same',expectedVersion:version,action:'steer',text:'reuse'},actor)).rejects.toThrow('command-conflict');
 expect(()=>f.journal.command({runId:'r',workspaceId:'w',commandId:'extra',expectedVersion:f.snapshot().version,action:'pause',principalId:'injected'} as any)).toThrow('invalid-durable-control-command');
});
test('control pins command and actor across asynchronous identity resolution',async()=>{
 const f=await fixture();let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 const service=controlService(f.journal,async(_workspace,pinned)=>{await gate;expect(pinned.clientId).toBe('connection');return 'alice'});
 const command={commandId:'pinned',expectedVersion:f.snapshot().version,action:'steer' as const,text:'original'},mutableActor={...actor};const pending=service.control('w','r',command,mutableActor);
 command.text='mutated';command.commandId='new-id';mutableActor.clientId='other';release();const result=await pending;
 expect(result.receipt.commandId).toBe('pinned');expect(f.snapshot().steering![0]!.text).toBe('original');
});
test('unbound runs cannot receive controls and missing runner does not mutate new commands',async()=>{
 const f=await fixture();const journal=new Proxy(f.journal,{get(target,key){if(key==='get')return (run:string,workspace:string)=>{const state=target.get(run,workspace);delete state.spec.approvalPrincipalId;return state};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}});
 await expect(controlService(journal).control('w','r',{commandId:'unbound',expectedVersion:f.snapshot().version,action:'pause'},actor)).rejects.toThrow('principal-mismatch');
 const before=f.snapshot();await expect(f.service().control('w','r',{commandId:'unavailable',expectedVersion:before.version,action:'pause'},actor)).rejects.toThrow('control-unavailable');expect(f.snapshot()).toEqual(before);
});

test('selected updates remain pending until their successor model is reserved',async()=>{
 const f=await fixture(),service=controlService(f.journal);
 const command={commandId:'selected',expectedVersion:f.snapshot().version,action:'steer' as const,text:'new direction'};
 await service.control('w','r',command,actor);
 const claim=f.journal.claim('r','w'),bridge=f.journal.bridge(claim);
 await bridge.checkpoint({kind:'tool-disposition',turn:0,callId:'a',tool:'read'});
 await bridge.checkpoint({kind:'turn-boundary',turn:0});
 expect((await service.control('w','r',command,actor)).state.pendingUpdates).toBe(1);
 await bridge.checkpoint({kind:'model-start',turn:1,context:{messages:['new direction']}});
 expect((await service.control('w','r',command,actor)).state.pendingUpdates).toBe(0);
 f.journal.release(claim);
});
