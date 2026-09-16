import { copyFileSync, constants, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { matter, stringifyFrontmatter } from '../config/frontmatter'
import { atomicWriteFileSync } from '../utils/files'
import { STOCK_BUILDER_ROLE_BASELINES, applyArtistBuilderResponsibility } from './starter-templates'
import { MANAGER_TASK_MODES, LEGACY_MANAGER_TASK_MODES } from './task-mode-recipes/manager'
import { getGlobalAgentFile, type AgentStorageOptions } from './storage'

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
const skillIds = (value: unknown) => Array.isArray(value) ? value.map(item => typeof item === 'string' ? item.replace(/^legacy:/, '') : item) : value

/** One development-profile transition. Never replaces customized agent bodies. */
export function migrateBuilderResponsibility(options?: AgentStorageOptions): { updated: string[]; customized: string[] } {
  const result = { updated: [] as string[], customized: [] as string[] }
  for (const prior of STOCK_BUILDER_ROLE_BASELINES) {
    const file = getGlobalAgentFile(prior.slug, options)
    if (!existsSync(file)) continue
    const original = readFileSync(file, 'utf8')
    const parsed = matter(original)
    const next = applyArtistBuilderResponsibility(prior, true)
    const body = parsed.content.trim()
    let recognizedBody = body
    let recognizedPreInputSupplyStock = false
    if (prior.slug === 'concierge') {
      const currentRepeat = prior.systemPrompt.split('\n').find(line => line.includes('If the job is repeatable,'))!
      const currentMissing = prior.systemPrompt.split('\n').find(line => line.includes('If no native worker fits,'))!
      recognizedBody = recognizedBody.split('\n').map(line => {
        if (line === '  - If the job is repeatable, design it as an automation; after confirmation, call `schedule_work`.') return currentRepeat
        if (line === '  - If no worker fits, say so and propose the missing worker/skill.') return currentMissing
        return line
      }).join('\n')
      // The pre-input-supply stock Manager shipped both short routing lines
      // and no supply_work_input instruction. Match that entire known body,
      // not an arbitrary missing paragraph or a customized variant.
      const hasBothOldRoutingLines = body.split('\n').includes('  - If the job is repeatable, design it as an automation; after confirmation, call `schedule_work`.')
        && body.split('\n').includes('  - If no worker fits, say so and propose the missing worker/skill.')
      const priorWithoutInputSupply = prior.systemPrompt.split('\n')
        .filter(line => !line.startsWith('  - When the artist answers a visible tracked-work input request in this Artist Manager chat, use `supply_work_input`'))
        .join('\n').trim()
      recognizedPreInputSupplyStock = hasBothOldRoutingLines && recognizedBody === priorWithoutInputSupply
    }
    if (recognizedBody !== prior.systemPrompt.trim() && !recognizedPreInputSupplyStock && body !== next.systemPrompt.trim()) {
      result.customized.push(prior.slug)
      continue
    }
    const data = { ...parsed.data }
    if (canonical(skillIds(data.skills)) === canonical(prior.metadata.skills)) data.skills = next.metadata.skills ?? []
    if (prior.slug === 'concierge' && canonical(data.taskModes) === canonical(LEGACY_MANAGER_TASK_MODES)) data.taskModes = MANAGER_TASK_MODES
    for (const key of ['description', 'outputs', 'inputs'] as const) {
      if (canonical(data[key]) === canonical(prior.metadata[key]) && next.metadata[key] !== undefined) data[key] = next.metadata[key]
    }
    const nextBody = parsed.content.replace(body, () => next.systemPrompt.trim())
    if (canonical(data) === canonical(parsed.data) && nextBody === parsed.content) continue
    const backupDir = join(dirname(dirname(file)), '.builder-transition-backup')
    mkdirSync(backupDir, { recursive: true })
    const backup = join(backupDir, `${prior.slug}.md`)
    if (!existsSync(backup)) copyFileSync(file, backup, constants.COPYFILE_EXCL)
    atomicWriteFileSync(file, stringifyFrontmatter(nextBody, data))
    result.updated.push(prior.slug)
  }
  return result
}
