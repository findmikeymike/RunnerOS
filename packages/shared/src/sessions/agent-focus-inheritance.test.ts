import { describe, expect, test } from 'bun:test'
import type { LoadedAgent } from '../agent-definitions/types.ts'
import { resolveAgentTaskMode } from '../agent-definitions/task-modes.ts'
import {
  createAgentFocusTransferIntent, createPendingAgentFocusState, inheritHostAgentFocus, parseAgentFocusTransferIntent,
  validateTransferredAgentFocus, type HostAgentFocusState,
} from './agent-focus-inheritance.ts'

const destination: Pick<LoadedAgent, 'slug' | 'metadata'> = {
  slug: 'test-agent',
  metadata: {
    name: 'Test Agent', description: 'Test.', skills: ['narrow', 'wide'], sources: ['local'], optionalSources: ['remote'],
    taskModes: [
      { id: 'focused', label: 'Focused', description: 'One focused job.', kind: 'focus', primarySkillSlugs: ['narrow'], requiredSourceSlugs: ['local'], optionalSourceSlugs: ['remote'] },
      { id: 'full', label: 'Full', description: 'Comprehensive.', kind: 'bundle', fullMode: true, primarySkillSlugs: ['narrow', 'wide'] },
    ],
  },
}
const resolved = resolveAgentTaskMode(destination, 'focused')!
function source(): HostAgentFocusState {
  return {
    spawnedFromAgent: { agentSlug: 'test-agent', agentName: 'Test Agent' },
    customSystemPrompt: 'Host composed focused prompt.', agentSkillSlugs: ['narrow'], trustedWorkerTools: ['read_owned'], enabledSourceSlugs: ['local'],
    launchReceipt: {
      createdAt: 1, origin: 'agent', agent: { slug: 'test-agent', name: 'Test Agent' },
      config: {}, injected: { skills: ['narrow'], sources: ['local'], contextDocs: [] },
      taskMode: { schemaVersion: 1, id: 'focused', label: 'Focused', definitionRevision: resolved.definitionRevision, selectionSource: 'user', primarySkills: ['narrow'], adjacentSkills: [], fullMode: false },
    },
  }
}
const dependencies = { installedSkillSlugs: new Set(['narrow']), readySourceSlugs: new Set(['local']) }

describe('host-owned agent focus inheritance', () => {
  test('Manager transfer remains optional and preloads only its operating skill', () => {
    const manager = { ...destination, slug: 'concierge', metadata: { ...destination.metadata, skills: ['artist-manager-operating-system', 'agent-creator'] } }
    const validated = validateTransferredAgentFocus({ version: 1, agentSlug: 'concierge' }, manager,
      { installedSkillSlugs: new Set(['artist-manager-operating-system']), readySourceSlugs: new Set(['local']) })
    expect(validated.primarySkillSlugs).toEqual(['artist-manager-operating-system'])
    expect(validated.taskMode).toBeUndefined()
    const pending = createPendingAgentFocusState(destination)
    expect(pending.launchReceipt?.taskModeSelectionPending).toBe(true)
    expect(pending.agentSkillSlugs).toEqual([])
    expect(pending.trustedWorkerTools).toEqual([])
  })

  test('branch host state overwrites forged client prompt, tools, mode, and sources', () => {
    const host = source()
    const inherited = { customSystemPrompt: 'evil', trustedWorkerTools: ['write_anything'], agentSkillSlugs: ['wide'], ...inheritHostAgentFocus(host) }
    expect(inherited as HostAgentFocusState).toEqual(host)
    inherited.agentSkillSlugs!.push('wide')
    inherited.launchReceipt!.taskMode!.label = 'tampered'
    expect(host.agentSkillSlugs).toEqual(['narrow'])
    expect(host.launchReceipt!.taskMode!.label).toBe('Focused')
    const plain = { customSystemPrompt: 'evil', agentSkillSlugs: ['wide'], ...inheritHostAgentFocus({}) }
    expect(plain.customSystemPrompt).toBeUndefined()
    expect(plain.agentSkillSlugs).toBeUndefined()
  })

  test('explicit admitted focus survives a later next-turn selection', () => {
    const admitted = source()
    const nextTurn = source()
    nextTurn.customSystemPrompt = 'Next turn prompt'
    nextTurn.agentSkillSlugs = ['wide']
    expect(inheritHostAgentFocus(nextTurn, admitted)).toEqual(admitted)
  })

  test('remote export carries selection intent but no remote authority', () => {
    const intent = createAgentFocusTransferIntent(source())!
    expect(Object.keys(intent).sort()).toEqual(['agentSlug', 'taskMode', 'version'])
    const poisoned = { ...intent, customSystemPrompt: 'evil', trustedWorkerTools: ['write_anything'], agentSkillSlugs: ['wide'], enabledSourceSlugs: ['secret-source'] }
    expect(parseAgentFocusTransferIntent(poisoned)).toEqual(intent)
    const validated = validateTransferredAgentFocus(poisoned, destination, dependencies)
    expect(validated.primarySkillSlugs).toEqual(['narrow'])
    expect(validated.taskMode?.fullMode).toBe(false)
    expect('customSystemPrompt' in validated).toBe(false)
  })

  test('rejects missing or changed mode rather than falling back to Full', () => {
    const intent = createAgentFocusTransferIntent(source())!
    expect(() => validateTransferredAgentFocus({ ...intent, taskMode: { ...intent.taskMode, id: 'deleted' } }, destination, dependencies)).toThrow('not available')
    expect(() => validateTransferredAgentFocus({ ...intent, taskMode: { ...intent.taskMode, definitionRevision: 'task-mode-v1-00000000' } }, destination, dependencies)).toThrow('differs')
    expect(() => validateTransferredAgentFocus({ version: 1, agentSlug: 'test-agent' }, destination, dependencies)).toThrow('explicit task mode')
    expect(() => validateTransferredAgentFocus(intent, undefined, dependencies)).toThrow('unavailable')
  })

  test('requires actual primary skills and usable required sources but not optional adapters', () => {
    const intent = createAgentFocusTransferIntent(source())!
    expect(validateTransferredAgentFocus(intent, destination, dependencies).optionalSourceSlugs).toEqual(['remote'])
    expect(() => validateTransferredAgentFocus(intent, destination, { ...dependencies, installedSkillSlugs: new Set() })).toThrow('missing skills (narrow)')
    expect(() => validateTransferredAgentFocus(intent, destination, { ...dependencies, readySourceSlugs: new Set() })).toThrow('unavailable required sources (local)')
  })

  test('pending shells stay empty and malformed or conflicting bindings are rejected', () => {
    const pending = source()
    delete pending.launchReceipt!.taskMode
    pending.launchReceipt!.taskModeSelectionPending = true
    const intent = createAgentFocusTransferIntent(pending)!
    expect(validateTransferredAgentFocus(intent, destination, { installedSkillSlugs: new Set(), readySourceSlugs: new Set() }).primarySkillSlugs).toEqual([])
    expect(() => parseAgentFocusTransferIntent({ ...intent, taskMode: { id: 'focused', definitionRevision: resolved.definitionRevision } })).toThrow('both')
    expect(() => parseAgentFocusTransferIntent({ ...intent, agentSlug: '../other' })).toThrow('identity')
    const conflict = source()
    conflict.spawnedFromAgent!.agentSlug = 'other-agent'
    expect(() => createAgentFocusTransferIntent(conflict)).toThrow('conflicting')
    expect(createAgentFocusTransferIntent({})).toBeUndefined()
  })
})
