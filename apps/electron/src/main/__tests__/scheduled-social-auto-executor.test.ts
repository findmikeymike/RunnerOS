import { describe, expect, test } from 'bun:test'
import type { ScheduledSocialBrowserExecutionInput } from '../scheduled-social-browser-executor'
import {
  executeScheduledSocialAuto,
  ScheduledSocialProviderUnavailableError,
  type ScheduledSocialProviderRoute,
} from '../scheduled-social-auto-executor'

const input = { order: { id: 'work-1' } } as ScheduledSocialBrowserExecutionInput
const result = (receiptId: string) => ({ receiptId, summary: receiptId })

describe('executeScheduledSocialAuto', () => {
  test('uses TryPost first without touching Postiz or browser', async () => {
    const calls: string[] = []
    const routes: ScheduledSocialProviderRoute[] = [
      { provider: 'trypost', prepare: async () => ({ provider: 'trypost', execute: async () => { calls.push('trypost'); return result('trypost:1') } }) },
      { provider: 'postiz', prepare: async () => { calls.push('postiz-probe'); return undefined } },
    ]
    const actual = await executeScheduledSocialAuto(input, { providerRoutes: routes, executeBrowser: async () => { calls.push('browser'); return result('browser:1') } })
    expect(actual.receiptId).toBe('trypost:1')
    expect(calls).toEqual(['trypost'])
  })

  test('falls through unavailable providers to the browser', async () => {
    const calls: string[] = []
    const routes: ScheduledSocialProviderRoute[] = [
      { provider: 'trypost', prepare: async () => { throw new ScheduledSocialProviderUnavailableError('not connected') } },
      { provider: 'postiz', prepare: async () => undefined },
    ]
    const actual = await executeScheduledSocialAuto(input, { providerRoutes: routes, executeBrowser: async () => { calls.push('browser'); return result('browser:1') } })
    expect(actual.receiptId).toBe('browser:1')
    expect(calls).toEqual(['browser'])
  })

  test('never falls back after a selected provider may have started publishing', async () => {
    let browserCalls = 0
    const routes: ScheduledSocialProviderRoute[] = [{
      provider: 'trypost',
      prepare: async () => ({ provider: 'trypost', execute: async () => { throw new ScheduledSocialProviderUnavailableError('publish outcome uncertain') } }),
    }]
    await expect(executeScheduledSocialAuto(input, { providerRoutes: routes, executeBrowser: async () => { browserCalls += 1; return result('browser:1') } })).rejects.toThrow(/uncertain/i)
    expect(browserCalls).toBe(0)
  })
})
