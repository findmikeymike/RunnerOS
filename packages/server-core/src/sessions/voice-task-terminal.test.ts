import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionManager, createManagedSession } from './SessionManager';
import { createOutputBundle } from '@craft-agent/shared/outputs';
import type { AgentMessageTerminalOutcome } from '@craft-agent/shared/agent-messaging';
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})});
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'voice-terminal-'));roots.push(root);
  const manager=new SessionManager();
  const session=createManagedSession({id:'voice-child',launchReceipt:{createdAt:1,origin:'agent',config:{},injected:{skills:[],sources:[],contextDocs:[]},voiceTask:{schemaVersion:1,workspaceId:'voice-workspace',taskId:'task',attemptId:'attempt',intentId:'intent',admissionKey:'key',requestDigest:'digest',receiptId:'receipt'}}},{id:'voice-workspace',slug:'voice-workspace',name:'Voice fixture',rootPath:root,createdAt:1},{messagesLoaded:true});
  const internal=manager as any;
  internal.sessions.set(session.id,session);
  internal.persistSession=()=>{};
  internal.flushSession=async()=>{};
  internal.sendEvent=()=>{};
  internal.isSessionBeingViewed=()=>true;
  internal.markSessionRead=async()=>{};
  internal.scheduleMemorySidecarReview=()=>{};
  internal.recordSessionLogEntry=()=>{};
  return {root,manager,session,internal};
}
describe('actual SessionManager voice execution terminal lifecycle',()=>{
  test('executeVoiceTaskTurn consumes onProcessingStopped errors and aborts despite resolved send',async()=>{
    for(const reason of ['error','interrupted','timeout'] as const){
      const {manager,session,internal}=fixture();
      manager.sendMessage=async()=>{session.processingGeneration++;session.isProcessing=true;await internal.onProcessingStopped(session.id,reason,session.processingGeneration)};
      const result:AgentMessageTerminalOutcome=await internal.executeVoiceTaskTurn(session.id,'Draft');
      expect(result.reason).toBe(reason);expect(result.generation).toBe(1);expect(internal.voiceExecutionWaiters.size).toBe(0);
    }
  });
  test('complete without new assistant final or with actual pending approval is unknown',async()=>{
    for(const pending of [false,true]){
      const {manager,session,internal}=fixture();
      manager.sendMessage=async()=>{session.processingGeneration++;session.isProcessing=true;if(pending){session.messages.push({id:'answer',role:'assistant',content:'Please approve.',timestamp:1});internal.pendingPermissionRequests.set('permission',{sessionId:session.id})}await internal.onProcessingStopped(session.id,'complete',1)};
      expect((await internal.executeVoiceTaskTurn(session.id,'Draft')).reason).toBe('unknown');
    }
  });
  test('committed completion observes actual output manifest at exact generation boundary',async()=>{
    const {root,manager,session,internal}=fixture();
    const output=createOutputBundle(root,{workspaceId:'voice-workspace',title:'Draft',kind:'document',summary:'Fixture',origin:{source:'session',sessionId:session.id},content:'Actual saved draft'} as any);
    manager.sendMessage=async()=>{session.processingGeneration++;session.isProcessing=true;session.messages.push({id:'answer',role:'assistant',content:'Saved draft.',timestamp:1});await internal.onProcessingStopped(session.id,'complete',1)};
    const result=await internal.executeVoiceTaskTurn(session.id,'Draft');
    expect(result.reason).toBe('complete');expect(result.outputIds).toEqual([output.id]);
  });
  test('old generation stop cannot resolve current waiter or stop newer work',async()=>{
    const {session,internal}=fixture();session.processingGeneration=2;session.isProcessing=true;
    let resolved=false;internal.voiceExecutionWaiters.set(session.id,{generation:2,resolve:()=>{resolved=true}});
    await internal.onProcessingStopped(session.id,'complete',1);expect(resolved).toBe(false);expect(session.isProcessing).toBe(true);
  });
  test('failed terminal persistence yields unknown, never completed',async()=>{
    const {manager,session,internal}=fixture();
    internal.flushSession=async()=>{throw Error('disk unavailable')};
    manager.sendMessage=async()=>{session.processingGeneration++;session.isProcessing=true;session.messages.push({id:'answer',role:'assistant',content:'Done.',timestamp:1});await internal.onProcessingStopped(session.id,'complete',1)};
    expect((await internal.executeVoiceTaskTurn(session.id,'Draft')).reason).toBe('unknown');
  });
  test('permission response rejects foreign request and voice alwaysAllow without consuming request',()=>{
    const {manager,session,internal}=fixture();const responses:unknown[]=[];session.agent={respondToPermission:(...args:unknown[])=>responses.push(args)} as any;
    internal.pendingPermissionRequests.set('permission',{sessionId:'foreign-child'});
    expect(manager.respondToPermission(session.id,'permission',true,false)).toBe(false);expect(internal.pendingPermissionRequests.has('permission')).toBe(true);
    internal.pendingPermissionRequests.set('permission',{sessionId:session.id});
    expect(manager.respondToPermission(session.id,'permission',true,true)).toBe(false);expect(internal.pendingPermissionRequests.has('permission')).toBe(true);
    expect(manager.respondToPermission(session.id,'permission',true,false)).toBe(true);expect(responses).toEqual([['permission',true,false]]);
  });
});
