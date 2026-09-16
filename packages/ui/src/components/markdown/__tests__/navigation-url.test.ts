import { expect, test } from 'bun:test'
import { isReadOnlyAppNavigationUrl, normalMarkdownUrl } from '../navigation-url'
import { safeMarkdownUrl } from '../safe-mode'

test('chat permits only passive workspace result routes; strict reports permit none', () => {
  for (const scheme of ['artistos', 'craftagents']) {
    for (const route of ['agents', 'agents/agent/my-worker', 'workflows', 'workflows/my-flow', 'automations', 'automations/automation/abc123']) {
      const url = `${scheme}://workspace/4584f472-9af3-1985-66ff-73b73efc6afa/${route}`
      expect(normalMarkdownUrl(url, 'href')).toBe(url)
      expect(normalMarkdownUrl(url, 'src')).toBe('')
      expect(safeMarkdownUrl(url)).toBeUndefined()
    }
  }
})

test('rejects actions, auth, editing, encoded paths, query instructions and other schemes', () => {
  for (const url of [
    'artistos://action/delete-session/id', 'artistos://auth/callback',
    'artistos://workspace/ws/action/new-chat?message=send',
    'artistos://workspace/ws/workflows/flow/edit',
    'artistos://workspace/ws/agents/agent/worker?send=true',
    'artistos://workspace/ws/automations#secret',
    'artistos://workspace/ws/agents/agent/%2e%2e',
    'artistos://workspace/ws/../action/delete-session/id',
    'artistos://user:password@workspace/ws/automations',
    'custom://workspace/ws/automations', 'javascript:alert(1)', 'data:text/html,evil',
  ]) {
    expect(isReadOnlyAppNavigationUrl(url)).toBe(false)
    expect(normalMarkdownUrl(url, 'href')).toBe('')
  }
  expect(normalMarkdownUrl('https://example.com/report', 'href')).toBe('https://example.com/report')
  expect(normalMarkdownUrl('/tmp/report.md', 'href')).toBe('/tmp/report.md')
})
