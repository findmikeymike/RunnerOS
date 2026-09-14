import { describe, expect, test } from 'bun:test'
import { runInNewContext } from 'node:vm'
import { TIKTOK_BROWSER_IDENTITY_SCRIPT, assessTikTokBrowserIdentity } from '../social-account-browser'
const page = {
  url: 'https://www.tiktok.com/@mikeymike7104',
  controls: [
    { href: '', label: 'Messages' },
    { href: 'https://www.tiktok.com/@mikeymike7104', label: 'Profile' },
    { href: 'https://www.tiktok.com/@earthtomikey', label: 'earthtomikey' },
  ],
}
describe('TikTok signed-in posting identity', () => {
  test('reads the actual profile navigation identity, not the expected account in content', () => {
    expect(assessTikTokBrowserIdentity(page)).toEqual({ loggedIn: true, handle: '@mikeymike7104', accountUrl: 'https://www.tiktok.com/@mikeymike7104' })
  })
  test('rejects a public profile visit, login form, or unrelated domain', () => {
    expect(assessTikTokBrowserIdentity({ ...page, controls: [page.controls[2]!] }).loggedIn).toBe(false)
    expect(assessTikTokBrowserIdentity({ ...page, loginForm: true }).loggedIn).toBe(false)
    expect(assessTikTokBrowserIdentity({ ...page, url: 'https://example.com' }).loggedIn).toBe(false)
  })
})


test('extracts compact TikTok controls without duplicating accessible labels', () => {
  const control = (href: string, text: string, aria: string | null, childAria: string | null) => ({
    href, innerText: text,
    getAttribute: () => aria,
    querySelector: () => childAria ? { getAttribute: () => childAria } : null,
    querySelectorAll: () => childAria ? [{ getAttribute: () => childAria }] : [],
    getClientRects: () => [1],
  })
  for (const visibleText of ['', 'Profile']) {
    const controls = [
      control('https://www.tiktok.com/@earthtomikey', visibleText, null, 'Profile'),
      control('', '1 Messages', 'Messages', null),
    ]
    const extracted = runInNewContext(TIKTOK_BROWSER_IDENTITY_SCRIPT, {
      document: { querySelectorAll: () => controls, querySelector: () => null },
      location: { href: 'https://www.tiktok.com/' },
    })
    expect(assessTikTokBrowserIdentity(extracted).handle).toBe('@earthtomikey')
    expect(assessTikTokBrowserIdentity(extracted).loggedIn).toBe(true)
  }
})
