import { afterAll, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'

const root = mkdtempSync(join(tmpdir(), 'skill-rpc-'))
const workspace = { id: 'test', rootPath: root }
const managed = { slug: 'core', source: 'global', metadata: { name: 'Core' }, content: 'PRIVATE BODY', path: '/private/core', managed: true }
const custom = { slug: 'custom', source: 'global', metadata: { name: 'Custom' }, content: 'USER BODY', path: '/custom' }
let deleted = false
mock.module('@craft-agent/shared/config', () => ({ getWorkspaceByNameOrId: (id: string) => id === 'test' ? workspace : null }))
mock.module('@craft-agent/shared/workspaces', () => ({ assertTeamPermission: () => {} }))
mock.module('@craft-agent/shared/skills', () => ({
  loadAllSkills: () => [managed, custom], loadGlobalSkills: () => [managed, custom], isSystemGlobalSkillSlug: () => false,
  loadSkillBySlug: (_root: string, slug: string) => slug === 'core' ? managed : slug === 'custom' ? custom : null,
  isManagedSkillPath: () => false, isPublicManagedSkillPath: () => false,
  isManagedSkill: (skill: unknown) => skill === managed,
  toSkillDescriptors: (skills: typeof managed[]) => skills.map(skill => ({ slug: skill.slug, metadata: skill.metadata })),
  deleteSkill: () => { deleted = true; return true },
  getOrphanedPersonalSkillDescriptors: () => [],
  getManagedSkillNotices: () => [], importPersonalInstruction: () => null, getPersonalInstructions: () => [], savePersonalInstruction: () => null, deletePersonalInstruction: () => {},
}))
const { registerSkillsHandlers } = await import('./skills')
const handlers = new Map<string, (...args: any[]) => any>()
registerSkillsHandlers({ handle: (channel: string, handler: any) => handlers.set(channel, handler) } as any, { platform: {}, sessionManager: {} } as any)
const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, 'test', ...args)
afterAll(() => rmSync(root, { recursive: true, force: true }))
describe('skill RPC protection', () => {
  it('returns descriptors from both list routes', async () => {
    for (const channel of [RPC_CHANNELS.skills.GET, RPC_CHANNELS.skills.LIST_GLOBAL]) {
      const result = await call(channel)
      expect(JSON.stringify(result)).not.toContain('PRIVATE BODY')
      expect(JSON.stringify(result)).not.toContain('/private/core')
      expect(result).toHaveLength(2)
    }
  })
  it('blocks built-in content and file actions at the server', async () => {
    for (const channel of [RPC_CHANNELS.skills.GET_DETAIL, RPC_CHANNELS.skills.GET_FILES, RPC_CHANNELS.skills.OPEN_EDITOR, RPC_CHANNELS.skills.OPEN_FINDER, RPC_CHANNELS.skills.DELETE]) {
      await expect(call(channel, 'core')).rejects.toThrow('Built-in')
    }
  })
  it('keeps user detail readable and rejects misleading global deletion', async () => {
    expect((await call(RPC_CHANNELS.skills.GET_DETAIL, 'custom')).content).toBe('USER BODY')
    await expect(call(RPC_CHANNELS.skills.DELETE, 'custom')).rejects.toThrow('Only workspace')
    expect(deleted).toBe(false)
  })
})
