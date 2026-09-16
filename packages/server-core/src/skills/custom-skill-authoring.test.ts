import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCustomSkill, getCustomSkill, updateCustomSkill } from './custom-skill-authoring'
let root: string
let ctx: { workspaceRoot: string; globalSkillsDir: string; activate: (slug: string) => void }
let activated: string[]
const content = '---\nname: Release review\ndescription: Review a release plan for missing inputs\n---\nInspect supplied inputs. Identify missing facts without inventing them. Return a concise checklist.\n'
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'custom-skill-authoring-')); activated = []; ctx = { workspaceRoot: join(root, 'workspace'), globalSkillsDir: join(root, 'library'), activate: slug => { activated.push(slug) } } })
afterEach(() => rmSync(root, { recursive: true, force: true }))
describe('custom skill authoring', () => {
  test('creates global default, activates here, and reads exact revision/content', () => {
    const saved = createCustomSkill(ctx, { slug: 'release-review', content })
    expect(saved).toMatchObject({ ok: true, saved: true, scope: 'global', activated: true })
    expect(activated).toEqual(['release-review'])
    expect(getCustomSkill(ctx, { slug: 'release-review' })).toMatchObject({ revision: saved.revision, content })
  })
  test('never overwrites a collision or touches existing companions', () => {
    const saved = createCustomSkill(ctx, { slug: 'release-review', content, activateInWorkspace: false })
    const companion = join(ctx.globalSkillsDir, 'release-review', 'notes.txt')
    writeFileSync(companion, 'preserve exactly')
    expect(() => createCustomSkill(ctx, { slug: 'release-review', content: content + 'other' })).toThrow('already exists')
    updateCustomSkill(ctx, { slug: 'release-review', content: content + 'Updated.', expectedRevision: saved.revision! })
    expect(readFileSync(companion, 'utf8')).toBe('preserve exactly')
    expect(readdirSync(join(ctx.globalSkillsDir, 'release-review')).sort()).toEqual(['SKILL.md', 'notes.txt'])
    expect(activated).toEqual([])
  })
  test('rejects stale revision and invalid updates without losing prior content', () => {
    const saved = createCustomSkill(ctx, { slug: 'release-review', content })
    updateCustomSkill(ctx, { slug: 'release-review', content: content + 'new', expectedRevision: saved.revision! })
    expect(() => updateCustomSkill(ctx, { slug: 'release-review', content, expectedRevision: saved.revision! })).toThrow('changed')
    expect(() => updateCustomSkill(ctx, { slug: 'release-review', content: 'no frontmatter', expectedRevision: saved.revision! })).toThrow('Invalid SKILL.md')
    expect(getCustomSkill(ctx, { slug: 'release-review' }).content).toBe(content + 'new')
  })
  test('protects built-ins and traversal at read/create/update boundaries', () => {
    for (const slug of ['agent-creator', 'spotify-analytics-snapshot', '../escape', '/absolute']) {
      for (const fn of [getCustomSkill, createCustomSkill, updateCustomSkill]) expect(() => fn(ctx, { slug, content, expectedRevision: '0'.repeat(64) })).toThrow()
    }
  })
  test('rejects updates without an explicit current revision at the service boundary', () => {
    createCustomSkill(ctx, { slug: 'release-review', content })
    expect(() => updateCustomSkill(ctx, { slug: 'release-review', content: content + 'Blind edit' } as never)).toThrow('expectedRevision')
    expect(getCustomSkill(ctx, { slug: 'release-review' }).content).toBe(content)
  })
  test('scopes exact reads and updates without silently replacing a global skill', () => {
    createCustomSkill(ctx, { slug: 'release-review', content })
    createCustomSkill(ctx, { slug: 'release-review', scope: 'workspace', content: content + 'Workspace' })
    updateCustomSkill(ctx, { slug: 'release-review', scope: 'workspace', content: content + 'Local update', expectedRevision: getCustomSkill(ctx, { slug: 'release-review', scope: 'workspace' }).revision! })
    expect(getCustomSkill(ctx, { slug: 'release-review' }).content).toBe(content)
    expect(getCustomSkill(ctx, { slug: 'release-review', scope: 'workspace' }).content).toBe(content + 'Local update')
  })
  test('rejects directory and SKILL.md symlinks without changing their targets', () => {
    mkdirSync(ctx.globalSkillsDir)
    const outside = join(root, 'outside'); mkdirSync(outside); writeFileSync(join(outside, 'SKILL.md'), content)
    symlinkSync(outside, join(ctx.globalSkillsDir, 'linked'))
    expect(() => updateCustomSkill(ctx, { slug: 'linked', content: content + 'bad', expectedRevision: '0'.repeat(64) })).toThrow('symbolic')
    mkdirSync(join(ctx.globalSkillsDir, 'linked-file')); symlinkSync(join(outside, 'SKILL.md'), join(ctx.globalSkillsDir, 'linked-file', 'SKILL.md'))
    expect(() => getCustomSkill(ctx, { slug: 'linked-file' })).toThrow('symbolic')
    expect(readFileSync(join(outside, 'SKILL.md'), 'utf8')).toBe(content)
  })
  test('reports saved-but-not-activated honestly', () => {
    const result = createCustomSkill({ ...ctx, activate: () => { throw new Error('unavailable') } }, { slug: 'release-review', content })
    expect(result).toMatchObject({ ok: false, saved: true, scope: 'global' })
    expect(result.error).toContain('activation failed')
    expect(getCustomSkill(ctx, { slug: 'release-review' }).content).toBe(content)
  })
})
