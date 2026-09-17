import { copyFileSync, constants, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { matter, stringifyFrontmatter } from '../config/frontmatter'
import { atomicWriteFileSync } from '../utils/files'
import { ARTIST_DIRECTION_AGENT, WORLD_BUILDER_AGENT } from './artist-direction'
import { getGlobalAgentFile, type AgentStorageOptions } from './storage'
import baselines from './__fixtures__/artist-direction-v1.json'
import v2 from './__fixtures__/artist-direction-v2.json'
import { createHash } from 'node:crypto'

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
const skillIds = (value: unknown) => Array.isArray(value) ? value.map(item => typeof item === 'string' ? item.replace(/^legacy:/, '') : item) : value

/** Upgrade only complete known stock roles. Model, permissions, personal fields and history remain intact. */
export function migrateArtistDirection(options?: AgentStorageOptions): { updated: string[]; customized: string[] } {
  const result = { updated: [] as string[], customized: [] as string[] }
  for (const next of [ARTIST_DIRECTION_AGENT, WORLD_BUILDER_AGENT]) {
    const file = getGlobalAgentFile(next.slug, options)
    if (!existsSync(file)) continue
    const original = readFileSync(file, 'utf8')
    const parsed = matter(original)
    if (parsed.content.trim() === next.systemPrompt.trim()) continue
    const prior = [...baselines, ...v2].find(candidate => candidate.slug === next.slug
      && parsed.content.trim() === candidate.systemPrompt.trim()
      && canonical(skillIds(parsed.data.skills)) === canonical(candidate.metadata.skills)
      && (parsed.data.taskModes === undefined || canonical(parsed.data.taskModes) === canonical(candidate.metadata.taskModes)))
    if (!prior) {
      result.customized.push(next.slug)
      continue
    }
    const data: Record<string, unknown> = { ...parsed.data, skills: next.metadata.skills, taskModes: next.metadata.taskModes }
    for (const field of ['name', 'description', 'avatar', 'greeting', 'inputs', 'outputs', 'tags'] as const) {
      if (canonical(parsed.data[field]) === canonical(prior.metadata[field])) data[field] = next.metadata[field]
    }
    if (parsed.data.trustedWorkerTools === undefined && next.metadata.trustedWorkerTools) data.trustedWorkerTools = next.metadata.trustedWorkerTools
    const backupDir = join(dirname(dirname(file)), '.artist-direction-backup')
    mkdirSync(backupDir, { recursive: true })
    const initialBackup = join(backupDir, `${prior.slug}.md`)
    const backup = existsSync(initialBackup)
      ? join(backupDir, `${prior.slug}-${createHash('sha256').update(original).digest('hex').slice(0, 12)}.md`)
      : initialBackup
    if (!existsSync(backup)) copyFileSync(file, backup, constants.COPYFILE_EXCL)
    atomicWriteFileSync(file, stringifyFrontmatter(next.systemPrompt, data))
    result.updated.push(prior.slug)
  }
  return result
}
