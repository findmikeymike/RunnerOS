import { describe, expect, test } from 'bun:test'
import { assertPublicNetworkUrl, type PublicHostResolver } from '../public-network-url'

function resolver(...addresses: string[]): PublicHostResolver {
  return { resolveHost: async () => ({ endpoints: addresses.map((address) => ({ address })) }) }
}

describe('public browser network policy', () => {
  test('allows a public HTTP destination only when every DNS answer is public', async () => {
    await expect(assertPublicNetworkUrl('https://example.com/story', resolver('93.184.216.34', '2606:4700::6810:85e5'))).resolves.toBeUndefined()
    await expect(assertPublicNetworkUrl('https://example.com/story', resolver('93.184.216.34', '127.0.0.1'))).rejects.toThrow('private or reserved')
  })

  test.each([
    'http://localhost/private',
    'http://127.0.0.1/private',
    'http://2130706433/private',
    'http://0177.0.0.1/private',
    'http://169.254.169.254/metadata',
    'http://10.0.0.7/internal',
    'http://[::1]/private',
    'file:///etc/passwd',
    'https://user:password@example.com/private',
  ])('blocks non-public or privileged destination %s', async (url) => {
    await expect(assertPublicNetworkUrl(url, resolver('93.184.216.34'))).rejects.toThrow()
  })

  test('fails closed when DNS has no answer or cannot resolve', async () => {
    await expect(assertPublicNetworkUrl('https://missing.example/', resolver())).rejects.toThrow('resolved safely')
    await expect(assertPublicNetworkUrl('https://missing.example/', {
      resolveHost: async () => { throw new Error('fixture resolver failure') },
    })).rejects.toThrow('resolved safely')
  })
})
