import { describe, expect, test } from 'bun:test'
import { validateAutomationsConfig } from '@craft-agent/shared/automations'
import { AUTOMATION_TEMPLATES } from './templates'

describe('automation templates', () => {
  test('weekly Instagram snapshot is disabled, read-only, and uses Social Publisher', () => {
    const template = AUTOMATION_TEMPLATES.find((item) => item.id === 'scheduled-instagram-growth-snapshot')

    expect(template?.matcher).toMatchObject({
      cron: '20 9 * * 1',
      permissionMode: 'safe',
      enabled: false,
    })
    const actions = template?.matcher.actions as Array<Record<string, unknown>>
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ type: 'prompt', agentSlug: 'social-publisher' })
    expect(String(actions[0]?.prompt)).toContain('first ready Instagram profile')
    expect(String(actions[0]?.prompt)).toContain('artist-instagram-snapshot')
    expect(validateAutomationsConfig({ automations: { SchedulerTick: [template?.matcher] } }).valid).toBe(true)
  })

  test('daily social replies is a disabled exact-agent scheduled template', () => {
    const template = AUTOMATION_TEMPLATES.find((item) => item.id === 'scheduled-social-comment-replies')

    expect(template).toBeDefined()
    expect(template?.category).toBe('scheduled')
    expect(template?.event).toBe('SchedulerTick')
    expect(template?.ownerScope).toBe('artist-hq')
    expect(template?.matcher).toMatchObject({
      templateKey: 'artist-social-comment-replies',
      cron: '* * * * *',
      dailyWindow: { start: '15:00', end: '17:00' },
      permissionMode: 'allow-all',
      enabled: false,
    })
    const actions = template?.matcher.actions as Array<Record<string, unknown>>
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ type: 'prompt', agentSlug: 'social-publisher' })
    expect(String(actions[0]?.prompt)).toContain('every social account pack currently saved in Settings')
    expect(String(actions[0]?.prompt)).toContain('Deduplicate exact profiles')
    expect(String(actions[0]?.prompt)).toContain('Never fall back to a new top-level comment')
    expect(String(actions[0]?.prompt)).toContain('without per-item approval')
    expect(validateAutomationsConfig({
      automations: { SchedulerTick: [template?.matcher] },
    }).valid).toBe(true)
  })
})
