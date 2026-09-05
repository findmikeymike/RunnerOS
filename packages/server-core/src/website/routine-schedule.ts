import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { validateAutomationsConfig } from '@craft-agent/shared/automations'
import { resolveAutomationsConfigPath } from '@craft-agent/shared/automations/resolve-config-path'
import { atomicWriteFileSync } from '@craft-agent/shared/utils'
import { cronForRoutine, describeCadence, loadWebsiteManifest, websiteManifestPath, type WebsiteRoutineConfig } from '@craft-agent/shared/website'
import { withConfigMutex } from '../handlers/rpc/automations'
import { withWebsiteLock } from './build-snapshot'

export const WEBSITE_ROUTINE_ID = 'website-refresh'
const NAME = 'Website Refresh'
type Config = { automations?: Record<string, Record<string, unknown>[]>; [key: string]: unknown }
type Journal = { before: string; after: string; routine: WebsiteRoutineConfig; previous?: WebsiteRoutineConfig }
type Write = typeof atomicWriteFileSync
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n'
const journalPath = (root: string) => join(root, '.website-routine-transaction.json')

function readOptional(path: string): string | undefined {
  try { return readFileSync(path, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function saveRoutine(root: string, routine: WebsiteRoutineConfig | undefined, write: Write): void {
  const manifest = loadWebsiteManifest(root)
  if (!manifest) throw new Error('No website in this workspace yet.')
  write(websiteManifestPath(root), json({ ...manifest, routine, updatedAt: new Date().toISOString() }))
}

// The schedule file is authoritative after an interrupted two-file update.
function reconcile(root: string, write: Write): void {
  const raw = readOptional(journalPath(root))
  if (!raw) return
  const journal = JSON.parse(raw) as Journal
  const actual = readOptional(resolveAutomationsConfigPath(root)) ?? json({ version: 2, automations: {} })
  if (actual !== journal.before && actual !== journal.after) {
    throw new Error('Website schedule recovery needs attention: automations changed during recovery.')
  }
  saveRoutine(root, actual === journal.after ? journal.routine : journal.previous, write)
  rmSync(journalPath(root), { force: true })
}

export async function reconcileWebsiteRoutine(root: string): Promise<void> {
  return withWebsiteLock(root, () => withConfigMutex(root, async () => reconcile(root, atomicWriteFileSync)))
}

export async function setWebsiteRoutine(root: string, input: WebsiteRoutineConfig, deps: { write?: Write } = {}) {
  const write = deps.write ?? atomicWriteFileSync
  try {
    return await withWebsiteLock(root, () => withConfigMutex(root, async () => {
      reconcile(root, write)
      const manifest = loadWebsiteManifest(root)
      if (!manifest) throw new Error('No website in this workspace yet.')
      if (!input || !['manual', 'weekly', 'monthly'].includes(input.cadence)) throw new Error('Invalid website cadence.')
      const routine: WebsiteRoutineConfig = {
        ...manifest.routine,
        cadence: input.cadence,
        dayOfWeek: input.dayOfWeek ?? manifest.routine?.dayOfWeek ?? 1,
        dayOfMonth: input.dayOfMonth ?? manifest.routine?.dayOfMonth ?? 1,
        hour: input.hour ?? manifest.routine?.hour ?? 9,
        timezone: input.timezone ?? manifest.routine?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        automation: undefined,
      }
      for (const [value, min, max] of [[routine.hour, 0, 23], [routine.dayOfWeek, 0, 6], [routine.dayOfMonth, 1, 28]]) {
        if (!Number.isInteger(value) || value! < min! || value! > max!) throw new Error('Invalid website schedule time.')
      }
      new Intl.DateTimeFormat('en', { timeZone: routine.timezone })
      const path = resolveAutomationsConfigPath(root)
      const before = readOptional(path) ?? json({ version: 2, automations: {} })
      const config = JSON.parse(before) as Config
      const initial = validateAutomationsConfig(config)
      if (!initial.valid) throw new Error(`Invalid automation config: ${initial.errors.join('; ')}`)
      const events = config.automations ??= {}
      const matchers = events.SchedulerTick ??= []
      const owned = matchers.filter(m => m.templateKey === WEBSITE_ROUTINE_ID || m.id === WEBSITE_ROUTINE_ID || (m.name === NAME && Array.isArray(m.actions) && m.actions.some(a => a.type === 'prompt' && a.agentSlug === 'website-agent')))
      const existing = owned.find(m => m.id === WEBSITE_ROUTINE_ID) ?? owned[0]
      const id = typeof existing?.id === 'string' ? existing.id : WEBSITE_ROUTINE_ID
      const cron = cronForRoutine(routine)
      events.SchedulerTick = matchers.filter(m => !owned.includes(m))
      if (cron) events.SchedulerTick.push({
        ...existing, id, templateKey: WEBSITE_ROUTINE_ID, name: NAME, cron, timezone: routine.timezone, enabled: true,
        snoozedUntil: undefined, permissionMode: 'safe', labels: ['website', 'artist-hq', 'scheduled'],
        actions: [{ type: 'prompt', agentSlug: 'website-agent', prompt: 'Scheduled site check. Do only the obvious work: pull in anyone who signed up, and add content the artist already posted publicly as a site update. Do not add shows, reshuffle the home page, or change a release you were not asked about. Build and preview. Anything else you notice, report it as something worth a look and leave it alone. Do not publish unless the artist has already turned on automatic publishing for content changes.' }],
      })
      // Retain identity while manual, without leaving an active trigger.
      if (!cron && existing) events.SchedulerTick.push({ ...existing, id, templateKey: WEBSITE_ROUTINE_ID, enabled: false })
      const validation = validateAutomationsConfig(config)
      if (!validation.valid) throw new Error(`Invalid automation: ${validation.errors.join('; ')}`)
      const after = json(config)
      write(journalPath(root), json({ before, after, routine, previous: manifest.routine } satisfies Journal))
      let replaced = false
      try {
        write(path, after)
        replaced = true
        saveRoutine(root, routine, write)
      } catch (error) {
        try {
          if (replaced) write(path, before)
          reconcile(root, write)
        } catch {
          // Retain the journal; STATUS and the next SET reconcile before reporting state.
        }
        throw error
      }
      rmSync(journalPath(root), { force: true })
      return { ok: true, routine, cron, description: describeCadence(routine) }
    }))
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
