import type { AutomationListItem } from '@/components/automations/types'
import type { PulseExecutionTarget } from './pulse-execution'

export const WEEKLY_MANAGER_CHECK_IN_NAME = 'Weekly Artist Manager Check-In'
export const WEEKLY_MANAGER_CHECK_IN_CRON = '20 10 * * 1'

export function createWeeklyManagerCheckInPrompt(): string {
  return `Start the artist's weekly manager check-in.

Your first action must be a get_manager_brief tool call. Do not answer from the launch-context copy unless that tool call explicitly returns unavailable. Treat source freshness honestly: never turn totals into growth without comparable snapshots, never describe stale analytics as current, and never invent campaign dates or missing metrics.

Open the conversation with one compact manager packet:
- the single most important focus for this week and why now;
- meaningful Spotify, Instagram, or Intel movement only when supported by fresh evidence;
- the current or next campaign's timing, readiness, and clearest gap;
- the smallest useful next action.

End with one specific question that helps the artist make the next decision. Do not dump the brief, delegate work, publish, send, spend, or change accounts in this opening check-in.`
}

export function createWeeklyManagerCheckInMatcher(
  executionTarget: PulseExecutionTarget = {},
): Record<string, unknown> {
  return {
    name: WEEKLY_MANAGER_CHECK_IN_NAME,
    cron: WEEKLY_MANAGER_CHECK_IN_CRON,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    permissionMode: 'safe',
    labels: ['manager', 'artist-hq', 'weekly'],
    actions: [{
      type: 'prompt',
      agentSlug: 'concierge',
      prompt: createWeeklyManagerCheckInPrompt(),
      ...executionTarget,
    }],
  }
}

export function isWeeklyManagerCheckInAutomation(automation: AutomationListItem): boolean {
  if (automation.event !== 'SchedulerTick') return false
  if (automation.name === WEEKLY_MANAGER_CHECK_IN_NAME) return true
  return automation.actions.some((action) => (
    action.type === 'prompt'
    && action.agentSlug === 'concierge'
    && /weekly manager check-in|weekly artist manager/i.test(action.prompt)
  ))
}
