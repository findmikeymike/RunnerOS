import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateSkillContent, type CreateCustomSkillInput, type UpdateCustomSkillInput, type CustomSkillIdentity, type CustomSkillResult } from '@craft-agent/session-tools-core'
import { GLOBAL_AGENT_SKILLS_DIR, getManagedSkillManifest, isSystemGlobalSkillSlug, invalidateSkillsCache, setGlobalSkillEnabled } from '@craft-agent/shared/skills'

interface AuthoringContext { workspaceRoot: string; globalSkillsDir?: string; activate?: (slug: string) => void }
const digest = (content: string) => createHash('sha256').update(content).digest('hex')
function target(ctx: AuthoringContext, input: CustomSkillIdentity) {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(input.slug)) throw new Error('Invalid skill slug. Use lowercase letters, digits and hyphens, 1–64 characters.')
  if (input.scope !== undefined && input.scope !== 'global' && input.scope !== 'workspace') throw new Error('Skill scope must be global or workspace.')
  if (isSystemGlobalSkillSlug(input.slug) || getManagedSkillManifest().has(input.slug)) throw new Error('Built-in skills cannot be created or replaced. Use personal instructions for preferences, or choose a distinct custom slug.')
  const scope = input.scope ?? 'global'
  const root = scope === 'global' ? ctx.globalSkillsDir ?? GLOBAL_AGENT_SKILLS_DIR : join(ctx.workspaceRoot, 'skills')
  const dir = join(root, input.slug)
  const file = join(dir, 'SKILL.md')
  // Do not follow custom-directory/file aliases into another skill or private app data.
  for (const path of [root, dir, file]) {
    try { if (lstatSync(path).isSymbolicLink()) throw new Error('Skill authoring does not follow symbolic links.') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return { scope, root, dir, file }
}
function validate(content: string, slug: string) {
  if (typeof content !== 'string' || Buffer.byteLength(content) > 256 * 1024) throw new Error('SKILL.md must be text no larger than 256 KB.')
  const result = validateSkillContent(content, slug)
  if (!result.valid) throw new Error(`Invalid SKILL.md: ${result.errors.map(error => error.message).join('; ')}`)
}
export function getCustomSkill(ctx: AuthoringContext, input: CustomSkillIdentity): CustomSkillResult {
  const { scope, file } = target(ctx, input)
  if (!existsSync(file)) throw new Error('Custom skill not found in the selected scope.')
  if (lstatSync(file).size > 256 * 1024) throw new Error('Custom SKILL.md exceeds the 256 KB read limit.')
  const content = readFileSync(file, 'utf8')
  return { ok: true, slug: input.slug, scope, content, revision: digest(content) }
}
export function createCustomSkill(ctx: AuthoringContext, input: CreateCustomSkillInput): CustomSkillResult {
  const { scope, root, dir, file } = target(ctx, input)
  validate(input.content, input.slug)
  if (existsSync(dir)) throw new Error('A skill with this slug already exists in this scope. Read it and use update_skill for an approved revision.')
  mkdirSync(root, { recursive: true })
  mkdirSync(dir) // Exclusive reservation: never overwrite a concurrently created skill.
  writeFileSync(file, input.content, { encoding: 'utf8', flag: 'wx' })
  invalidateSkillsCache()
  if (scope === 'global' && input.activateInWorkspace !== false) {
    try { (ctx.activate ?? (slug => { setGlobalSkillEnabled(ctx.workspaceRoot, slug, true) }))(input.slug) }
    catch (error) { return { ok: false, saved: true, slug: input.slug, scope, revision: digest(input.content), error: `Saved custom skill, but workspace activation failed: ${error instanceof Error ? error.message : String(error)}` } }
  }
  return { ok: true, saved: true, slug: input.slug, scope, revision: digest(input.content), activated: scope === 'workspace' || input.activateInWorkspace !== false }
}
export function updateCustomSkill(ctx: AuthoringContext, input: UpdateCustomSkillInput): CustomSkillResult {
  const { scope, dir, file } = target(ctx, input)
  validate(input.content, input.slug)
  if (!existsSync(file)) throw new Error('Custom skill not found in the selected scope. Use create_skill for a new skill.')
  const before = readFileSync(file, 'utf8')
  if (!/^[a-f0-9]{64}$/.test(input.expectedRevision ?? '')) throw new Error('Read get_custom_skill and supply its expectedRevision before updating.')
  if (input.expectedRevision !== digest(before)) throw new Error('Custom skill changed. Read it again before updating.')
  const temporary = join(dir, `.SKILL.md-${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, input.content, { encoding: 'utf8', flag: 'wx', mode: lstatSync(file).mode & 0o777 })
    renameSync(temporary, file)
  } finally { if (existsSync(temporary)) unlinkSync(temporary) }
  invalidateSkillsCache()
  return { ok: true, saved: true, slug: input.slug, scope, revision: digest(input.content) }
}
