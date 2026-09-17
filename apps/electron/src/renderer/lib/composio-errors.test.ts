import { describe, expect, it } from 'bun:test'
import { composioErrorMessage } from './composio-errors'

describe('Composio connection errors', () => {
  it('identifies an older running host without blaming the API key', () => {
    for (const action of ['save', 'refresh', 'connect']) {
      const result = composioErrorMessage(new Error('No handler for: composio:saveKey'), action)
      expect(result).toContain('Restart Artist OS')
      expect(result).not.toContain('Check that it belongs')
    }
    expect(composioErrorMessage(new TypeError('window.electronAPI.composioSaveKey is not a function'), 'save')).toContain('Restart Artist OS')
  })
  it('distinguishes provider rejection from connectivity failures', () => {
    expect(composioErrorMessage(new Error('The Composio API key is invalid or revoked. Replace it in Settings.'), 'save')).toContain('invalid or revoked')
    expect(composioErrorMessage(new Error('Could not reach Composio. Check your connection and try again.'), 'save')).toContain('Could not reach Composio')
    expect(composioErrorMessage(new Error('Composio denied access. Check project key permissions and the Google account grant.'), 'save')).toContain('permissions')
  })
  it('never forwards unknown exception details or implies the key is invalid', () => {
    const result = composioErrorMessage(new Error('request failed x-api-key: secret-test-value'), 'save')
    expect(result).not.toContain('secret-test-value')
    expect(result).not.toContain('Check that it belongs')
  })
})
