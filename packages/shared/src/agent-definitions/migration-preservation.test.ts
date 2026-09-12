import { afterEach, expect, spyOn, test } from 'bun:test'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { STARTER_AGENTS } from './starter-templates.ts'
import { SPOTIFY_ANALYST_LEGACY_PROMPTS } from './spotify-analyst-prompt-baselines.ts'
import { ensureRequiredAgents, loadGlobalAgent, migrateBuiltInAgentTaskModes, replaceBuiltInAgentMetadata, replaceBuiltInAgentPromptText, serializeAgent, writeGlobalAgent } from './storage.ts'
import type { AgentTaskModeDefinition } from './types.ts'
import historicalBrandingModes from './__fixtures__/branding-task-modes-ffd4a1150.json'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
function fixture(slug = 'branding-agent') {
  const globalAgentsDir = fs.mkdtempSync(join(tmpdir(), 'agent-migration-preserve-')); roots.push(globalAgentsDir)
  const options = { globalAgentsDir }
  const starter = STARTER_AGENTS.find(agent => agent.slug === slug)!
  const file = join(globalAgentsDir, slug, 'AGENT.md')
  return { options, starter, file }
}

test('known historical recipes upgrade, keeping custom prompt and metadata', () => {
  const { options, starter, file } = fixture()
  writeGlobalAgent({ ...starter, metadata: { ...starter.metadata, name: 'My Artist Guide', taskModes: historicalBrandingModes as AgentTaskModeDefinition[] }, systemPrompt: 'MY CUSTOM PROMPT' }, options)
  expect(migrateBuiltInAgentTaskModes(starter, options)).toEqual({ updated: true })
  const loaded = loadGlobalAgent(starter.slug, options)!
  expect(loaded.metadata.taskModes).toEqual(starter.metadata.taskModes)
  expect(loaded.metadata.name).toBe('My Artist Guide')
  expect(loaded.systemPrompt).toBe('MY CUSTOM PROMPT')
  const after = fs.readFileSync(file, 'utf8')
  expect(migrateBuiltInAgentTaskModes(starter, options)).toEqual({ updated: false })
  expect(fs.readFileSync(file, 'utf8')).toBe(after)
})

test.each(['label', 'removed', 'missing-custom'] as const)('custom %s recipes remain byte-identical', kind => {
  const { options, starter, file } = fixture()
  const metadata = structuredClone(starter.metadata)
  if (kind === 'label') metadata.taskModes![0]!.label = 'MY CUSTOM LABEL'
  else metadata.taskModes = undefined
  writeGlobalAgent({ ...starter, metadata, systemPrompt: 'MY CUSTOM PROMPT' }, options)
  if (kind === 'removed') fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^---\n/, '---\ntaskModes: []\n'))
  const before = fs.readFileSync(file, 'utf8')
  expect(migrateBuiltInAgentTaskModes(starter, options)).toEqual({ updated: false })
  expect(fs.readFileSync(file, 'utf8')).toBe(before)
})

test('all exact legacy Spotify prompts preserve appended custom instructions', () => {
  for (const oldPrompt of SPOTIFY_ANALYST_LEGACY_PROMPTS) {
    const { options, starter } = fixture('spotify-analyst')
    const suffix = '\n\nMY CUSTOM ANALYSIS RULES'
    writeGlobalAgent({ ...starter, systemPrompt: oldPrompt + suffix }, options)
    expect(replaceBuiltInAgentPromptText(starter.slug, oldPrompt, starter.systemPrompt, options).updated).toBe(true)
    expect(loadGlobalAgent(starter.slug, options)!.systemPrompt).toBe(starter.systemPrompt + suffix)
  }
})

test('modified Spotify legacy content does not trigger whole-body replacement', () => {
  const { options, starter, file } = fixture('spotify-analyst')
  writeGlobalAgent({ ...starter, systemPrompt: SPOTIFY_ANALYST_LEGACY_PROMPTS[0]!.replace('Your job is', 'My custom job is') }, options)
  const before = fs.readFileSync(file, 'utf8')
  for (const oldPrompt of SPOTIFY_ANALYST_LEGACY_PROMPTS) expect(replaceBuiltInAgentPromptText(starter.slug, oldPrompt, starter.systemPrompt, options).updated).toBe(false)
  expect(fs.readFileSync(file, 'utf8')).toBe(before)
})

test('comms exact prompt and metadata migrations work without widening arbitrary agents', () => {
  const { options, starter } = fixture('comms-agent')
  writeGlobalAgent({ ...starter, metadata: { ...starter.metadata, inputs: 'old shipped inputs' }, systemPrompt: 'old shipped paragraph\n\nMY CUSTOM INSTRUCTIONS' }, options)
  expect(replaceBuiltInAgentMetadata(starter.slug, { inputs: { from: 'old shipped inputs', to: starter.metadata.inputs } }, options).updated).toBe(true)
  expect(replaceBuiltInAgentPromptText(starter.slug, 'old shipped paragraph', 'new shipped paragraph', options).updated).toBe(true)
  expect(loadGlobalAgent(starter.slug, options)!.systemPrompt).toContain('MY CUSTOM INSTRUCTIONS')
  writeGlobalAgent({ slug: 'my-custom-agent', metadata: { name: 'Custom', description: 'old' }, systemPrompt: 'old' }, options)
  expect(replaceBuiltInAgentMetadata('my-custom-agent', { description: { from: 'old', to: 'new' } }, options).updated).toBe(false)
})

test('partial migration temp-write failure logs and preserves original bytes and custom prompt', () => {
  const { options, starter, file } = fixture('concierge')
  writeGlobalAgent({ ...starter, systemPrompt: 'MY CUSTOM PROMPT' }, options)
  const before = fs.readFileSync(file, 'utf8')
  const realWrite = fs.writeFileSync
  const warn = spyOn(console, 'warn').mockImplementation(() => {})
  const write = spyOn(fs, 'writeFileSync').mockImplementation(((path: fs.PathOrFileDescriptor, ...args: unknown[]) => {
    if (typeof path === 'string' && path.startsWith(file + '.') && path.endsWith('.tmp')) {
      realWrite(path, '---\nname:'); throw new Error('simulated partial disk write')
    }
    return (realWrite as (...args: unknown[]) => void)(path, ...args)
  }) as typeof fs.writeFileSync)
  try {
    expect(replaceBuiltInAgentMetadata(starter.slug, { description: { from: starter.metadata.description, to: 'updated description' } }, options).updated).toBe(false)
    expect(warn).toHaveBeenCalled()
    expect(fs.readFileSync(file, 'utf8')).toBe(before)
  } finally { write.mockRestore(); warn.mockRestore() }
  expect(ensureRequiredAgents([starter], options)).toEqual({ ensured: 0 })
  expect(loadGlobalAgent(starter.slug, options)!.systemPrompt).toBe('MY CUSTOM PROMPT')
})

test('unreadable original is archived byte-for-byte before stock recovery', () => {
  const { options, starter, file } = fixture('concierge')
  writeGlobalAgent(starter, options)
  const original = '---\nname: [\nCUSTOM CONTENT FROM INTERRUPTED WRITE'
  fs.writeFileSync(file, original)
  expect(ensureRequiredAgents([starter], options).ensured).toBe(1)
  const backups = fs.readdirSync(join(options.globalAgentsDir, starter.slug)).filter(name => name.startsWith('AGENT.unreadable-'))
  expect(backups).toHaveLength(1)
  expect(fs.readFileSync(join(options.globalAgentsDir, starter.slug, backups[0]!), 'utf8')).toBe(original)
})

test('archive failure prevents overwriting unreadable user bytes', () => {
  const { options, starter, file } = fixture('concierge')
  writeGlobalAgent(starter, options); fs.writeFileSync(file, '---\nname: [')
  const copy = spyOn(fs, 'copyFileSync').mockImplementation(() => { throw new Error('archive denied') })
  const warn = spyOn(console, 'warn').mockImplementation(() => {})
  try {
    expect(ensureRequiredAgents([starter], options).ensured).toBe(0)
    expect(fs.readFileSync(file, 'utf8')).toBe('---\nname: [')
    expect(warn).toHaveBeenCalled()
  } finally { copy.mockRestore(); warn.mockRestore() }
})
