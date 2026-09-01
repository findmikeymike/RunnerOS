import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Google Gmail connection UI', () => {
  const settings = readFileSync(join(import.meta.dir, '..', 'SecretsSettingsPage.tsx'), 'utf8')
  const source = readFileSync(join(import.meta.dir, '..', '..', 'SourceInfoPage.tsx'), 'utf8')

  it('shows a simple account connection instead of developer OAuth controls', () => {
    expect(settings).toContain("title: 'Google'")
    expect(settings).toContain("performOAuth({ sourceSlug: 'gmail'")
    expect(settings).toContain("You're connected")
    expect(settings).toContain('Connect Google')
    expect(settings).toContain('Disconnect')
    expect(settings).toContain("service.id === 'google-workspace' ? (")
    expect(settings).toContain("getSourceCredentialScope(activeWorkspaceId, 'gmail')")
    expect(settings).toContain('gmailConnectionError')
    expect(settings).toContain('onSourcesChanged')
    expect(settings).toContain('Google approved access, but Artist OS could not save the connection.')
    expect(settings).not.toContain('Reconnect Gmail')
    expect(source).toContain('Google account')
    expect(source).toContain('gmail.readonly · gmail.compose')
    expect(source).toContain('Read selected mail; create drafts and send only after approval')
  })
})
