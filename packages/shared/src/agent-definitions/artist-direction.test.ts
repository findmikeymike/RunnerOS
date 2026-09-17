import { test, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { matter, stringifyFrontmatter } from '../config/frontmatter'
import { parseAgentFile } from './storage'
import { ARTIST_DIRECTION_AGENT as hq, CAMPAIGN_CREATIVE_DIRECTION as campaign, WORLD_BUILDER_AGENT, resolveArtistDirectionForScope } from './artist-direction'
import { migrateArtistDirection } from './artist-direction-migration'
import baselines from './__fixtures__/artist-direction-v1.json'

test('saved stock definitions parse without lost recipes and project reversibly', () => {
  for (const role of [hq, campaign, WORLD_BUILDER_AGENT]) {
    const parsed = parseAgentFile(stringifyFrontmatter(role.systemPrompt, role.metadata))!
    expect(parsed.warnings).toEqual([])
    expect(parsed.metadata.taskModes?.map(m => m.id)).toEqual(role.metadata.taskModes!.map(m => m.id))
  }
  const loaded = { slug: hq.slug, ...parseAgentFile(stringifyFrontmatter(hq.systemPrompt, {...hq.metadata, model:'my-model', permissionMode:'allow-all'}))! }
  const scoped = resolveArtistDirectionForScope(loaded, 'campaign')
  expect(scoped.metadata.name).toBe('Creative Direction')
  expect(scoped.metadata.skills).not.toContain('artist-brand-dna-audit')
  expect(scoped.metadata.model).toBe('my-model')
  expect(scoped.metadata.permissionMode).toBe('allow-all')
  expect(resolveArtistDirectionForScope(scoped, 'hq')).toEqual(loaded)
  expect(loaded.metadata.name).toBe('Artist Direction')
})

test.each(['systemPrompt', 'skills', 'taskModes'])('custom %s is never projected', field => {
  const agent = structuredClone(hq)
  if (field === 'systemPrompt') agent.systemPrompt += '\nCustom instructions.'
  if (field === 'skills') agent.metadata.skills!.push('my-skill')
  if (field === 'taskModes') agent.metadata.taskModes![0]!.label = 'My focus'
  expect(resolveArtistDirectionForScope(agent, 'campaign')).toBe(agent)
})

test.each(baselines.map(a=>a.slug))('stock migration %s preserves settings, backup and idempotence', slug => {
  const root=mkdtempSync(join(tmpdir(),'artist-direction-'))
  try {
    const prior=baselines.find(a=>a.slug===slug)!
    mkdirSync(join(root,slug))
    const file=join(root,slug,'AGENT.md')
    const original=stringifyFrontmatter(prior.systemPrompt,{...prior.metadata,skills:prior.metadata.skills.map(s=>`legacy:${s}`),model:'chosen',permissionMode:'allow-all',custom:'preserve'})
    writeFileSync(file,original)
    expect(migrateArtistDirection({globalAgentsDir:root}).updated).toEqual([slug])
    const next=matter(readFileSync(file,'utf8'))
    expect(next.data.model).toBe('chosen')
    expect(next.data.permissionMode).toBe('allow-all')
    expect(next.data.custom).toBe('preserve')
    expect(next.data.name).toBe(slug==='branding-agent'?'Artist Direction':'World Builder')
    expect(parseAgentFile(readFileSync(file,'utf8'))!.warnings).toEqual([])
    expect(readFileSync(join(root,'.artist-direction-backup',`${slug}.md`),'utf8')).toBe(original)
    expect(migrateArtistDirection({globalAgentsDir:root}).updated).toEqual([])
  } finally {rmSync(root,{recursive:true,force:true})}
})

test.each(['body','skills','modes'])('migration preserves custom %s byte for byte', customization=>{
  const root=mkdtempSync(join(tmpdir(),'artist-direction-custom-'))
  try {
    const prior=structuredClone(baselines[0]!)
    if(customization==='body')prior.systemPrompt+='\nMy direction.'
    if(customization==='skills')prior.metadata.skills.pop()
    if(customization==='modes')prior.metadata.taskModes=[]
    mkdirSync(join(root,prior.slug))
    const file=join(root,prior.slug,'AGENT.md')
    const original=stringifyFrontmatter(prior.systemPrompt,prior.metadata)
    writeFileSync(file,original)
    expect(migrateArtistDirection({globalAgentsDir:root}).customized).toEqual([prior.slug])
    expect(readFileSync(file,'utf8')).toBe(original)
  }finally{rmSync(root,{recursive:true,force:true})}
})

import v2 from './__fixtures__/artist-direction-v2.json'
test('already-upgraded Artist Direction gains proposal guidance with its own backup', () => {
  const root=mkdtempSync(join(tmpdir(),'artist-direction-v2-'))
  try {
    const prior=v2[0]!
    mkdirSync(join(root,prior.slug))
    mkdirSync(join(root,'.artist-direction-backup'))
    writeFileSync(join(root,'.artist-direction-backup',`${prior.slug}.md`),'Original V1 backup')
    const original=stringifyFrontmatter(prior.systemPrompt,{...prior.metadata,model:'keep-my-model'})
    writeFileSync(join(root,prior.slug,'AGENT.md'),original)
    expect(migrateArtistDirection({globalAgentsDir:root}).updated).toEqual([prior.slug])
    const next=parseAgentFile(readFileSync(join(root,prior.slug,'AGENT.md'),'utf8'))!
    expect(next.systemPrompt).toContain('propose_branding_update')
    expect(next.metadata.model).toBe('keep-my-model')
    expect(readFileSync(join(root,'.artist-direction-backup',`${prior.slug}.md`),'utf8')).toBe('Original V1 backup')
    expect(migrateArtistDirection({globalAgentsDir:root}).updated).toEqual([])
  }finally{rmSync(root,{recursive:true,force:true})}
})
