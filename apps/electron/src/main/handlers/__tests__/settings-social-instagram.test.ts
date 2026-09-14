import { describe, expect, it } from 'bun:test'
import { assessInstagramBrowserIdentity } from '../social-account-browser'

const home = {
  url: 'https://www.instagram.com/',
  controls: [
    { href: 'https://www.instagram.com/direct/inbox/', label: 'Messages', inContent: false },
    { href: 'https://www.instagram.com/findmikeymike/', label: "findmikeymike's profile picture", inContent: false },
  ],
}

describe('Instagram browser identity', () => {
  it('recognizes icon-only navigation and returns the actual signed-in account', () => {
    expect(assessInstagramBrowserIdentity(home)).toEqual({
      loggedIn: true, handle: '@findmikeymike', accountUrl: 'https://www.instagram.com/findmikeymike/',
    })
  })
  it('does not mistake a feed author for the signed-in account', () => {
    const result = assessInstagramBrowserIdentity({ ...home, controls: [
      home.controls[0]!,
      { href: 'https://www.instagram.com/anotherartist/', label: 'Profile', inContent: false },
      { href: 'https://www.instagram.com/findmikeymike/', label: "findmikeymike's profile picture", inContent: true },
    ] })
    expect(result.handle).toBe('@anotherartist')
  })
  it('does not verify a public profile or feed alone', () => {
    expect(assessInstagramBrowserIdentity({ ...home, controls: [home.controls[1]!] }).loggedIn).toBe(false)
    expect(assessInstagramBrowserIdentity({ ...home, controls: [home.controls[0]!, { ...home.controls[1]!, inContent: true }] }).loggedIn).toBe(false)
  })
  it('rejects login forms, challenges, and other domains', () => {
    for (const page of [
      { ...home, loginForm: true },
      { ...home, url: 'https://www.instagram.com/accounts/login/' },
      { ...home, url: 'https://www.instagram.com/challenge/' },
      { ...home, url: 'https://example.com/' },
    ]) expect(assessInstagramBrowserIdentity(page).loggedIn).toBe(false)
  })
})
