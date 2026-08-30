import { describe, expect, test } from 'bun:test'
import type { AutomationListItem } from '@/components/automations/types'
import {
  createWeeklyManagerCheckInMatcher,
  createWeeklyManagerCheckInPrompt,
  isWeeklyManagerCheckInAutomation,
  WEEKLY_MANAGER_CHECK_IN_CRON,
} from './weekly-manager-check-in'

describe('weekly manager check-in', () => {
  test('runs after the Monday pulse sequence with the reliable execution target', () => {
    const matcher = createWeeklyManagerCheckInMatcher({
      llmConnection: 'paid',
      model: 'pi/deepseek-v4-pro',
    })

    expect(matcher.cron).toBe(WEEKLY_MANAGER_CHECK_IN_CRON)
    expect(matcher.permissionMode).toBe('safe')
    expect(matcher.actions).toEqual([expect.objectContaining({
      type: 'prompt',
      agentSlug: 'concierge',
      llmConnection: 'paid',
      model: 'pi/deepseek-v4-pro',
    })])
  })

  test('requires live truth, a compact opening packet, and no consequential action', () => {
    const prompt = createWeeklyManagerCheckInPrompt()
    expect(prompt).toContain('first action must be a get_manager_brief tool call')
    expect(prompt).toContain('get_manager_brief')
    expect(prompt).toContain('single most important focus')
    expect(prompt).toContain('one specific question')
    expect(prompt).toContain('Do not dump the brief')
    expect(prompt).toContain('publish, send, spend')
  })

  test('recognizes the canonical automation and rejects unrelated concierge schedules', () => {
    const canonical = automation('Weekly Artist Manager Check-In', createWeeklyManagerCheckInPrompt())
    const legacy = automation('Monday review', 'Start the weekly manager check-in for this artist.')
    const unrelated = automation('Daily hello', 'Say hello.')

    expect(isWeeklyManagerCheckInAutomation(canonical)).toBe(true)
    expect(isWeeklyManagerCheckInAutomation(legacy)).toBe(true)
    expect(isWeeklyManagerCheckInAutomation(unrelated)).toBe(false)
  })
})

function automation(name: string, prompt: string): AutomationListItem {
  return {
    id: 'manager-check-in',
    event: 'SchedulerTick',
    matcherIndex: 0,
    name,
    summary: '',
    enabled: true,
    actions: [{ type: 'prompt', agentSlug: 'concierge', prompt }],
  }
}
