import { describe, expect, it } from 'bun:test'
import { createManagedSession, ensureDeclaredGlobalSkillsEnabledForAgent } from './SessionManager.ts'

describe('createManagedSession', () => {
  const workspace = {
    id: 'ws_test',
    name: 'Test Workspace',
    rootPath: '/tmp/test-workspace',
    createdAt: Date.now(),
  }

  it('normalizes legacy thinkingLevel=think on restore', () => {
    const managed = createManagedSession({
      id: 'session_legacy',
      thinkingLevel: 'think' as any,
    }, workspace as any)

    expect(managed.thinkingLevel).toBe('medium')
  })

  it('drops invalid thinking levels instead of leaking them into runtime state', () => {
    const managed = createManagedSession({
      id: 'session_invalid',
      thinkingLevel: 'ultra' as any,
    }, workspace as any)

    expect(managed.thinkingLevel).toBeUndefined()
  })
})

describe('ensureDeclaredGlobalSkillsEnabledForAgent', () => {
  const existingSkill = { slug: 'existing-skill' }
  const installedGlobalSkill = { slug: 'installed-global-skill' }

  it('enables declared global skills before strict agent resolution runs', () => {
    const enabled: string[] = []
    const reloadedSkills = [existingSkill, installedGlobalSkill] as any

    const skills = ensureDeclaredGlobalSkillsEnabledForAgent(
      '/tmp/workspace',
      ['existing-skill', 'installed-global-skill'],
      [existingSkill] as any,
      {
        loadGlobalSkillBySlug: (slug) => slug === 'installed-global-skill' ? installedGlobalSkill as any : null,
        setGlobalSkillEnabled: (_workspaceRoot, slug, enabledFlag) => {
          if (enabledFlag) enabled.push(slug)
          return enabled
        },
        loadAllSkills: () => reloadedSkills,
      },
    )

    expect(enabled).toEqual(['installed-global-skill'])
    expect(skills).toBe(reloadedSkills)
  })

  it('does not enable skills that are not installed globally', () => {
    const enabled: string[] = []

    const skills = ensureDeclaredGlobalSkillsEnabledForAgent(
      '/tmp/workspace',
      ['missing-skill'],
      [existingSkill] as any,
      {
        loadGlobalSkillBySlug: () => null,
        setGlobalSkillEnabled: (_workspaceRoot, slug, enabledFlag) => {
          if (enabledFlag) enabled.push(slug)
          return enabled
        },
        loadAllSkills: () => {
          throw new Error('should not reload')
        },
      },
    )

    expect(enabled).toEqual([])
    expect(skills).toEqual([existingSkill] as any)
  })
})
