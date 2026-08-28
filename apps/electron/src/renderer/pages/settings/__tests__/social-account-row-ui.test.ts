import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('connection account settings', () => {
  const socialSource = readFileSync(join(import.meta.dir, '..', 'SocialAccountsSettingsPage.tsx'), 'utf8')
  const spotifySource = readFileSync(join(import.meta.dir, '..', 'SpotifySettingsPage.tsx'), 'utf8')
  const adAccountsSource = readFileSync(join(import.meta.dir, '..', 'AdAccountsSettingsPage.tsx'), 'utf8')
  const switcherSource = readFileSync(join(import.meta.dir, '..', 'SettingsPageSwitcher.tsx'), 'utf8')
  const registrySource = readFileSync(join(import.meta.dir, '..', '..', '..', '..', 'shared', 'settings-registry.ts'), 'utf8')
  const pageRegistrySource = readFileSync(join(import.meta.dir, '..', 'settings-pages.ts'), 'utf8')

  it('keeps social login and verification actions visible for every saved profile state', () => {
    expect(socialSource).toContain('`Open ${platformLabel(profile.platform)} Login`')
    expect(socialSource).toContain('Verify Login')
    expect(socialSource).not.toContain("const loginNeeded = profile.profileStatus === 'login_needed'")
    expect(socialSource).toContain('bg-white text-black hover:bg-white/90')
    expect(socialSource).toContain('bg-amber-400/10 text-amber-100')
  })

  it('keeps Spotify out of Social Accounts', () => {
    expect(socialSource).not.toContain("{ id: 'spotify', label: 'Spotify' }")
    expect(socialSource).toContain(".filter((profile) => profile.platform !== 'spotify')")
    expect(socialSource).toContain('Spotify has its own tab under Connections.')
    expect(switcherSource).toContain("{ id: 'spotify', label: 'Spotify' }")
    expect(registrySource).toContain("{ id: 'spotify' as const")
    expect(pageRegistrySource).toContain('spotify: SpotifySettingsPage')
  })

  it('shows all Spotify capabilities under one saved account', () => {
    expect(spotifySource).toContain('label="Spotify for Artists"')
    expect(spotifySource).toContain('purpose="Artist analytics"')
    expect(spotifySource).toContain('label="Spotify Web Player"')
    expect(spotifySource).toContain('purpose="Playlist creation"')
    expect(spotifySource).toContain('label="Spotify Ads Manager"')
    expect(spotifySource).toContain('purpose="Paid campaign dashboard"')
    expect(spotifySource).toContain("'Not checked'")
    expect(spotifySource).toContain("onLogin('artists')")
    expect(spotifySource).toContain("onLogin('web-player')")
    expect(spotifySource).toContain("onLogin('ads-manager')")
  })

  it('registers isolated Meta and Google dashboard accounts as a Connections page', () => {
    expect(switcherSource).toContain("{ id: 'ad-accounts', label: 'Ad Accounts' }")
    expect(registrySource).toContain("{ id: 'ad-accounts' as const")
    expect(pageRegistrySource).toContain("'ad-accounts': AdAccountsSettingsPage")
    expect(adAccountsSource).toContain("'meta-ads': { label: 'Meta Ads Manager'")
    expect(adAccountsSource).toContain("'google-ads': { label: 'Google Ads'")
    expect(adAccountsSource).toContain('openBrowserSidecar(result.browserInstanceId)')
    expect(adAccountsSource).toContain('Verify')
    expect(adAccountsSource).toContain('Copy Ref')
  })

  it('labels and contrasts utility actions instead of showing invisible icons', () => {
    expect(spotifySource).toContain('Copy Ref')
    expect(spotifySource).toContain('text-white/68 hover:bg-white/[0.08] hover:text-white')
    expect(spotifySource).toContain('text-red-200/75 hover:bg-red-400/12 hover:text-red-100')
    expect(spotifySource).toMatch(/<Trash2[\s\S]*?Delete/)
  })

  it('keeps the surrounding page and confirmation actions readable', () => {
    expect(spotifySource).toContain('bg-white text-black hover:bg-white/90 sm:w-auto')
    expect(spotifySource).toContain('dark border-white/10 bg-[#111] text-white sm:max-w-[420px]')
    expect(spotifySource).toContain('bg-red-500 text-white hover:bg-red-400')
  })

  it('does not navigate away from an active login with background verification polling', () => {
    expect(spotifySource).not.toContain('pollVerification')
    expect(spotifySource).toContain('Sign in if needed, then click Verify Account.')
  })
})
