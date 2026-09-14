import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { manageArtistBrain } from './brain-setup';
import { loadContextDoc, upsertContextDoc, getContextDocFile } from '@craft-agent/shared/workspace-context';
import { artistProfileDoc, artistVoiceDoc } from '@craft-agent/shared/artist-context';
import { validatedManageArtistBrainSchema } from '@craft-agent/session-tools-core';
const roots: string[]=[];
function fixture() { const root=mkdtempSync(join(tmpdir(),'brain-setup-')); roots.push(root); writeFileSync(join(root,'config.json'),JSON.stringify({id:'test',name:'Test',slug:'test',createdAt:1,updatedAt:1})); return root; }
afterEach(()=>{for(const root of roots.splice(0)) rmSync(root,{recursive:true,force:true});});
const actor='setup-concierge';
test('reads and updates only supplied fields, preserving custom data and prose',async()=>{
 const root=fixture();
 upsertContextDoc(root,{slug:'artist-profile',metadata:artistProfileDoc.metadata(),body:'Keep my introduction\n```json\n'+JSON.stringify({version:1,artistName:'Mikey',bio:'Original bio',custom:{keep:1},updatedAt:new Date().toISOString()})+'\n```\nKeep my footer'});
 const read=await manageArtistBrain(root,{action:'read',topic:'profile'},actor);
 expect(read.values).toMatchObject({artistName:'Mikey',bio:'Original bio'});
 expect(read.values).not.toHaveProperty('custom');
 const saved=await manageArtistBrain(root,{action:'update',topic:'profile',expectedRevision:read.revision,changes:{sound:'Warm\nRaw'}},actor);
 expect(saved.saved).toBe(true);
 const body=loadContextDoc(root,'artist-profile')!.body;
 expect(body).toContain('Keep my introduction');expect(body).toContain('Keep my footer');expect(body).toContain('Original bio');expect(body).toContain('"custom"');
});
test('stale revisions cannot overwrite a later edit',async()=>{
 const root=fixture();const read=await manageArtistBrain(root,{action:'read',topic:'branding'},actor);
 await manageArtistBrain(root,{action:'update',topic:'branding',expectedRevision:read.revision,changes:{creativeDna:'A'}},actor);
 await expect(manageArtistBrain(root,{action:'update',topic:'branding',expectedRevision:read.revision,changes:{creativeDna:'B'}},actor)).rejects.toThrow('changed since');
 expect(loadContextDoc(root,'artist-branding')!.body).toContain('"A"');
});
test('stock Voice can be set up without changing its specialist routing; private Voice stays protected',async()=>{
 const root=fixture();upsertContextDoc(root,{slug:'artist-voice',metadata:artistVoiceDoc.metadata(),body:artistVoiceDoc.serialize({...artistVoiceDoc.empty(),summary:'Conversational'})});
 const read=await manageArtistBrain(root,{action:'read',topic:'voice'},actor);expect(read.values?.summary).toBe('Conversational');
 await manageArtistBrain(root,{action:'update',topic:'voice',expectedRevision:read.revision,changes:{avoid:'Corporate phrases'}},actor);
 expect(loadContextDoc(root,'artist-voice')!.metadata.routing).toEqual(artistVoiceDoc.metadata().routing);
 const doc=loadContextDoc(root,'artist-voice')!;upsertContextDoc(root,{slug:doc.slug,metadata:{...doc.metadata,private:true},body:doc.body});
 await expect(manageArtistBrain(root,{action:'read',topic:'voice'},actor)).rejects.toThrow('not available');
});
test('malformed fields fail closed and unsupported paths/fields are rejected',async()=>{
 const root=fixture();upsertContextDoc(root,{slug:'artist-profile',metadata:artistProfileDoc.metadata(),body:'```json\n{"version":1,"bio":{"unexpected":true}}\n```'});
 const path=getContextDocFile(root,'artist-profile'),before=readFileSync(path,'utf8');
 await expect(manageArtistBrain(root,{action:'read',topic:'profile'},actor)).rejects.toThrow('Invalid saved field');expect(readFileSync(path,'utf8')).toBe(before);
 expect(validatedManageArtistBrainSchema.safeParse({action:'update',topic:'profile',expectedRevision:'a'.repeat(64),changes:{bannerImagePath:'/private/data'}}).success).toBe(false);
 expect(validatedManageArtistBrainSchema.safeParse({action:'update',topic:'voice',changes:{bio:'No'}}).success).toBe(false);
});
test('legacy intake remains intact when a new field is saved',async()=>{
 const root=fixture();const body='## Basics\n- Artist name: Mikey\n- Primary genre or lane: folk';upsertContextDoc(root,{slug:'artist-profile',metadata:artistProfileDoc.metadata(),body});
 const read=await manageArtistBrain(root,{action:'read',topic:'profile'},actor);expect(read.values?.artistName).toBe('Mikey');
 await manageArtistBrain(root,{action:'update',topic:'profile',expectedRevision:read.revision,changes:{mission:'Connect'}},actor);
 const next=loadContextDoc(root,'artist-profile')!;expect(next.body).toContain(body);expect(artistProfileDoc.parse(next).value.artistName).toBe('Mikey');
});
