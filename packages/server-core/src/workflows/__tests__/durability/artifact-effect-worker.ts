import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { DurableJournal } from '../../../../../shared/src/durable-execution/index.ts';
import { DURABLE_RUNTIME_MANIFEST } from '../../../../../shared/src/protocol/durable-execution.ts';
import { createDurableArtifactAdapter } from '../../durable-artifact-adapter.ts';
import { DurableEffectRunner } from '../../durable-effect-runner.ts';
const [root, stage] = process.argv.slice(2) as [string,string];
const key = Buffer.from(process.env.DURABILITY_FIXTURE_KEY!, 'hex');
mkdirSync(join(root,'artifacts'), { recursive: true });
const journal = new DurableJournal({configRoot:root,key});
const adapter = createDurableArtifactAdapter(join(root,'artifacts'),()=>{});
if(stage==='write') journal.admit({runId:'artifact',workspaceId:'fixture',commandId:'admit',engine:'sqlite-v2-readonly-1',credentialIdentity:'a'.repeat(64),runtimeManifest:DURABLE_RUNTIME_MANIFEST,createdAt:Date.now(),deadlineAt:Date.now()+120000,allowedTools:['read'],model:'fixture',maxOutputTokens:100,maxModelAttempts:2,costPolicy:{unit:'trusted-upper-bound',maxTotalUnits:3,maxUnitsPerAttempt:1},authority:{},context:{}});
const original = adapter.invoke;
adapter.invoke = async intent => {
  appendFileSync(join(root,'invocations'),'invoke\n');
  const result = await original(intent);
  if(stage==='write') { console.log('EFFECT_DURABLE_BEFORE_ACK'); await new Promise(()=>{}); }
  return result;
};
const claim = journal.claim('artifact','fixture');
const runner = new DurableEffectRunner(journal,[adapter]);
const intent = {slotId:'artifact',adapterId:adapter.id,adapterVersion:adapter.version,credentialIdentity:adapter.credentialIdentity,effectClass:adapter.effectClass,idempotencyKey:'artifact-key',input:{content:'durable native artifact'},outputSchema:{id:adapter.outputSchema.id,version:adapter.outputSchema.version},maxAttempts:2,maxUnitsPerAttempt:1};
const result = await runner.execute(claim,intent);
if(result.status!=='succeeded')throw new Error('Artifact recovery did not succeed: '+result.status);
if((await runner.execute(claim,intent)).attempts.length!==1)throw new Error('Duplicate artifact attempt');
journal.release(claim);journal.close();console.log('RECOVERED_WITHOUT_REINVOKING');
