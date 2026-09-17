import { mock } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
const root = mkdtempSync(join(tmpdir(), 'branding-state-'))
let permitted = true
mock.module('@craft-agent/shared/config', () => ({getWorkspaceByNameOrId: (id: string) => ({rootPath: root, artistWorkspaceScope: id === 'hq' ? 'hq' : 'campaign'})}))
mock.module('@craft-agent/shared/workspaces', () => ({assertTeamPermission: () => {if (!permitted) throw new Error('Denied')}}))
mock.module('../../hq-state/refresh', () => ({refreshArtistManagerStateForWorkspaceBestEffort: () => {}}))
const service = await import('./branding-state')
const {artistBrandingDoc} = await import('@craft-agent/shared/artist-context')
const {upsertContextDoc, loadContextDoc} = await import('@craft-agent/shared/workspace-context')
try {
  let state = await service.getBrandingState('hq')
  await assert.rejects(() => service.addBrandingAttachment('campaign', {title:'a',body:'b',expectedRevision:state.revision}))
  permitted = false
  await assert.rejects(() => service.addBrandingAttachment('hq', {title:'a',body:'b',expectedRevision:state.revision}))
  permitted = true
  state = await service.proposeBrandingUpdate('hq',{expectedRevision:state.revision,title:'Direction',patches:[{field:'creativeDna',before:'',after:'New DNA'}],additions:[{title:'Meaning',body:'Useful context'}]})
  assert.equal(loadContextDoc(root, artistBrandingDoc.slug), null)
  assert.equal(state.attachments.length,0)
  state = await service.proposeBrandingUpdate('hq',{expectedRevision:state.revision,title:'Direction',patches:[{field:'creativeDna',before:'',after:'New DNA'}],additions:[{title:'Meaning',body:'Useful context'}]})
  assert.equal(state.proposals.length,1)
  const initial = artistBrandingDoc.normalize({notes:'Keep notes'})
  upsertContextDoc(root,{slug:artistBrandingDoc.slug,metadata:{...artistBrandingDoc.metadata(),name:'My identity'},body:'Custom preamble stays.\n\n```json\n'+JSON.stringify({...initial,notes:'  Keep notes  ',extraKey:{specific:'Original detail'}},null,2)+'\n```\n\nCustom afterword stays.'})
  state = await service.applyBrandingProposal('hq',{expectedRevision:state.revision,proposalId:state.proposals[0]!.id})
  const doc = loadContextDoc(root,artistBrandingDoc.slug)!
  assert.equal(artistBrandingDoc.parse(doc).value.notes,'Keep notes')
  assert.equal(artistBrandingDoc.parse(doc).value.creativeDna,'New DNA')
  assert.equal(doc.metadata.name,'My identity')
  assert.ok(doc.body.startsWith('Custom preamble stays.\n\n```json\n'))
  assert.ok(doc.body.endsWith('\n```\n\nCustom afterword stays.'))
  const {extractJsonBlock} = await import('@craft-agent/shared/artist-context')
  const raw = JSON.parse(extractJsonBlock(doc.body)!)
  assert.equal(raw.notes, '  Keep notes  ')
  assert.deepEqual(raw.extraKey, {specific:'Original detail'})
  assert.throws(() => service.patchBrandingBody('unsupported plain body', []), /one readable/)
  assert.throws(() => service.patchBrandingBody(doc.body + '\n```json\n{}\n```', []), /one readable/)
  assert.equal(state.attachments.length,1)
  assert.ok(state.history[0]!.previousBody?.includes('Keep notes'))
  const revision = state.revision
  const results = await Promise.allSettled([service.addBrandingAttachment('hq',{expectedRevision:revision,title:'One',body:'One'}),service.addBrandingAttachment('hq',{expectedRevision:revision,title:'Two',body:'Two'})])
  assert.equal(results.filter(r => r.status === 'fulfilled').length,1)
  state = await service.getBrandingState('hq')
  const removed = state.attachments[0]!
  state = await service.removeBrandingAttachment('hq',{expectedRevision:state.revision,attachmentId:removed.id})
  assert.ok(!state.attachments.some(a => a.id === removed.id))
  assert.ok(state.history.some(h => h.action === 'attachment-removed' && h.attachment?.body === removed.body))
  state = await service.proposeBrandingUpdate('hq',{expectedRevision:state.revision,title:'Conflict',patches:[{field:'creativeDna',before:'New DNA',after:'Proposed'}]})
  upsertContextDoc(root,{slug:artistBrandingDoc.slug,metadata:doc.metadata,body:artistBrandingDoc.serialize({...initial,creativeDna:'Manual change'})})
  await assert.rejects(() => service.applyBrandingProposal('hq',{expectedRevision:state.revision,proposalId:state.proposals.at(-1)!.id}),/BRANDING_CONFLICT/)
  state = await service.dismissBrandingProposal('hq',{expectedRevision:state.revision,proposalId:state.proposals.at(-1)!.id})
  assert.equal(state.proposals.at(-1)!.status,'dismissed')
  await assert.rejects(() => service.proposeBrandingUpdate('hq',{expectedRevision:state.revision,title:'No-op',patches:[{field:'creativeDna',before:'Manual change',after:'Manual change'}]}),/no changes/)
  await assert.rejects(() => service.addBrandingAttachment('hq',{expectedRevision:state.revision,title:'Huge',body:'a'.repeat(11001)}),/Invalid/)
  const beforeRecovery = loadContextDoc(root, artistBrandingDoc.slug)!
  const recoveredBody = artistBrandingDoc.serialize({...initial,creativeDna:'Recovered approved direction'})
  const recoveredState = {...state,revision:'recovered'}
  writeFileSync(join(root,'branding','apply-journal.json'),JSON.stringify({beforeBody:beforeRecovery.body,update:{slug:artistBrandingDoc.slug,metadata:beforeRecovery.metadata,body:recoveredBody},state:recoveredState}))
  upsertContextDoc(root,{slug:artistBrandingDoc.slug,metadata:{...beforeRecovery.metadata,private:true,routing:{mode:'targeted',agents:['branding-agent']}},body:beforeRecovery.body})
  state = await service.getBrandingState('hq')
  assert.equal(state.revision,'recovered')
  assert.equal(loadContextDoc(root,artistBrandingDoc.slug)!.body,recoveredBody)
  assert.equal(loadContextDoc(root,artistBrandingDoc.slug)!.metadata.private,true)
  assert.deepEqual(loadContextDoc(root,artistBrandingDoc.slug)!.metadata.routing,{mode:'targeted',agents:['branding-agent']})
  const {getContextDocFile} = await import('@craft-agent/shared/workspace-context')
  writeFileSync(getContextDocFile(root,artistBrandingDoc.slug),'---\nname: [broken\n---\nUntouchable original')
  await assert.rejects(() => service.proposeBrandingUpdate('hq',{expectedRevision:state.revision,title:'Must preserve',patches:[],additions:[{title:'Doc',body:'Body'}]}),/repair/)
  mkdirSync(join(root,'branding'),{recursive:true})
  writeFileSync(join(root,'branding','state.json'),JSON.stringify({...state,attachments:[{id:'bad'}]}))
  await assert.rejects(() => service.getBrandingState('hq'),/damaged/)
  console.log('Branding approval isolation checks passed')
} finally {rmSync(root,{recursive:true,force:true})}
