/** Real Pi child process; synthetic credentials and loopback provider only. */
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DurableJournal, digest, type DurableRunSpec } from '../../../../../shared/src/durable-execution/index.ts';
import { DURABLE_RUNTIME_MANIFEST, durableCredentialIdentity } from '../../../../../shared/src/protocol/durable-execution.ts';
import { getCredentialManager } from '../../../../../shared/src/credentials/manager.ts';
import { DurableReadRunner, type DurableReadBinding } from '../../durable-read-runner.ts';
import { DurableChildRunner } from '../../durable-child-runner.ts';
const [root,endpoint,stage]=process.argv.slice(2) as [string,string,string];
if(readFileSync(join(root,'synthetic-only'),'utf8')!=='child-pi-fixture'||process.env.CRAFT_CONFIG_DIR!==join(root,'config')||new URL(endpoint).hostname!=='127.0.0.1')throw new Error('isolated-child-pi-fixture-required');
const key='synthetic-child-pi-key';getCredentialManager().getLlmApiKey=async slug=>{if(slug!=='child-pi-fixture')throw new Error('unexpected credential');return key};
const identity=await durableCredentialIdentity({provider:'custom-endpoint',credential:{type:'api_key',key}});
const connection={slug:'child-pi-fixture',name:'Fixture',providerType:'pi_compat' as const,authType:'api_key' as const,piAuthProvider:'openai',baseUrl:endpoint+'/v1',customEndpoint:{api:'openai-completions' as const},models:['child-pi-fixture'],createdAt:1};
const binding:DurableReadBinding={credentialIdentity:identity,workspace:{id:'w',name:'Fixture',slug:'fixture',rootPath:root,createdAt:1},context:{provider:'pi',resolvedModel:'child-pi-fixture',authType:'api_key',capabilities:{needsHttpPoolServer:false},connection}};
const folder=join(root,'app/packages/pi-agent-server/dist');mkdirSync(folder,{recursive:true});writeFileSync(join(folder,'index.js'),`import ${JSON.stringify(resolve(import.meta.dir,'../../../../../pi-agent-server/src/index.ts'))};\n`);
const journal=new DurableJournal({configRoot:join(root,'config'),key:Buffer.from(process.env.CHILD_PI_TEST_KEY!,'hex')});
const input=JSON.parse(readFileSync(join(root,'input.json'),'utf8'));
let parent;try{parent=journal.get(input.runId,'w')}catch(error){if(!(error instanceof Error)||error.message!=='durable-run-not-found')throw error;
 const frozenBinding=digest({credentialIdentity:identity,workspaceId:'w',root:realpathSync(root),model:'child-pi-fixture',authType:'api_key',connection:{slug:connection.slug,providerType:connection.providerType,authType:connection.authType,baseUrl:connection.baseUrl,piAuthProvider:connection.piAuthProvider,customEndpoint:connection.customEndpoint,models:connection.models}});
 const spec:DurableRunSpec={engine:'sqlite-v2-readonly-1',runId:input.runId,workspaceId:'w',commandId:'parent',createdAt:input.createdAt,deadlineAt:input.deadlineAt,credentialIdentity:identity,runtimeManifest:{...DURABLE_RUNTIME_MANIFEST},model:'child-pi-fixture',allowedTools:['read'],maxOutputTokens:256,maxModelAttempts:10,costPolicy:{unit:'verified-free',maxTotalUnits:0,maxUnitsPerAttempt:0},approvalPrincipalId:'fixture-principal',authority:{adapter:'pi-local-read-1',stepCount:1,completion:'journal-only'},context:{prompt:'Parent delegates a read',systemPrompt:'Read only',connectionSlug:connection.slug,workspaceRoot:realpathSync(root),bindingDigest:frozenBinding,requireNonEmptyOutput:true,workflow:null}};
 parent=journal.admit(spec);
}
const runner=new DurableReadRunner({journal,hostRuntime:{appRootPath:join(root,'app'),isPackaged:false,nodeRuntimePath:process.execPath},resolveBinding:()=>binding,authorizeRun:()=>{},authorizeTool:async()=>({principalId:'fixture-principal',credentialIdentity:identity,policyRevision:'fixture-1',allowed:true,requiresApproval:false,approvalExpiresAt:input.deadlineAt})});
const claim=journal.claim(input.runId,'w');
const childRunner=new DurableChildRunner({journal,runner:{resume:async(runId,workspaceId)=>{const state=await runner.resume(runId,workspaceId);if(stage==='before-join'){if(state.status!=='succeeded')throw new Error('child did not succeed: '+state.status);console.log(JSON.stringify({barrier:'child-complete',childRunId:runId}));await new Promise(()=>setInterval(()=>{},1000))}return state}}});
const joined=await childRunner.start(claim,{slotId:'native-read',mode:'required',prompt:'Read fixture.txt with the native read tool. Return JSON with a summary string.',systemPrompt:'Read only. Return a JSON object with summary.',allowedTools:['read'],maxOutputTokens:256,maxModelAttempts:3,deadlineAt:parent.spec.deadlineAt,costPolicy:parent.spec.costPolicy,outputSchema:{type:'object',required:['summary'],properties:{summary:{type:'string'}}}});
console.log(JSON.stringify({result:joined}));journal.release(claim);await runner.quiesce();journal.close();
