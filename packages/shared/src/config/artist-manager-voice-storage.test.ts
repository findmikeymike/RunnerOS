import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createArtistManagerVoiceSettingsStore } from './artist-manager-voice-storage.ts'
import { DEFAULT_ARTIST_MANAGER_VOICE_SETTINGS, parseArtistManagerVoiceSettings } from './artist-manager-voice-settings.ts'
import type { StoredConfig } from './storage.ts'

const directories: string[] = []
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })
const configured = { ...DEFAULT_ARTIST_MANAGER_VOICE_SETTINGS, connectionSlug: 'voice-api', model: 'pi/fast-model' }
function fixture(initial?: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'voice-settings-test-')); directories.push(dir)
  const file = join(dir, 'config.json')
  if (initial !== undefined) writeFileSync(file, typeof initial === 'string' ? initial : JSON.stringify(initial))
  let writes = 0
  const store = createArtistManagerVoiceSettingsStore({
    exists: () => existsSync(file),
    load: () => {
      if (!existsSync(file)) return null
      try { const parsed = JSON.parse(readFileSync(file, 'utf8')); return parsed && Array.isArray(parsed.workspaces) ? parsed as StoredConfig : null } catch { return null }
    },
    save: config => { writes++; writeFileSync(file + '.tmp', JSON.stringify(config)); renameSync(file + '.tmp', file) },
  })
  return { dir, file, store, writes: () => writes }
}

describe('conversation voice settings storage', () => {
  test('absent settings return independent defaults without a write', () => {
    const f = fixture({ workspaces: [], activeWorkspaceId: null, activeSessionId: null })
    const settings = f.store.get()
    expect(settings).toEqual(DEFAULT_ARTIST_MANAGER_VOICE_SETTINGS)
    settings.style = 'laid-back'
    expect(f.store.get().style).toBe('sharp')
    expect(f.writes()).toBe(0)
    const missing = fixture()
    expect(missing.store.get()).toEqual(DEFAULT_ARTIST_MANAGER_VOICE_SETTINGS)
    expect(() => missing.store.update(configured)).toThrow('Set up the app')
    expect(missing.writes()).toBe(0)
  })

  test('round-trips voice settings while preserving connections, defaults, permission and Manager data', () => {
    const before = {
      workspaces: [{ id: 'artist', name: 'Artist', rootPath: '/artist', defaults: { model: 'quality-model', permissionMode: 'ask' } }],
      activeWorkspaceId: 'artist', activeSessionId: 'existing-session',
      defaultLlmConnection: 'command-api', defaultThinkingLevel: 'high',
      llmConnections: [{ slug: 'command-api', defaultModel: 'quality-model' }, { slug: 'voice-api', defaultModel: 'another-default' }],
      delegation: { subagent_auto_approve: false, max_spawn_depth: 1 },
      modelFallbackChain: { enabled: true, entries: [{ connectionSlug: 'command-api', model: 'quality-model' }] },
    }
    const f = fixture(before)
    const agentFile = join(f.dir, 'AGENT.md')
    const agent = '---\nmodel: quality-model\npermissionMode: ask\nthinkingLevel: high\n---\nArtist Manager persona'
    writeFileSync(agentFile, agent)
    expect(f.store.update(configured)).toEqual(configured)
    const persisted = JSON.parse(readFileSync(f.file, 'utf8'))
    const { artistManagerVoice, ...rest } = persisted
    expect(artistManagerVoice).toEqual(configured)
    expect(rest).toEqual(before)
    expect(readFileSync(agentFile, 'utf8')).toBe(agent)
    expect(f.store.get()).toEqual(configured)
    f.store.update({ ...configured, connectionSlug: null, model: null, thinking: 'off' })
    expect(f.store.get()).toEqual({ ...configured, connectionSlug: null, model: null, thinking: 'off' })
  })

  test('malformed configuration or saved settings fail visibly without overwriting bytes', () => {
    for (const initial of ['{broken', '{"workspaces":null}', { workspaces: [], artistManagerVoice: { ...configured, thinking: 'high' } }]) {
      const f = fixture(initial)
      const before = readFileSync(f.file, 'utf8')
      expect(() => f.store.get()).toThrow()
      expect(() => f.store.update(configured)).toThrow()
      expect(f.writes()).toBe(0)
      expect(readFileSync(f.file, 'utf8')).toBe(before)
    }
  })

  test('rejects unknown fields, partial route, unsafe or oversized identifiers and invalid enums before saving', () => {
    const f = fixture({ workspaces: [], artistManagerVoice: configured })
    for (const value of [
      null, [], {}, { ...configured, permissionMode: 'allow-all' }, { ...configured, version: 2 },
      { ...configured, connectionSlug: null }, { ...configured, model: null }, { ...configured, connectionSlug: '../other' },
      { ...configured, connectionSlug: 'a'.repeat(101) }, { ...configured, model: 'a'.repeat(201) },
      { ...configured, model: ' default ' }, { ...configured, model: 'default' }, { ...configured, model: 'fast' },
      { ...configured, model: 'model\nother' }, { ...configured, thinking: 'high' },
      { ...configured, style: 'invented' }, { ...configured, sttSelection: 'moonshine-unknown' },
    ]) expect(() => f.store.update(value)).toThrow()
    expect(f.writes()).toBe(0)
    expect(f.store.get()).toEqual(configured)
  })

  test('accepts every supported hearing selection with a cleared or complete route', () => {
    for (const sttSelection of ['moonshine-tiny-streaming-en', 'moonshine-small-streaming-en', 'moonshine-medium-streaming-en', 'assembly_ai']) {
      expect(parseArtistManagerVoiceSettings({ ...configured, sttSelection }).sttSelection).toBe(sttSelection)
    }
  })
})
