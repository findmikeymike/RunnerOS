/** Process-exit crash harness: only temporary paths supplied by the test. Never imported by production. */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { VoiceTaskBridge, type VoiceTaskBridgeHost } from './VoiceTaskBridge';
import { AgentMessageService } from '../agent-messaging/AgentMessageService';
import { listAgentMessageReceipts } from '@craft-agent/shared/agent-messaging';
const [root, cut] = process.argv.slice(2);
if (!root || !cut || !root.includes('native-voice-tasks-')) throw Error('Temporary fixture required');
const crash = () => process.exit(73);
const service = new AgentMessageService({
  createSession: async (_workspace, options) => { writeFileSync(join(root,'crash-child.json'),JSON.stringify({id:'crash-child',options})); if(cut==='child')crash(); return {id:'crash-child'}; },
  resolveAgentSessionOptions:async()=>({permissionMode:'ask',enabledSourceSlugs:[],agentSkillSlugs:[]}),
  assertVoiceBackendSupported:()=>{},
  executeVoiceTurn:async()=>{if(cut==='execution')crash();return new Promise(()=>{})},
  sendMessage:async()=>{},abortSession:async()=>{},getLastAssistantText:()=>'',getSessionToolUseSummary:()=>({count:0,names:[]}),getWorkspaceRootPath:()=>root,
  onReceiptChanged:receipt=>{if(cut==='receipt'&&!receipt.childSessionId)crash()},
});
const host:VoiceTaskBridgeHost={
  getWorkspaceRoot:()=>root,createManager:async()=> 'manager-1',assertParent:async()=>{},validateRequest:async()=>{},
  dispatch:async(workspaceId,parentSessionId,request,voiceTask)=>{if(cut==='launch-intent')crash();return service.messageAgent({workspaceId,parentSessionId,parentPermissionMode:'ask',voiceTask},{agentSlug:request.agentSlug,task:request.task,background:true})},
  findReceipt:(_workspace,correlation)=>listAgentMessageReceipts(root).find(receipt=>receipt.voiceTask?.taskId===correlation.taskId)??null,
  recoverChild:()=>existsSync(join(root,'crash-child.json'))?JSON.parse(readFileSync(join(root,'crash-child.json'),'utf8')).id:undefined,
  cancelChild:async()=>{},outputs:()=>[],onReceiptChanged:()=>()=>{},
};
const bridge=new VoiceTaskBridge(host,{enabled:()=>true,writeJournal:(file,value)=>{const state=JSON.parse(value);if(cut==='bridge'&&state.tasks[0]?.state==='running')crash();writeFileSync(file,value);if(cut==='reservation'&&state.tasks[0]?.state==='admitting')crash()}});
const authority={ownerId:'window-1',workspaceId:'workspace-1'};
const binding=await bridge.bind(authority,{voiceSessionId:'focus',callId:'call'});
const intent=await bridge.reserveIntent(authority,binding.bindingId,{clientRequestId:'crash-request',turnId:'turn',invocationId:'tool',request:{agentSlug:'writer',title:'Draft',task:'Write draft.',contextRefs:[]}});
await bridge.launch(authority,binding.bindingId,intent.intentId);
throw Error('Crash cut was not reached');
