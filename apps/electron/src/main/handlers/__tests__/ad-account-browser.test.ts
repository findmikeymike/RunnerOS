import { describe, expect, it } from 'bun:test'
import { assessAdDashboardIdentity, inspectAdDashboard, normalizeAdAccountId } from '../ad-account-browser'

describe('ad account browser inspection', () => {
  it('recognizes a logged-in Meta Ads Manager account and discovers its id', () => {
    const result = inspectAdDashboard('meta-ads', {
      url: 'https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=123456789',
      title: 'Campaigns',
      text: 'Campaigns Ad sets Ads',
    })
    expect(result.loggedIn).toBe(true)
    expect(result.accountId).toBe('123456789')
  })

  it('does not mistake the Meta login page for an active account', () => {
    const result = inspectAdDashboard('meta-ads', {
      url: 'https://business.facebook.com/adsmanager',
      title: 'Log in to Facebook',
      text: 'Log in to Facebook Forgotten password?',
    })
    expect(result.loggedIn).toBe(false)
  })

  it('recognizes Google Ads and normalizes the customer id', () => {
    const result = inspectAdDashboard('google-ads', {
      url: 'https://ads.google.com/aw/overview?customerId=1234567890',
      title: 'Overview',
      text: 'Customer ID: 123-456-7890',
    })
    expect(result.loggedIn).toBe(true)
    expect(result.accountId).toBe('1234567890')
  })

  it('does not treat the Google account chooser as verified', () => {
    const result = inspectAdDashboard('google-ads', {
      url: 'https://ads.google.com/aw',
      title: 'Choose an account',
      text: 'Choose an account to continue to Google Ads',
    })
    expect(result.loggedIn).toBe(false)
  })

  it('normalizes account ids defensively', () => {
    expect(normalizeAdAccountId('act_123-456')).toBe('123456')
    expect(normalizeAdAccountId(null)).toBeNull()
  })

  it('fails closed on a different observed account', () => {
    expect(assessAdDashboardIdentity('123456', { loggedIn: true, accountId: '999999' })).toEqual({
      expectedId: '123456',
      observedId: '999999',
      matchesExpected: false,
      ready: false,
      status: 'wrong_account',
    })
  })

  it('requires observable identity and accepts first-time discovery', () => {
    expect(assessAdDashboardIdentity(null, { loggedIn: true, accountId: null }).status).toBe('identity_unverified')
    expect(assessAdDashboardIdentity(null, { loggedIn: true, accountId: '123456' })).toMatchObject({
      ready: true,
      status: 'ready',
      observedId: '123456',
    })
  })
})
