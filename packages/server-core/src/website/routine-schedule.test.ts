import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { atomicWriteFileSync } from '@craft-agent/shared/utils'
import { defaultWebsiteManifest, loadWebsiteManifest, saveWebsiteManifest, websiteManifestPath } from '@craft-agent/shared/website'
import { resolveAutomationsConfigPath } from '@craft-agent/shared/automations/resolve-config-path'
import { withConfigMutex } from '../handlers/rpc/automations'
import { reconcileWebsiteRoutine, setWebsiteRoutine, WEBSITE_ROUTINE_ID } from './routine-schedule'
import { withWebsiteLock } from './build-snapshot'

let root: string
const weekly = { cadence: 'weekly' as const, hour: 9, timezone: 'America/Chicago' }
const monthly = { cadence: 'monthly' as const, dayOfMonth: 12, hour: 14 }
const configPath = () => resolveAutomationsConfigPath(root)
const config = () => JSON.parse(readFileSync(configPath(), 'utf8'))
const schedules = () => config().automations.SchedulerTick

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'website-schedule-'))
  saveWebsiteManifest(root, defaultWebsiteManifest())
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('backend website schedule transaction', () => {
  test('one config write per update; stable identity across weekly, monthly and manual', async () => {
    let writes = 0
    const write = (path: string, data: string) => {
      if (path === configPath()) writes++
      atomicWriteFileSync(path, data)
    }
    expect((await setWebsiteRoutine(root, weekly, { write })).ok).toBe(true)
    expect(writes).toBe(1)
    expect(schedules()[0].id).toBe(WEBSITE_ROUTINE_ID)
    expect((await setWebsiteRoutine(root, monthly, { write })).ok).toBe(true)
    expect(writes).toBe(2)
    expect(schedules()).toHaveLength(1)
    expect(schedules()[0].cron).toBe('0 14 12 * *')
    expect((await setWebsiteRoutine(root, { cadence: 'manual' }, { write })).ok).toBe(true)
    expect(schedules()[0].enabled).toBe(false)
    expect(loadWebsiteManifest(root)?.routine?.cadence).toBe('manual')
    await setWebsiteRoutine(root, weekly)
    expect(schedules()).toHaveLength(1)
    expect(schedules()[0].id).toBe(WEBSITE_ROUTINE_ID)
    expect(schedules()[0].enabled).toBe(true)
  })

  test('adopts legacy identity and leaves unrelated automations and config intact', async () => {
    await setWebsiteRoutine(root, weekly)
    const original = config()
    original.automations.SchedulerTick[0].id = 'legacy1'
    delete original.automations.SchedulerTick[0].templateKey
    const unrelated = { id: 'other1', name: 'Other', cron: '0 3 * * *', actions: [{ type: 'prompt', prompt: 'Other task' }] }
    original.automations.SchedulerTick.unshift(unrelated)
    atomicWriteFileSync(configPath(), JSON.stringify(original))
    expect((await setWebsiteRoutine(root, monthly)).ok).toBe(true)
    expect(schedules()[0]).toEqual(unrelated)
    expect(schedules()[1].id).toBe('legacy1')
    const renamed = config()
    renamed.automations.SchedulerTick[1].name = 'Renamed'
    atomicWriteFileSync(configPath(), JSON.stringify(renamed))
    await setWebsiteRoutine(root, weekly)
    expect(schedules()).toHaveLength(2)
    expect(schedules()[1].id).toBe('legacy1')
  })

  test.each(['journal', 'config', 'manifest'])('%s write failure preserves the working schedule and cadence', async (stage) => {
    await setWebsiteRoutine(root, weekly)
    const before = readFileSync(configPath(), 'utf8')
    const previous = loadWebsiteManifest(root)?.routine
    const target = stage === 'config' ? configPath() : stage === 'manifest' ? websiteManifestPath(root) : join(root, '.website-routine-transaction.json')
    let failed = false
    const result = await setWebsiteRoutine(root, monthly, { write(path, data) {
      if (path === target && !failed) { failed = true; throw new Error('injected disk failure') }
      atomicWriteFileSync(path, data)
    } })
    expect(result.ok).toBe(false)
    expect(readFileSync(configPath(), 'utf8')).toBe(before)
    expect(loadWebsiteManifest(root)?.routine).toEqual(previous)
    await reconcileWebsiteRoutine(root)
    expect(loadWebsiteManifest(root)?.routine).toEqual(previous)
  })

  test('failed manual change does not disable the working schedule', async () => {
    await setWebsiteRoutine(root, weekly)
    const result = await setWebsiteRoutine(root, { cadence: 'manual' }, { write(path, data) {
      if (path === websiteManifestPath(root)) throw new Error('disk failure')
      atomicWriteFileSync(path, data)
    } })
    expect(result.ok).toBe(false)
    expect(schedules()[0].enabled).toBe(true)
    await reconcileWebsiteRoutine(root)
    expect(loadWebsiteManifest(root)?.routine?.cadence).toBe('weekly')
  })

  test('rollback failure leaves recoverable journal; fresh reader reconciles to actual schedule', async () => {
    await setWebsiteRoutine(root, weekly)
    let configWrites = 0
    const result = await setWebsiteRoutine(root, monthly, { write(path, data) {
      if (path === configPath() && ++configWrites > 1) throw new Error('rollback failed')
      if (path === websiteManifestPath(root)) throw new Error('manifest failed')
      atomicWriteFileSync(path, data)
    } })
    expect(result.ok).toBe(false)
    expect(schedules()[0].cron).toBe('0 14 12 * *')
    await reconcileWebsiteRoutine(root)
    expect(loadWebsiteManifest(root)?.routine?.cadence).toBe('monthly')
    expect(loadWebsiteManifest(root)?.routine?.hour).toBe(14)
  })

  test('invalid input or corrupt automation config writes nothing', async () => {
    await setWebsiteRoutine(root, weekly)
    let writes = 0
    const write = () => { writes++; throw new Error('must not write') }
    for (const input of [{ ...weekly, hour: 24 }, { ...weekly, timezone: 'invalid/zone' }, { ...weekly, cadence: 'bad' }]) {
      expect((await setWebsiteRoutine(root, input as typeof weekly, { write })).ok).toBe(false)
    }
    atomicWriteFileSync(configPath(), '{broken')
    expect((await setWebsiteRoutine(root, monthly, { write })).ok).toBe(false)
    expect(writes).toBe(0)
    expect(loadWebsiteManifest(root)?.routine?.cadence).toBe('weekly')
  })

  test('shares config mutex with other writers and serializes simultaneous cadence changes', async () => {
    await setWebsiteRoutine(root, weekly)
    const otherWrite = withConfigMutex(root, async () => {
      const other = config()
      await new Promise(resolve => setTimeout(resolve, 10))
      other.automations.SchedulerTick.push({ id: 'other1', cron: '0 1 * * *', actions: [{ type: 'prompt', prompt: 'Other task' }] })
      atomicWriteFileSync(configPath(), JSON.stringify(other))
    })
    const results = await Promise.all([setWebsiteRoutine(root, monthly), setWebsiteRoutine(root, weekly)])
    await otherWrite
    expect(results.every(result => result.ok)).toBe(true)
    expect(schedules()).toHaveLength(2)
    expect(schedules().find((m: { id: string }) => m.id === 'other1')).toBeDefined()
    expect(loadWebsiteManifest(root)?.routine?.cadence).toBe('weekly')
  })

  test('waits for site mutations and merges the latest manifest without accepting client metadata', async () => {
    const siteWrite = withWebsiteLock(root, async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
      const manifest = loadWebsiteManifest(root)!
      saveWebsiteManifest(root, { ...manifest, routine: { cadence: 'manual', lastRunAt: '2026-09-04T10:00:00Z' } })
    })
    const result = await setWebsiteRoutine(root, { ...weekly, lastRunAt: 'forged', automation: { event: 'Other', matcherIndex: 99 } })
    await siteWrite
    expect(result.ok).toBe(true)
    expect(loadWebsiteManifest(root)?.routine?.lastRunAt).toBe('2026-09-04T10:00:00Z')
    expect(loadWebsiteManifest(root)?.routine?.automation).toBeUndefined()
  })

  test('does not claim a cadence if recovery cannot verify the schedule', async () => {
    await setWebsiteRoutine(root, weekly)
    await setWebsiteRoutine(root, monthly, { write(path, data) {
      if (path === websiteManifestPath(root)) throw new Error('manifest unavailable')
      atomicWriteFileSync(path, data)
    } })
    atomicWriteFileSync(configPath(), '{broken')
    await expect(reconcileWebsiteRoutine(root)).rejects.toThrow('recovery needs attention')
    expect((await setWebsiteRoutine(root, monthly)).ok).toBe(false)
  })
})
