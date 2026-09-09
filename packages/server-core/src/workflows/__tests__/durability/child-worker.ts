import { appendFileSync, closeSync, existsSync, fsyncSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DurableJournal } from '../../../../../shared/src/durable-execution/index.ts';
import { DurableReadRunner, type DurableReadBinding } from '../../durable-read-runner.ts';
import { DurableChildRunner } from '../../durable-child-runner.ts';
const [root,mode]=process.argv.slice(2) as [string,string];
const key=Buffer.from(process.env.DURABILITY_FIXTURE_KEY!,'hex'),journal=new DurableJournal({configRoot:root,key});key.fill(0);
const parentId='11111111-1111-4111-8111-111111111111',seedId='22222222-2222-4222-8222-222222222222';
if(!existsSync(join(root,'notes')))writeFileSync(join(root,'notes'),'PRIVATE LOCAL FIXTURE');
const binding:DurableReadBinding={credentialIdentity:'a'.repeat(64),workspace:{id:'w',name:'fixture',slug:'fixture',rootPath:root,createdAt:1},context:{provider:'pi',resolvedModel:'fixture',authType:'api_key',capabilities:{needsHttpPoolServer:false},connection:{slug:'local',name:'local',providerType:'pi',authType:'api_key',piAuthProvider:'openai',createdAt:1}}};
const runner=new DurableReadRunner({journal,hostRuntime:{appRootPath:root,isPackaged:false},resolveBinding:()=>binding,authorizeRun:()=>{},authorizeTool:async()=>({principalId:'alice',credentialIdentity:binding.credentialIdentity,policyRevision:'p',allowed:true,requiresApproval:false,approvalExpiresAt:Date.now()+60000}),createBackend:args=>({async *chat(){
 const bridge=args.coreConfig.durableExecution!;
 await bridge.checkpoint({kind:'model-start',turn:0,context:{}});
 if(bridge.descriptor.runId!==seedId){
  await bridge.checkpoint({kind:'model-result',turn:0,message:{role:'assistant',stopReason:'toolUse',content:[{type:'toolCall',id:'read',name:'read',arguments:{path:'notes'}}]}});
  const reply=await bridge.checkpoint({kind:'tool-start',turn:0,callId:'read',tool:'read',input:{path:join(root,'notes')}});
  if(reply.cached===undefined){const output=readFileSync(join(root,'notes'),'utf8');const fd=openSync(join(root,'read-oracle'),'a',0o600);try{appendFileSync(fd,'read\n');fsyncSync(fd)}finally{closeSync(fd)}await bridge.checkpoint({kind:'tool-result',turn:0,callId:'read',result:output})}
  await bridge.checkpoint({kind:'model-start',turn:1,context:{read:true}});
 }
 await bridge.checkpoint({kind:'model-result',turn:bridge.descriptor.runId===seedId?0:1,message:{role:'assistant',stopReason:'stop',content:[{type:'text',text:'{"summary":"verified"}'}]}});await bridge.checkpoint({kind:'complete'});
},async abort(){},destroy(){}})});
let parent;try{parent=journal.get(parentId,'w')}catch(error){if(!(error instanceof Error)||error.message!=='durable-run-not-found')throw error;const seed=await runner.start({runId:seedId,commandId:'seed',workspaceId:'w',connectionSlug:'local',model:'fixture',prompt:'parent',systemPrompt:'Read only',allowedTools:['read'],maxOutputTokens:128,maxModelAttempts:10,deadlineAt:Date.now()+60000,costPolicy:{unit:'verified-free',maxUnitsPerAttempt:0,maxTotalUnits:0},approvalPrincipalId:'alice'});parent=journal.admit({...seed.spec,runId:parentId,commandId:'parent'})}
const claim=journal.claim(parentId,'w');
const barrier=async(name:string)=>{process.stdout.write(name+'\n');await new Promise<void>(()=>{setInterval(()=>{},1000)})};
const coordinator=new DurableChildRunner({journal,runner:{resume:async(runId,workspaceId)=>{if(mode==='before-launch')await barrier('CHILD_ADMITTED_BEFORE_LAUNCH');const result=await runner.resume(runId,workspaceId);if(mode==='before-join')await barrier('CHILD_COMPLETED_BEFORE_JOIN');return result}}});
const result=await coordinator.start(claim,{slotId:'research',mode:'required',prompt:'Read fixture',systemPrompt:'Read only',allowedTools:['read'],maxOutputTokens:64,maxModelAttempts:2,deadlineAt:parent.spec.deadlineAt,costPolicy:parent.spec.costPolicy,outputSchema:{type:'object',required:['summary'],properties:{summary:{type:'string'}}}});
if(result.status!=='joined')throw new Error('missing child join');
process.stdout.write('JOINED '+result.childRunId+'\n');journal.release(claim);await runner.quiesce();journal.close();
