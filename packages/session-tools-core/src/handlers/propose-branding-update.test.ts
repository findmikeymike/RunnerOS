import { expect, test } from 'bun:test';
import type { SessionToolContext } from '../context';
import { getSessionSafeBlockedToolNames } from '../tool-defs';
import { handleProposeBrandingUpdate, proposeBrandingUpdateSchema, type ProposeBrandingUpdateInput } from './propose-branding-update';
const input: ProposeBrandingUpdateInput = { title: 'Audience recognition', patches: [{field:'audienceGravity',before:'Old',after:'New'}], additions:[] };
test('proposals require an available host callback and cannot include approval or arbitrary fields', async () => {
  expect((await handleProposeBrandingUpdate({} as SessionToolContext,input)).isError).toBe(true);
  for(const extra of [{approved:true},{apply:true},{workspaceId:'other'},{path:'/tmp/file'}]) expect(proposeBrandingUpdateSchema.safeParse({...input,...extra}).success).toBe(false);
  expect(proposeBrandingUpdateSchema.safeParse({...input,patches:[{field:'model',before:'',after:'x'}]}).success).toBe(false);
  expect((await handleProposeBrandingUpdate({} as SessionToolContext,{...input,patches:[],additions:[]})).isError).toBe(true);
  expect(getSessionSafeBlockedToolNames()).toContain('propose_branding_update');
});
test('passes exact proposed changes, surfaces stale reads, and never applies locally', async () => {
  let actual: unknown;
  const result=await handleProposeBrandingUpdate({proposeBrandingUpdate:async(value:ProposeBrandingUpdateInput)=>{actual=value;return {applied:false,proposalId:'pending'};}} as unknown as SessionToolContext,input);
  expect(result.isError).toBe(false);expect(actual).toEqual(input);
  const failed=await handleProposeBrandingUpdate({proposeBrandingUpdate:async()=>{throw new Error('BRANDING_CONFLICT');}} as unknown as SessionToolContext,input);
  expect(failed.isError).toBe(true);expect(failed.content[0]).toMatchObject({text:'[ERROR] BRANDING_CONFLICT'});
});
