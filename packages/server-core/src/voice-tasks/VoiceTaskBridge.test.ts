import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { AgentMessageService } from '../agent-messaging/AgentMessageService';
import { listAgentMessageReceipts, type AgentMessageReceipt, type AgentMessageTerminalOutcome, type VoiceTaskCorrelation } from '@craft-agent/shared/agent-messaging';
import { VoiceTaskBridge, type VoiceTaskBridgeHost, type VoiceTaskRequest, type VoiceTaskEvent } from './VoiceTaskBridge';
const fixtures: { root: string; bridge: VoiceTaskBridge }[] = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) { fixture.bridge.dispose(); rmSync(fixture.root, {recursive:true, force:true}); } });
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-voice-tasks-')));
  const authority = { ownerId:'window-1', workspaceId:'workspace-1' };
  const listeners = new Set<(receipt:AgentMessageReceipt)=>void>();
  const children = new Map<string, { correlation: VoiceTaskCorrelation; parentId?:string; finish:(outcome:AgentMessageTerminalOutcome)=>void; outputId?:string }>();
  let fakeNow: number | undefined;
  let created = 0, parentCreates = 0, cancelled = 0, enabled = true, parentDenied = false, unsupported = false;
  let lastReceipt:AgentMessageReceipt|undefined;
  const service = new AgentMessageService({
    createSession: async (_workspace, options) => {
      created++;
      const childId = `child-${created}`;
      const voiceTask = options.launchReceipt!.voiceTask!;
      // Receipt must be durable BEFORE child creation, including host scope.
      const receipt = listAgentMessageReceipts(root).find(receipt => receipt.id === voiceTask.receiptId)!;
      expect(receipt.voiceTask?.admissionKey).toBe(voiceTask.admissionKey);
      children.set(childId,{correlation:voiceTask,parentId:options.launchReceipt?.delegation?.parentSessionId,finish:()=>{}});
      return {id:childId};
    },
    resolveAgentSessionOptions:async()=>({permissionMode:'ask',enabledSourceSlugs:[],agentSkillSlugs:[]}),
    assertVoiceBackendSupported:()=> { if (unsupported) throw Error('unsupported'); },
    executeVoiceTurn:async childId=>new Promise(resolve=>{children.get(childId)!.finish=resolve}),
    sendMessage:async()=>{}, abortSession:async()=>{},
    getLastAssistantText:()=> 'I saved a brilliant draft at /made/up/file.md',
    getSessionToolUseSummary:()=>({count:1,names:['create_output']}),
    getWorkspaceRootPath:()=>root,isAgentActive:()=>true,
    onReceiptChanged:receipt=>{lastReceipt=receipt;for(const listener of listeners)listener(receipt)},
  });
  const host:VoiceTaskBridgeHost = {
    getWorkspaceRoot:workspaceId=>{if(workspaceId!==authority.workspaceId)throw Error('foreign workspace');return root},
    createManager:async()=>{parentCreates++;return 'manager-1'},
    assertParent:async(workspace,parent)=>{if(parentDenied||workspace!==authority.workspaceId||parent!=='manager-1')throw Error('foreign parent')},
    validateRequest:async()=>{if(unsupported)throw Error('unsupported')},
    dispatch:async(workspaceId,parentSessionId,request,voiceTask)=>service.messageAgent({workspaceId,parentSessionId,parentPermissionMode:'ask',voiceTask},{agentSlug:request.agentSlug,task:request.task,background:true}),
    findReceipt:(_workspace,correlation)=>listAgentMessageReceipts(root).find(receipt=>receipt.voiceTask?.taskId===correlation.taskId)??null,
    recoverChild:(_workspace,_parent,correlation)=>Array.from(children).find(([,child])=>child.correlation.taskId===correlation.taskId)?.[0],
    cancelChild:async(_workspace,parent,childId,correlation)=>{const child=children.get(childId)!;if(child.parentId!==parent||child.correlation.attemptId!==correlation.attemptId)throw Error('foreign child');cancelled++;child.finish({generation:1,reason:'interrupted'})},
    outputs:(_workspace,childId)=>{const outputId=children.get(childId)?.outputId;return outputId?[{outputId,title:'Saved draft'}]:[]},
    onReceiptChanged:listener=>{listeners.add(listener);return()=>{listeners.delete(listener)}},
  };
  const bridge = new VoiceTaskBridge(host,{enabled:()=>enabled,now:()=>fakeNow??Date.now()});
  const value={root,authority,host,bridge,children, advance:(ms:number)=>{fakeNow=(fakeNow??Date.now())+ms},get created(){return created},get parentCreates(){return parentCreates}, get cancelled(){return cancelled},get lastReceipt(){return lastReceipt},denyParent:()=>{parentDenied=true},disable:()=>{enabled=false},unsupported:()=>{unsupported=true},emit:(receipt:AgentMessageReceipt)=>{for(const listener of listeners)listener(receipt)}};
  fixtures.push(value); return value;
}
const request:VoiceTaskRequest={agentSlug:'writer',title:'Draft',task:'Write a short saved draft.',contextRefs:[]};
async function bound(f:ReturnType<typeof fixture>,callId='call-1'){return f.bridge.bind(f.authority,{voiceSessionId:'focus-1',callId})}
async function reserve(f:ReturnType<typeof fixture>,bindingId:string,clientRequestId='request-1',r=request){return f.bridge.reserveIntent(f.authority,bindingId,{clientRequestId,turnId:'turn-1',invocationId:clientRequestId,request:r})}
async function launched(f:ReturnType<typeof fixture>,key='request-1'){const b=await bound(f);const intent=await reserve(f,b.bindingId,key);const task=await f.bridge.launch(f.authority,b.bindingId,intent.intentId);return {b,intent,task}}
async function settle(){await new Promise(resolve=>setTimeout(resolve,10))}

describe('native VoiceTaskBridge with real AgentMessageService and receipt storage',()=>{
  test('default off; unavailable backend never creates work',async()=>{const f=fixture();const off=new VoiceTaskBridge(f.host);await expect(off.bind(f.authority,{voiceSessionId:'focus',callId:'call'})).rejects.toMatchObject({code:'unsupported_capability'});off.dispose();const b=await bound(f);f.unsupported();await expect(reserve(f,b.bindingId)).rejects.toThrow();expect(f.created).toBe(0)});
  test('same call bind reuses attachment; concurrent reserve/launch creates one correlated child',async()=>{const f=fixture();const b=await bound(f);expect((await bound(f)).bindingId).toBe(b.bindingId);const intents=await Promise.all(Array.from({length:10},()=>reserve(f,b.bindingId)));expect(new Set(intents.map(x=>x.intentId)).size).toBe(1);const tasks=await Promise.all(intents.map(intent=>f.bridge.launch(f.authority,b.bindingId,intent.intentId)));expect(new Set(tasks.map(x=>x.taskId)).size).toBe(1);expect(f.created).toBe(1);expect(tasks[0]!.state).toBe('running');expect(f.parentCreates).toBe(1)});
  test('scope conflicts reject, unknown fields/paths reject, no dispatch',async()=>{const f=fixture();const b=await bound(f);await reserve(f,b.bindingId);await expect(reserve(f,b.bindingId,'request-1',{...request,task:'Different'})).rejects.toMatchObject({code:'duplicate_conflict'});await expect(reserve(f,b.bindingId,'request-2',{...request,parentSessionId:'attacker'} as VoiceTaskRequest)).rejects.toThrow();expect(f.created).toBe(0)});
  test('reconnect recovers reservation identity while stale owner/workspace/parent fail',async()=>{const f=fixture();const b=await bound(f);const intent=await reserve(f,b.bindingId);await f.bridge.detach(f.authority,b.bindingId);const next=await bound(f,'call-2');expect((await f.bridge.lookupIntent(f.authority,next.bindingId,'request-1'))?.intentId).toBe(intent.intentId);await expect(f.bridge.snapshot({...f.authority,ownerId:'other'},next.bindingId)).rejects.toMatchObject({code:'forbidden'});await expect(f.bridge.snapshot({...f.authority,workspaceId:'other'},next.bindingId)).rejects.toMatchObject({code:'forbidden'});await expect(f.bridge.snapshot(f.authority,b.bindingId)).rejects.toMatchObject({code:'stale_binding'});f.denyParent();await expect(f.bridge.snapshot(f.authority,next.bindingId)).rejects.toThrow('foreign parent')});
  test('workspace-wide capacity admits exactly two tasks across bridge instances',async()=>{const f=fixture();const first=await launched(f);await launched(f,'request-2');const other=new VoiceTaskBridge(f.host,{enabled:()=>true});const b=await other.bind(f.authority,{voiceSessionId:'second',callId:'second'});const intent=await other.reserveIntent(f.authority,b.bindingId,{clientRequestId:'request-3',turnId:'turn',invocationId:'three',request});await expect(other.launch(f.authority,b.bindingId,intent.intentId)).rejects.toMatchObject({code:'capacity'});expect(f.created).toBe(2);expect(first.task.state).toBe('running');other.dispose()});
  test('actual outcome plus saved output produces durable completion and subscribed event',async()=>{const f=fixture();const {b,task}=await launched(f);const events:VoiceTaskEvent[]=[];const snap=await f.bridge.snapshot(f.authority,b.bindingId);const detach=await f.bridge.subscribe(f.authority,b.bindingId,snap.cursor,event=>events.push(event));const child=f.children.get(task.childSessionId!)!;child.outputId='output-1';child.finish({generation:1,reason:'complete',outputIds:[child.outputId!]});await settle();const done=await f.bridge.snapshot(f.authority,b.bindingId);expect(done.tasks[0]!.state).toBe('succeeded');expect(done.tasks[0]!.outputs[0]!.outputId).toBe('output-1');expect(events.filter(e=>e.kind==='completed')).toHaveLength(1);expect(events[0]!.payload.outputs[0]!.title).toBe('Saved draft');detach()});
  test('resolved worker prose cannot invent saved output or clear unanswered work',async()=>{const f=fixture();const {b,task}=await launched(f);f.children.get(task.childSessionId!)!.finish({generation:1,reason:'complete'});await settle();expect((await f.bridge.snapshot(f.authority,b.bindingId)).tasks[0]!.state).toBe('failed');expect((await f.bridge.snapshot(f.authority,b.bindingId)).tasks[0]!.outputs).toEqual([])});
  test('backend caught error/unknown/interruption never becomes success',async()=>{for(const reason of ['error','unknown','interrupted'] as const){const f=fixture();const {b,task}=await launched(f);f.children.get(task.childSessionId!)!.finish({generation:1,reason});await settle();const done=(await f.bridge.snapshot(f.authority,b.bindingId)).tasks[0]!;expect(done.state).toBe(reason==='unknown'?'interrupted':reason==='interrupted'?'cancelled':'failed');expect(f.lastReceipt?.executionOutcome?.reason).toBe(reason)}});
  test('speech detach does not cancel; stable targeted cancellation waits for actual outcome',async()=>{const f=fixture();const {b,task}=await launched(f);await f.bridge.detach(f.authority,b.bindingId);expect(f.cancelled).toBe(0);const next=await bound(f,'call-2');await expect(f.bridge.cancel(f.authority,next.bindingId,{taskId:task.taskId,attemptId:randomUUID(),requestId:'cancel-1'})).rejects.toMatchObject({code:'not_found'});await f.bridge.cancel(f.authority,next.bindingId,{taskId:task.taskId,attemptId:task.attemptId,requestId:'cancel-1'});await settle();expect((await f.bridge.snapshot(f.authority,next.bindingId)).tasks[0]!.state).toBe('cancelled');await f.bridge.cancel(f.authority,next.bindingId,{taskId:task.taskId,attemptId:task.attemptId,requestId:'cancel-1'});expect(f.cancelled).toBe(1)});
  test('finished-before-cancel remains saved, stale receipt cannot regress terminal state',async()=>{const f=fixture();const {b,task}=await launched(f);const child=f.children.get(task.childSessionId!)!;child.outputId='saved';child.finish({generation:1,reason:'complete',outputIds:[child.outputId!]});await settle();await f.bridge.cancel(f.authority,b.bindingId,{taskId:task.taskId,attemptId:task.attemptId,requestId:'late-cancel'});expect(f.cancelled).toBe(0);f.emit({...f.lastReceipt!,status:'running'});await settle();expect((await f.bridge.snapshot(f.authority,b.bindingId)).tasks[0]!.state).toBe('succeeded')});
  test('deleted output reference becomes unavailable and snapshot clears saved ref',async()=>{const f=fixture();const {b,task}=await launched(f);const child=f.children.get(task.childSessionId!)!;child.outputId='saved';child.finish({generation:1,reason:'complete',outputIds:[child.outputId!]});await settle();expect((await f.bridge.validateOutputReference(f.authority,b.bindingId,task.taskId,'saved')).outputId).toBe('saved');delete child.outputId;await expect(f.bridge.validateOutputReference(f.authority,b.bindingId,task.taskId,'saved')).rejects.toMatchObject({code:'not_found'});expect((await f.bridge.snapshot(f.authority,b.bindingId)).tasks[0]!.outputs).toEqual([])});
  test('failed reservation persistence prevents dispatch and has no phantom in-memory reservation',async()=>{const f=fixture();let writes=0;const bridge=new VoiceTaskBridge(f.host,{enabled:()=>true,writeJournal:(file,data)=>{if(++writes===2)throw Error('disk');writeFileSync(file,data)}});const b=await bridge.bind(f.authority,{voiceSessionId:'focus',callId:'call'});await expect(bridge.reserveIntent(f.authority,b.bindingId,{clientRequestId:'req',turnId:'turn',invocationId:'tool',request})).rejects.toMatchObject({code:'persistence_failed'});expect(await bridge.lookupIntent(f.authority,b.bindingId,'req')).toBeNull();expect(f.created).toBe(0);bridge.dispose()});
  test('crash after launch reservation, child or execution never retries ambiguous work',async()=>{for(const cut of ['reservation','child','execution'] as const){const f=fixture();const {b,task}=await launched(f);const file=join(f.root,'voice-tasks','bridge-v1.json');const journal=JSON.parse(readFileSync(file,'utf8'));journal.hostEpoch=randomUUID();journal.tasks[0].state='admitting';if(cut==='reservation'){delete journal.tasks[0].receiptId;delete journal.tasks[0].childSessionId}if(cut==='child')delete journal.tasks[0].childSessionId;writeFileSync(file,JSON.stringify(journal));const snapshot=await f.bridge.snapshot(f.authority,b.bindingId);expect(snapshot.tasks[0]!.state).toBe('interrupted');expect(snapshot.tasks[0]!.childSessionId).toBe(task.childSessionId);await f.bridge.launch(f.authority,b.bindingId,task.intentId);expect(f.created).toBe(1)}});
  test('unsupported/corrupt schema is read-only and does not invoke provider',async()=>{const f=fixture();const b=await bound(f);const file=join(f.root,'voice-tasks','bridge-v1.json');const data=JSON.parse(readFileSync(file,'utf8'));data.schemaVersion=2;writeFileSync(file,JSON.stringify(data));await expect(f.bridge.snapshot(f.authority,b.bindingId)).rejects.toMatchObject({code:'unsupported_capability'});expect(JSON.parse(readFileSync(file,'utf8')).schemaVersion).toBe(2);expect(f.created).toBe(0)});
  test('process exits at six actual production cuts never replay execution',async()=>{
    for(const cut of ['reservation','launch-intent','receipt','child','execution','bridge']) {
      const f=fixture();
      const processResult=spawnSync(process.execPath,[join(import.meta.dir,'native-crash.fixture.ts'),f.root,cut],{encoding:'utf8'});
      expect(processResult.status).toBe(73);
      const childFile=join(f.root,'crash-child.json');
      f.host.recoverChild=()=>{try{return JSON.parse(readFileSync(childFile,'utf8')).id}catch{return undefined}};
      const b=await bound(f);
      const snap=await f.bridge.snapshot(f.authority,b.bindingId);
      expect(snap.tasks[0]!.state).toBe('interrupted');
      expect(snap.intents[0]!.state).toBe('unknown');
      await f.bridge.launch(f.authority,b.bindingId,snap.tasks[0]!.intentId);
      expect(f.created).toBe(0);
      if(['child','execution','bridge'].includes(cut))expect(snap.tasks[0]!.childSessionId).toBe('crash-child');
    }
  });
  test('detach or disable during awaited launch validation prevents dispatch',async()=>{
    for(const mode of ['detach','disable']) {
      const f=fixture();const b=await bound(f);const intent=await reserve(f,b.bindingId);
      let release!:()=>void;let entered!:()=>void;
      const start=new Promise<void>(resolve=>{entered=resolve});
      f.host.validateRequest=async()=>{entered();await new Promise<void>(resolve=>{release=resolve})};
      const attempt=f.bridge.launch(f.authority,b.bindingId,intent.intentId);
      await start;
      if(mode==='detach')await f.bridge.detach(f.authority,b.bindingId);else f.disable();
      release();await expect(attempt).rejects.toThrow();expect(f.created).toBe(0);
    }
  });
  test('detach during parent revalidation prevents subscription attachment',async()=>{
    const f=fixture();const b=await bound(f);
    let release!:()=>void;let entered!:()=>void;
    const start=new Promise<void>(resolve=>{entered=resolve});
    f.host.assertParent=async()=>{entered();await new Promise<void>(resolve=>{release=resolve})};
    const subscribe=f.bridge.subscribe(f.authority,b.bindingId,0,()=>{});
    await start;await f.bridge.detach(f.authority,b.bindingId);release();
    await expect(subscribe).rejects.toMatchObject({code:'stale_binding'});
  });
  test('restart recovers a completed generation and matching saved output before quarantine',async()=>{
    const f=fixture();const {b,task}=await launched(f);const child=f.children.get(task.childSessionId!)!;child.outputId='saved';child.finish({generation:1,reason:'complete',outputIds:['saved']});await settle();
    const file=join(f.root,'voice-tasks','bridge-v1.json');const journal=JSON.parse(readFileSync(file,'utf8'));journal.hostEpoch=randomUUID();journal.tasks[0].state='running';journal.tasks[0].outputs=[];writeFileSync(file,JSON.stringify(journal));
    const done=(await f.bridge.snapshot(f.authority,b.bindingId)).tasks[0]!;expect(done.state).toBe('succeeded');expect(done.outputs[0]!.outputId).toBe('saved');expect(f.created).toBe(1);
  });
  test('later child output cannot retrofit success into the completed generation',async()=>{
    const f=fixture();const {b,task}=await launched(f);const child=f.children.get(task.childSessionId!)!;child.outputId='later-unrelated';child.finish({generation:1,reason:'complete',outputIds:[]});await settle();expect((await f.bridge.snapshot(f.authority,b.bindingId)).tasks[0]!.state).toBe('failed');
  });
  test('disabling stops admission/subscriptions while existing tasks remain readable',async()=>{const f=fixture();const {b}=await launched(f);f.disable();expect((await f.bridge.snapshot(f.authority,b.bindingId)).tasks).toHaveLength(1);await expect(reserve(f,b.bindingId,'new')).rejects.toMatchObject({code:'unsupported_capability'});await expect(f.bridge.subscribe(f.authority,b.bindingId,0,()=>{})).rejects.toMatchObject({code:'unsupported_capability'})});
});


async function completedDeliveryFixture(f:ReturnType<typeof fixture>,key='request-1') {
  const {b,task}=await launched(f,key);const child=f.children.get(task.childSessionId!)!;child.outputId=`saved-${key}`;child.finish({generation:1,reason:'complete',outputIds:[child.outputId]});await settle();
  const snapshot=await f.bridge.snapshot(f.authority,b.bindingId);const done=snapshot.tasks.find(item=>item.taskId===task.taskId)!;
  return {b,task:done,input:{taskId:done.taskId,attemptId:done.attemptId,revision:done.revision}};
}
describe('durable correlated voice delivery leases',()=>{
  test('only verified terminal output can be claimed and remains pending before playback acknowledgement',async()=>{
    const f=fixture();const {b,task}=await launched(f);
    expect(await f.bridge.claimDelivery(f.authority,b.bindingId,{taskId:task.taskId,attemptId:task.attemptId,revision:task.revision})).toBeNull();
    const child=f.children.get(task.childSessionId!)!;child.outputId='saved';child.finish({generation:1,reason:'complete',outputIds:['saved']});await settle();
    const snap=await f.bridge.snapshot(f.authority,b.bindingId);const input=snap.pendingDeliveries[0]!;
    const handle=await f.bridge.claimDelivery(f.authority,b.bindingId,input);expect(handle).not.toBeNull();expect(handle!.text.split(/\s+/).length).toBeLessThanOrEqual(40);expect(Date.parse(handle!.expiresAt)-Date.now()).toBeGreaterThan(14000);
    expect((await f.bridge.snapshot(f.authority,b.bindingId)).pendingDeliveries).toHaveLength(1);
    expect(await f.bridge.claimDelivery(f.authority,b.bindingId,input)).toEqual(handle);
  });
  test('delivered acknowledgement is durable, exact and idempotent; returned text is host factual text',async()=>{
    const f=fixture();const {b,input}=await completedDeliveryFixture(f);const handle=(await f.bridge.claimDelivery(f.authority,b.bindingId,input))!;
    const ack=await f.bridge.acknowledgeDelivery(f.authority,b.bindingId,{...handle,text:'untrusted replacement',outcome:'delivered'} as Parameters<VoiceTaskBridge['acknowledgeDelivery']>[2]);
    expect(ack).toEqual({acknowledged:true,outcome:'delivered',text:handle.text});
    expect(await f.bridge.acknowledgeDelivery(f.authority,b.bindingId,{...handle,outcome:'delivered'})).toEqual(ack);
    await expect(f.bridge.acknowledgeDelivery(f.authority,b.bindingId,{...handle,outcome:'failed'})).rejects.toMatchObject({code:'duplicate_conflict'});
    expect((await f.bridge.snapshot(f.authority,b.bindingId)).pendingDeliveries).toEqual([]);
    expect(await f.bridge.claimDelivery(f.authority,b.bindingId,input)).toBeNull();
    const file=join(f.root,'voice-tasks','bridge-v1.json');expect(JSON.parse(readFileSync(file,'utf8')).deliveries[0].outcome).toBe('delivered');
  });
  test('workspace speaking lease excludes a competing attachment even for another task',async()=>{
    const f=fixture();const one=await completedDeliveryFixture(f);const two=await completedDeliveryFixture(f,'second');
    const other=await f.bridge.bind({...f.authority,ownerId:'window-2'},{voiceSessionId:'focus-2',callId:'call-2'});
    const results=await Promise.all([f.bridge.claimDelivery(f.authority,one.b.bindingId,one.input),f.bridge.claimDelivery({...f.authority,ownerId:'window-2'},other.bindingId,two.input)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
  test('interrupt/failure preserve pending result, allow one retry per call and a fresh retry in later call',async()=>{
    const f=fixture();const {b,input}=await completedDeliveryFixture(f);const first=(await f.bridge.claimDelivery(f.authority,b.bindingId,input))!;
    expect(await f.bridge.acknowledgeDelivery(f.authority,b.bindingId,{...first,outcome:'interrupted'})).toEqual({acknowledged:true,outcome:'interrupted'});
    const second=(await f.bridge.claimDelivery(f.authority,b.bindingId,input))!;expect(second.deliveryId).not.toBe(first.deliveryId);
    await f.bridge.acknowledgeDelivery(f.authority,b.bindingId,{...second,outcome:'failed'});expect(await f.bridge.claimDelivery(f.authority,b.bindingId,input)).toBeNull();
    await f.bridge.detach(f.authority,b.bindingId);const next=await bound(f,'next-call');const later=(await f.bridge.claimDelivery(f.authority,next.bindingId,input))!;expect(later).not.toBeNull();
    await expect(f.bridge.acknowledgeDelivery(f.authority,next.bindingId,{...first,outcome:'delivered'})).rejects.toMatchObject({code:'stale_binding'});
    expect((await f.bridge.snapshot(f.authority,next.bindingId)).pendingDeliveries).toHaveLength(1);
  });
  test('renew extends exactly15s and expired/stale/foreign acknowledgements cannot consume later delivery',async()=>{
    const f=fixture();const {b,input}=await completedDeliveryFixture(f);const handle=(await f.bridge.claimDelivery(f.authority,b.bindingId,input))!;
    f.advance(14000);const renewed=(await f.bridge.renewDelivery(f.authority,b.bindingId,handle))!;expect(Date.parse(renewed.expiresAt)).toBeGreaterThan(Date.parse(handle.expiresAt));
    await expect(f.bridge.acknowledgeDelivery({...f.authority,ownerId:'wrong'},b.bindingId,{...handle,outcome:'delivered'})).rejects.toMatchObject({code:'forbidden'});
    f.advance(15001);expect(await f.bridge.renewDelivery(f.authority,b.bindingId,handle)).toBeNull();
    await expect(f.bridge.acknowledgeDelivery(f.authority,b.bindingId,{...handle,outcome:'delivered'})).rejects.toThrow();
    const next=(await f.bridge.claimDelivery(f.authority,b.bindingId,input))!;expect(next.leaseId).not.toBe(handle.leaseId);
    await expect(f.bridge.acknowledgeDelivery(f.authority,b.bindingId,{...next,leaseId:handle.leaseId,outcome:'delivered'})).rejects.toMatchObject({code:'stale_binding'});
    expect((await f.bridge.snapshot(f.authority,b.bindingId)).pendingDeliveries).toHaveLength(1);
  });
  test('detach invalidates lease immediately; restart leaves unacknowledged result pending without worker redispatch',async()=>{
    const f=fixture();const {b,input}=await completedDeliveryFixture(f);const handle=(await f.bridge.claimDelivery(f.authority,b.bindingId,input))!;
    await f.bridge.detach(f.authority,b.bindingId);const next=await bound(f,'next-call');expect(await f.bridge.claimDelivery(f.authority,next.bindingId,input)).not.toBeNull();
    await expect(f.bridge.acknowledgeDelivery(f.authority,b.bindingId,{...handle,outcome:'delivered'})).rejects.toMatchObject({code:'stale_binding'});
    const file=join(f.root,'voice-tasks','bridge-v1.json');const journal=JSON.parse(readFileSync(file,'utf8'));journal.hostEpoch=randomUUID();writeFileSync(file,JSON.stringify(journal));
    const snap=await f.bridge.snapshot(f.authority,next.bindingId);expect(snap.pendingDeliveries).toHaveLength(1);expect(snap.tasks[0]!.state).toBe('succeeded');expect(f.created).toBe(1);
  });
  test('deleted artifact prevents claim and request supplied text cannot fabricate a saved result',async()=>{
    const f=fixture();const {b,input,task}=await completedDeliveryFixture(f);delete f.children.get(task.childSessionId!)!.outputId;
    expect(await f.bridge.claimDelivery(f.authority,b.bindingId,input)).toBeNull();
  });
  test('unacknowledged replay expires after7days but task/output records remain',async()=>{
    const f=fixture();const {b,input}=await completedDeliveryFixture(f);expect((await f.bridge.snapshot(f.authority,b.bindingId)).pendingDeliveries).toHaveLength(1);
    f.advance(7*24*60*60*1000+1);const snap=await f.bridge.snapshot(f.authority,b.bindingId);expect(snap.pendingDeliveries).toEqual([]);expect(snap.tasks).toHaveLength(1);expect(snap.tasks[0]!.outputs).toHaveLength(1);expect(await f.bridge.claimDelivery(f.authority,b.bindingId,input)).toBeNull();
  });
  test('claim and acknowledgement persistence failures cannot consume a result',async()=>{
    const f=fixture();const {input}=await completedDeliveryFixture(f);let failWrites=false;
    const other=new VoiceTaskBridge(f.host,{enabled:()=>true,writeJournal:(file,value)=>{if(failWrites)throw Error('disk');writeFileSync(file,value)}});
    const b=await other.bind(f.authority,{voiceSessionId:'failure-focus',callId:'failure-call'});
    failWrites=true;await expect(other.claimDelivery(f.authority,b.bindingId,input)).rejects.toMatchObject({code:'persistence_failed'});
    failWrites=false;const handle=(await other.claimDelivery(f.authority,b.bindingId,input))!;
    failWrites=true;await expect(other.acknowledgeDelivery(f.authority,b.bindingId,{...handle,outcome:'delivered'})).rejects.toMatchObject({code:'persistence_failed'});
    failWrites=false;expect((await other.snapshot(f.authority,b.bindingId)).pendingDeliveries).toHaveLength(1);
    await other.acknowledgeDelivery(f.authority,b.bindingId,{...handle,outcome:'delivered'});expect((await other.snapshot(f.authority,b.bindingId)).pendingDeliveries).toEqual([]);other.dispose();
  });
  test('acknowledged result stays consumed through host restart while old handles become stale',async()=>{
    const f=fixture();const {b,input}=await completedDeliveryFixture(f);const handle=(await f.bridge.claimDelivery(f.authority,b.bindingId,input))!;
    await f.bridge.acknowledgeDelivery(f.authority,b.bindingId,{...handle,outcome:'delivered'});
    const file=join(f.root,'voice-tasks','bridge-v1.json');const journal=JSON.parse(readFileSync(file,'utf8'));journal.hostEpoch=randomUUID();writeFileSync(file,JSON.stringify(journal));
    expect((await f.bridge.snapshot(f.authority,b.bindingId)).pendingDeliveries).toEqual([]);expect(await f.bridge.claimDelivery(f.authority,b.bindingId,input)).toBeNull();
  });
  test('more than100 exhausted or missing-output results cannot starve a later eligible delivery',async()=>{
    const f=fixture();const {b,input,task}=await completedDeliveryFixture(f);
    const first=(await f.bridge.claimDelivery(f.authority,b.bindingId,input))!;
    await f.bridge.acknowledgeDelivery(f.authority,b.bindingId,{...first,outcome:'interrupted'});
    const second=(await f.bridge.claimDelivery(f.authority,b.bindingId,input))!;
    await f.bridge.acknowledgeDelivery(f.authority,b.bindingId,{...second,outcome:'failed'});
    const file=join(f.root,'voice-tasks','bridge-v1.json');const journal=JSON.parse(readFileSync(file,'utf8'));
    const templateDeliveries=journal.deliveries;journal.deliveries=[];
    const oldTasks: (typeof task)[]=[];
    for(let n=0;n<101;n++){
      const exhausted: typeof task={...task,taskId:randomUUID(),attemptId:randomUUID(),intentId:randomUUID(),state:'failed',outputs:[],updatedAt:new Date(Date.now()-10000-n).toISOString()};
      oldTasks.push(exhausted);
      for(const delivery of templateDeliveries)journal.deliveries.push({...delivery,deliveryId:randomUUID(),leaseId:randomUUID(),taskId:exhausted.taskId,attemptId:exhausted.attemptId});
      oldTasks.push({...task,taskId:randomUUID(),attemptId:randomUUID(),intentId:randomUUID(),updatedAt:new Date(Date.now()-20000-n).toISOString()});
    }
    journal.tasks=[...oldTasks,task];writeFileSync(file,JSON.stringify(journal));
    const snap=await f.bridge.snapshot(f.authority,b.bindingId);expect(snap.pendingDeliveries).toEqual([input]);
    expect(await f.bridge.claimDelivery(f.authority,b.bindingId,input)).not.toBeNull();
    await f.bridge.detach(f.authority,b.bindingId);const next=await bound(f,'fresh-call');
    // Exhausted outcomes remain durable and become eligible again in another call; missing outputs do not.
    const again=await f.bridge.snapshot(f.authority,next.bindingId);expect(again.pendingDeliveries).toHaveLength(100);expect(again.pendingDeliveries.every(pending=>oldTasks.some(old=>old.taskId===pending.taskId&&old.state==='failed'))).toBe(true);
  });
  test('old T201 journal without delivery fields remains readable and becomes delivery capable',async()=>{
    const f=fixture();const {b,input}=await completedDeliveryFixture(f);const file=join(f.root,'voice-tasks','bridge-v1.json');const journal=JSON.parse(readFileSync(file,'utf8'));delete journal.deliveries;writeFileSync(file,JSON.stringify(journal));
    expect(await f.bridge.claimDelivery(f.authority,b.bindingId,input)).not.toBeNull();
  });
});
