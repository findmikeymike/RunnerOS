import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('connection account settings', () => {
  const socialSource = readFileSync(join(import.meta.dir, '..', 'SocialAccountsSettingsPage.tsx'), 'utf8')
  const spotifySource = readFileSync(join(import.meta.dir, '..', 'SpotifySettingsPage.tsx'), 'utf8')
  const adAccountsSource = readFileSync(join(import.meta.dir, '..', 'AdAccountsSettingsPage.tsx'), 'utf8')
  const switcherSource = readFileSync(join(import.meta.dir, '..', 'SettingsPageSwitcher.tsx'), 'utf8')
  const mainContentSource = readFileSync(join(import.meta.dir, '..', '..', '..', 'components', 'app-shell', 'MainContentPanel.tsx'), 'utf8')
  const registrySource = readFileSync(join(import.meta.dir, '..', '..', '..', '..', 'shared', 'settings-registry.ts'), 'utf8')
  const pageRegistrySource = readFileSync(join(import.meta.dir, '..', 'settings-pages.ts'), 'utf8')

  it('keeps social login and verification actions visible for every saved profile state', () => {
    expect(socialSource).toContain("{profile.ready ? 'Open' : 'Connect'}")
    expect(socialSource).toContain('Verify')
    expect(socialSource).not.toContain("const loginNeeded = profile.profileStatus === 'login_needed'")
    expect(socialSource).toContain('bg-white text-black hover:bg-white/90')
    expect(socialSource).toContain('aria-label="Copy agent reference"')
    expect(socialSource).toContain('aria-label="Edit social profile"')
    expect(socialSource).toContain('aria-label="Delete social profile"')
  })

  it('keeps Spotify out of Social Accounts', () => {
    expect(socialSource).not.toContain("{ id: 'spotify', label: 'Spotify' }")
    expect(socialSource).toContain(".filter((profile) => profile.platform !== 'spotify')")
    expect(switcherSource).toContain("{ id: 'spotify', label: 'Spotify' }")
    expect(registrySource).toContain("{ id: 'spotify' as const")
    expect(pageRegistrySource).toContain('spotify: SpotifySettingsPage')
  })

  it('shows all Spotify capabilities under one saved account', () => {
    expect(spotifySource).toContain('function SpotifyCapabilityRow')
    expect(spotifySource).toContain('divide-y divide-white/[0.055]')
    expect(spotifySource).toContain('label="Spotify for Artists"')
    expect(spotifySource).toContain('purpose="Artist analytics"')
    expect(spotifySource).toContain('label="Spotify Web Player"')
    expect(spotifySource).toContain('purpose="Playlist creation"')
    expect(spotifySource).toContain('label="Spotify Ads Manager"')
    expect(spotifySource).toContain('purpose="Paid campaign dashboard"')
    expect(spotifySource).toContain("'Not connected'")
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
    expect(adAccountsSource).toContain('aria-label="Copy ad account reference"')
    expect(adAccountsSource).toContain('aria-label="Delete ad account"')
    expect(adAccountsSource).toContain('Optional details')
    expect(adAccountsSource).toContain('Add ad account')
  })

  it('uses one prominent external page toggle for every multi-page settings area', () => {
    expect(switcherSource).toContain('export function SettingsGroupTabs')
    expect(switcherSource).toContain('if (activeGroup.pages.length <= 1) return null')
    expect(switcherSource).toContain("id: 'workspace'")
    expect(switcherSource).toContain("id: 'app'")
    expect(switcherSource).toContain("id: 'advanced'")
    expect(mainContentSource).toContain('<SettingsGroupTabs activeSubpage={navState.subpage} />')
    expect(switcherSource).not.toContain('border-t border-white/[0.055]')
    expect(switcherSource).toContain('relative z-[100] mt-8 -mb-12 pointer-events-auto')
    expect(switcherSource).toContain('bg-[#e65320]/45 text-white')
    expect(switcherSource).not.toContain('bg-gradient-to-br')
  })

  it('keeps Spotify account utilities accessible without crowding the page', () => {
    expect(spotifySource).toContain('aria-label="Copy account reference"')
    expect(spotifySource).toContain('aria-label="Delete Spotify account"')
    expect(spotifySource).toContain('Add Spotify account')
    expect(spotifySource).not.toContain('Copy Ref')
    expect(spotifySource).not.toContain('lg:grid-cols-3')
  })

  it('keeps the surrounding page and confirmation actions readable', () => {
    expect(spotifySource).toContain('bg-white text-black hover:bg-white/90')
    expect(spotifySource).toContain('dark border-white/10 bg-[#111] text-white sm:max-w-[420px]')
    expect(spotifySource).toContain('bg-red-500 text-white hover:bg-red-400')
  })

  it('does not navigate away from an active login with background verification polling', () => {
    expect(spotifySource).not.toContain('pollVerification')
    expect(spotifySource).toContain('Sign in if needed, then click Verify Account.')
  })
})
