import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Google Gmail connection UI', () => {
  const settings = readFileSync(join(import.meta.dir, '..', 'SecretsSettingsPage.tsx'), 'utf8')
  const source = readFileSync(join(import.meta.dir, '..', '..', 'SourceInfoPage.tsx'), 'utf8')

  it('shows a simple account connection instead of developer OAuth controls', () => {
    expect(settings).toContain("title: 'Gmail'")
    expect(settings).toContain("performOAuth({ sourceSlug: 'gmail'")
    expect(settings).not.toContain("You're connected")
    expect(settings).toContain('Connect Google')
    expect(settings).toContain('Disconnect')
    expect(settings).toContain('text-emerald-300')
    expect(settings).toContain("service.id === 'google-workspace' ? !gmailScope?.hasEffectiveCredential ? (")
    expect(settings).toContain("getSourceCredentialScope(activeWorkspaceId, 'gmail')")
    expect(settings).toContain('gmailConnectionError')
    expect(settings).toContain('onSourcesChanged')
    expect(settings).toContain('Google approved access, but Artist OS could not save the connection.')
    expect(settings).not.toContain('Reconnect Gmail')
    expect(source).toContain('Google account')
    expect(source).toContain('gmail.readonly · gmail.compose')
    expect(source).toContain('Read selected mail; create drafts and send only after approval')
  })

  it('keeps the services page compact and hides the raw secret list by default', () => {
    expect(settings).not.toContain('Keys and services</h1>')
    expect(settings).toContain('Refresh')
    expect(settings).toContain('Saved secrets')
    expect(settings).toContain('aria-expanded={savedSecretsOpen}')
    expect(settings).toContain("savedSecretsOpen ? (")
    expect(settings).toContain('space-y-2 px-6 pb-8 pt-2')
    expect(settings).toContain('className="!border-0 bg-[#111113] shadow-none"')
  })

  it('puts core services in a first, orange Essential group and exposes the Zero weekly limit', () => {
    expect(settings).toContain("const ESSENTIAL_SERVICE_IDS = ['google-workspace', 'zero']")
    expect(settings).toContain("id: 'youtube-research',\n    group: 'Promotion'")
    expect(settings).toContain('Intel can use Zero when this is not connected.')
    expect(settings).toContain("const SECRET_GROUPS = [\n  'Essential'")
    expect(settings).toContain("group === 'Essential' ? 'bg-[#f05a28]/14 text-[#ff9a62]'")
    expect(settings).toContain('Weekly spending limit')
    expect(settings).toContain('configureZeroBudget(activeWorkspaceId, weeklyLimitUsd)')
    expect(settings).toContain('Wallet & setup')
    expect(settings).not.toContain('Zero Installation')
    expect(settings).not.toContain('zero.path')
    expect(settings).not.toContain("id: 'meta-ads'")
    expect(settings).not.toContain("id: 'google-ads'")
  })
})
