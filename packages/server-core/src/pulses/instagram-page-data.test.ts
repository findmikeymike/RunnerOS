import { describe, expect, test } from 'bun:test'
import { INSTAGRAM_PAGE_DATA_EXPRESSION, parseInstagramInsights, type InstagramPageData } from './instagram-page-data'

const text = `Professional dashboard
Insights
Ad tools
Last 30 days
Account insights
Views
Info
800
Views
Followers
26.5%
Non-followers
73.5%
Viewers
173
By content type
Posts
Stories
Interactions
Info
19
Followers
63.2%
Non-followers
36.8%
Accounts engaged
18
By content interactions
Likes
Profile
Info
286
Profile activity
Profile visits
275
External link taps
11
Followers
Info
10,815
Total followers
Most active times`
const fixture = (): InstagramPageData => ({
  url: 'https://www.instagram.com/accounts/insights/?timeframe=30', text,
  headings: ['Professional dashboard', 'Account insights', 'Views', '800', 'Interactions', '19', 'Profile', '286', 'Followers', '10,815'].map(text => ({ level: 2, text })),
  anchors: [{ href: 'https://www.instagram.com/findmikeymike/', imageAlt: "findmikeymike's profile picture", text: 'Profile' }],
})

describe('Instagram rendered insights extraction', () => {
  test('reads live account metric cards and preserves the meaning of Viewers', () => {
    expect(parseInstagramInsights(fixture(), 'findmikeymike')).toEqual({ windowDays: 30, metrics: { followers: 10815, views: 800, interactions: 19, accountsEngaged: 18, profileVisits: 275 } })
    expect(parseInstagramInsights(fixture(), '@FindMikeyMike')?.metrics.accountsReached).toBeUndefined()
    expect(parseInstagramInsights(fixture(), 'findmikeymike')?.metrics.followerDelta).toBeUndefined()
  })
  test('body-only section labels work without mistaking percentages for counts', () => {
    const data = { ...fixture(), headings: undefined }
    expect(parseInstagramInsights(data, 'findmikeymike')?.metrics.followers).toBe(10815)
    expect(parseInstagramInsights(data, 'findmikeymike')?.metrics.views).toBe(800)
    expect(parseInstagramInsights(data, 'findmikeymike')?.metrics.interactions).toBe(19)
  })
  test('requires the expected visible own-profile picture identity and exact insights surface', () => {
    const data = fixture()
    expect(parseInstagramInsights(data, 'anotheruser')).toBeNull()
    expect(parseInstagramInsights({ ...data, anchors: [] }, 'findmikeymike')).toBeNull()
    expect(parseInstagramInsights({ ...data, anchors: [{ href: '/findmikeymike/', text: 'findmikeymike' }] }, 'findmikeymike')).toBeNull()
    for (const url of ['https://www.instagram.com/findmikeymike/', 'http://www.instagram.com/accounts/insights/', 'https://instagram.com.evil.test/accounts/insights/']) {
      expect(parseInstagramInsights({ ...data, url }, 'findmikeymike')).toBeNull()
    }
  })
  test('does not infer the reporting window from URL or accept conflicting visible windows', () => {
    expect(parseInstagramInsights({ ...fixture(), text: text.replace('Last 30 days', '') }, 'findmikeymike')).toBeNull()
    expect(parseInstagramInsights({ ...fixture(), text: text + '\nLast 7 days' }, 'findmikeymike')).toBeNull()
  })
  test('captures reach and signed follower movement only when explicitly labeled', () => {
    const data = { ...fixture(), text: text + '\nAccounts reached 172\nOverall growth\n-25' }
    expect(parseInstagramInsights(data, 'findmikeymike')?.metrics).toMatchObject({ accountsReached: 172, followerDelta: -25 })
    expect(parseInstagramInsights({ ...fixture(), text: text + '\nNet follows\n+10' }, 'findmikeymike')?.metrics.followerDelta).toBe(10)
  })
  test('refuses rounded metric cards and inconsistent heading/body values', () => {
    const data = fixture()
    expect(parseInstagramInsights({ ...data, headings: data.headings!.map(heading => heading.text === '10,815' ? { ...heading, text: '10.8K' } : heading), text: text.replace('10,815', '10.8K') }, 'findmikeymike')).toBeNull()
    expect(parseInstagramInsights({ ...data, text: text.replace('\n800\n', '\n801\n') }, 'findmikeymike')).toBeNull()
    expect(parseInstagramInsights({ ...data, headings: undefined, text: text.replace('\n800\n', '\n26.5%\n') }, 'findmikeymike')).toBeNull()
  })
  test('keeps exact zero card values while ignoring zero-percent demographic placeholders', () => {
    const data = fixture()
    data.text = data.text.replace('\n800\n', '\n0\n').replace('\n19\n', '\n0\n').replace('26.5%', '0%')
    data.headings = data.headings!.map(heading => ['800', '19'].includes(heading.text) ? { ...heading, text: '0' } : heading)
    expect(parseInstagramInsights(data, 'findmikeymike')?.metrics).toMatchObject({ followers: 10815, views: 0, interactions: 0 })
  })
  test('DOM expression extracts rendered headings and profile-image link identity', () => {
    const visible = { getClientRects: () => [{}], getAttribute: (_name: string) => null }
    const image = { ...visible, alt: "findmikeymike's profile picture" }
    const anchor = { ...visible, innerText: 'Profile', href: 'https://www.instagram.com/findmikeymike/', querySelectorAll: () => [image] }
    const headings = fixture().headings!.map(heading => ({ ...visible, innerText: heading.text, tagName: 'H2' }))
    const document = { body: { innerText: text }, querySelectorAll: (selector: string) => selector.startsWith('h1') ? headings : [anchor] }
    const evaluate = new Function('document', 'location', 'getComputedStyle', `return ${INSTAGRAM_PAGE_DATA_EXPRESSION}`)
    const data = evaluate(document, { href: fixture().url }, () => ({ display: 'block', visibility: 'visible' })) as InstagramPageData
    expect(data.anchors?.[0]?.imageAlt).toBe("findmikeymike's profile picture")
    expect(parseInstagramInsights(data, 'findmikeymike')?.metrics.views).toBe(800)
  })
})
