import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isValidSettingsSubpage } from '../../../../shared/settings-registry'

describe('About settings', () => {
  const pageSource = readFileSync(join(import.meta.dir, '..', 'AboutSettingsPage.tsx'), 'utf8')
  const switcherSource = readFileSync(join(import.meta.dir, '..', 'SettingsPageSwitcher.tsx'), 'utf8')

  it('registers About as the sixth App settings tab', () => {
    expect(isValidSettingsSubpage('about')).toBe(true)
    expect(switcherSource).toContain("{ id: 'about', label: 'About' }")
  })

  it('identifies Artist OS as a Magic Co product with public legal links', () => {
    expect(pageSource).toContain('A Magic Co product')
    expect(pageSource).toContain('https://itsthemagic.io')
    expect(pageSource).toContain('https://itsthemagic.io/privacy')
    expect(pageSource).toContain('https://itsthemagic.io/terms')
  })
})
