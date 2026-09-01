import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  migrateInitialReleaseManagerActivation,
  preserveReleaseManagerActivationChoices,
  releaseManagerActivationNeedsWork,
  type ReleaseManagerActivationWorkspace,
} from './release-manager-activation.ts'

const workspaces: ReleaseManagerActivationWorkspace[] = [
  { id: 'hq', rootPath: '/artist/hq', artistWorkspaceScope: 'hq' },
  { id: 'campaign', rootPath: '/artist/campaign', artistWorkspaceScope: 'campaign' },
  { id: 'lab', rootPath: '/artist/lab', artistWorkspaceScope: 'lab' },
  { id: 'remote', rootPath: '/artist/remote', artistWorkspaceScope: 'hq', remoteServer: 'remote-1' },
]

describe('Release Manager initial activation migration', () => {
  const tempRoots: string[] = []

  afterEach(() => {
    for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  function setup() {
    const root = mkdtempSync(join(tmpdir(), 'release-manager-activation-'))
    tempRoots.push(root)
    const stateFile = join(root, '.migrations', 'release-manager-activation-v1.json')
    const active = new Set<string>()
    const skills = new Map<string, Set<string>>()
    const calls: string[] = []

    return {
      root,
      stateFile,
      active,
      skills,
      calls,
      run(overrides: Partial<Parameters<typeof migrateInitialReleaseManagerActivation>[0]> = {}) {
        return migrateInitialReleaseManagerActivation({
          stateFile,
          workspaces,
          agentSlug: 'artist-os-release-manager',
          skillSlugs: ['release-ops', 'rights'],
          isAgentActive: workspace => active.has(workspace.id),
          activateAgent: workspace => {
            calls.push(`agent:${workspace.id}`)
            active.add(workspace.id)
          },
          enabledSkillSlugs: workspace => [...(skills.get(workspace.id) ?? [])],
          enableSkill: (workspace, skillSlug) => {
            calls.push(`skill:${workspace.id}:${skillSlug}`)
            const enabled = skills.get(workspace.id) ?? new Set<string>()
            enabled.add(skillSlug)
            skills.set(workspace.id, enabled)
          },
          ...overrides,
        })
      },
    }
  }

  test('activates only existing local HQ and Campaign workspaces once', () => {
    const harness = setup()
    const first = harness.run()

    expect(first.complete).toBe(true)
    expect(first.updatedWorkspaceIds).toEqual(['hq', 'campaign'])
    expect(harness.active).toEqual(new Set(['hq', 'campaign']))
    expect(harness.calls).not.toContain('agent:lab')
    expect(harness.calls).not.toContain('agent:remote')

    harness.calls.length = 0
    harness.active.delete('hq')
    const second = harness.run()

    expect(second.updatedWorkspaceIds).toEqual([])
    expect(harness.calls).toEqual([])
    expect(harness.active.has('hq')).toBe(false)
  })

  test('isolates a failed workspace and retries only that workspace', () => {
    const harness = setup()
    let failCampaign = true
    const enableSkill = (workspace: ReleaseManagerActivationWorkspace, skillSlug: string) => {
      if (workspace.id === 'campaign' && failCampaign) throw new Error('drive unavailable')
      harness.calls.push(`skill:${workspace.id}:${skillSlug}`)
      const enabled = harness.skills.get(workspace.id) ?? new Set<string>()
      enabled.add(skillSlug)
      harness.skills.set(workspace.id, enabled)
    }

    const first = harness.run({ enableSkill })
    expect(first.complete).toBe(false)
    expect(first.failedWorkspaceIds).toEqual(['campaign'])
    expect(first.updatedWorkspaceIds).toEqual(['hq'])

    harness.calls.length = 0
    harness.active.delete('hq')
    failCampaign = false
    const second = harness.run({ enableSkill })

    expect(second.complete).toBe(true)
    expect(second.failedWorkspaceIds).toEqual([])
    expect(second.updatedWorkspaceIds).toEqual(['campaign'])
    expect(harness.calls.some(call => call.includes(':hq'))).toBe(false)
    expect(harness.active.has('hq')).toBe(false)
  })

  test('moves a legacy marker into durable state without reactivating workspaces', () => {
    const harness = setup()
    const legacyMarkerFile = join(harness.root, 'artist-os-release-manager', '.initial-hq-campaign-activation-v1')
    mkdirSync(join(harness.root, 'artist-os-release-manager'), { recursive: true })
    writeFileSync(legacyMarkerFile, 'done', { encoding: 'utf8', flag: 'w' })

    const result = harness.run({ legacyMarkerFile })

    expect(result.complete).toBe(true)
    expect(result.migratedLegacyMarker).toBe(true)
    expect(harness.calls).toEqual([])
    expect(existsSync(harness.stateFile)).toBe(true)
    expect(releaseManagerActivationNeedsWork(harness.stateFile, legacyMarkerFile)).toBe(false)
  })

  test('preserves workspace choices when the agent was deleted before migration state moved', () => {
    const harness = setup()

    preserveReleaseManagerActivationChoices(harness.stateFile, workspaces)
    expect(releaseManagerActivationNeedsWork(harness.stateFile)).toBe(false)

    const afterReinstall = harness.run()
    expect(afterReinstall.complete).toBe(true)
    expect(afterReinstall.updatedWorkspaceIds).toEqual([])
    expect(harness.calls).toEqual([])
  })

  test('fails closed on malformed state instead of reactivating workspaces', () => {
    const harness = setup()
    mkdirSync(join(harness.root, '.migrations'), { recursive: true })
    writeFileSync(harness.stateFile, '{broken', 'utf8')

    expect(releaseManagerActivationNeedsWork(harness.stateFile)).toBe(false)
    expect(harness.run().complete).toBe(true)
    expect(harness.calls).toEqual([])
    expect(releaseManagerActivationNeedsWork(harness.stateFile)).toBe(false)
  })
})
