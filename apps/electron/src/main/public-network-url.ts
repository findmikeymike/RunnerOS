import { BlockList, isIP } from 'node:net'

export interface PublicHostResolver {
  resolveHost(host: string, options: { cacheUsage: 'disallowed' }): Promise<{
    endpoints: Array<{ address: string; family?: string | number }>
  }>
}

const DNS_TIMEOUT_MS = 5_000

const NON_PUBLIC_IPV4 = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) NON_PUBLIC_IPV4.addSubnet(network, prefix, 'ipv4')
const NON_PUBLIC_IPV6 = new BlockList()
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['100::', 64], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const) NON_PUBLIC_IPV6.addSubnet(network, prefix, 'ipv6')

function assertPublicIp(address: string): void {
  const family = isIP(address)
  const blocked = family === 4
    ? NON_PUBLIC_IPV4.check(address, 'ipv4')
    : family === 6 && NON_PUBLIC_IPV6.check(address, 'ipv6')
  if (family === 0 || blocked) {
    throw new Error('Destination resolves to a private or reserved network address.')
  }
}

/** Validate one browser request immediately before Electron dispatches it. */
export async function assertPublicNetworkUrl(rawUrl: string, resolver: PublicHostResolver): Promise<void> {
  let url: URL
  try { url = new URL(rawUrl) } catch { throw new Error('Destination URL is invalid.') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only public HTTP and HTTPS destinations are allowed.')
  if (url.username || url.password) throw new Error('Destination URLs cannot contain credentials.')
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new Error('Destination must be on the public internet.')
  }
  if (isIP(host)) {
    assertPublicIp(host)
    return
  }
  let endpoints: Array<{ address: string }>
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const resolved = await Promise.race([
      resolver.resolveHost(host, { cacheUsage: 'disallowed' }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('DNS resolution timed out.')), DNS_TIMEOUT_MS)
      }),
    ])
    endpoints = resolved.endpoints
  } catch {
    throw new Error('Destination hostname could not be resolved safely.')
  } finally {
    if (timeout) clearTimeout(timeout)
  }
  if (!Array.isArray(endpoints) || endpoints.length === 0) throw new Error('Destination hostname could not be resolved safely.')
  for (const endpoint of endpoints) assertPublicIp(endpoint.address)
}
