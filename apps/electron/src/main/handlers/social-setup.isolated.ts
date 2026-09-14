import { afterAll, describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'social-setup-host-'))
process.env.CRAFT_PRODUCT_VARIANT = 'artist-os'
process.env.CRAFT_CONFIG_DIR = directory
const profiles: any[] = []
let live = false
let activeSurface = 'artists'
const cli = mock(async (args: string[]) => {
  const profile = args[args.indexOf('--profile') + 1]
  const platform = args[2]
  if (args[0] === 'doctor') return { platforms: [{ platform: 'spotify', profiles: profiles.map(row => ({ ...row, ready: false, liveChecked: false, lastCheckedAt: null })) }] }
  if (args[1] === 'add') {
    const row = { platform, profile, accountHandle: null, accountUrl: null, adsAccountId: null, sessionPath: path.join(directory, profile), localSessionExists: true }
    profiles.push(row); return { ...row }
  }
  const row = profiles.find(item => item.platform === platform && item.profile === profile)
  if (args[1] === 'update' && args.includes('--account-url')) row.accountUrl = args[args.indexOf('--account-url') + 1]
  if (args[1] === 'login') return { ...row }
  if (args[1] === 'status') return { ...row, liveChecked: args.includes('--live') && live, lastCheckedAt: args.includes('--live') && live ? new Date().toISOString() : null, ready: live, loggedIn: live, evidence: { secret: 'private-page' }, live: { cookie: 'private-cookie' } }
  return { ...row }
})
mock.module('../social-cli', () => ({ runSocialJson: cli }))
const { registerSettingsGuiHandlers } = await import('./settings')
const { RPC_CHANNELS } = await import('@craft-agent/shared/protocol')
const { setupSocialAccountSchema, validatedSetupSocialAccountSchema } = await import('@craft-agent/session-tools-core')
let adapter: (input: any, workspaceId: string, sessionId: string) => Promise<any>
const handlers = new Map<string, any>()
const focus = mock(() => {})
const navigate = mock(async () => {})
const server = { handle: (channel: string, fn: any) => handlers.set(channel, fn), push() {}, async invokeClient() {} }
function register() {
  registerSettingsGuiHandlers(server as any, {
    sessionManager: { setSocialAccountSetupHandler(fn: typeof adapter) { adapter = fn } },
    platform: { logger: { warn() {} } },
    browserPaneManager: { createInstance: (id: string) => id, getInstance: () => ({ currentUrl: 'https://artists.spotify.com/c/artist/1234567890123456789012/home' }), focus, navigate,
      evaluate: async () => activeSurface === 'web-player' ? ({ url: 'https://open.spotify.com/collection/tracks', title: 'Spotify', text: 'Your Library Create playlist', links: ['https://open.spotify.com/user/artistmain'] }) : ({ url: 'https://artists.spotify.com/c/artist/1234567890123456789012/home', title: 'Artist dashboard', text: 'Audience Music Songs private-page', links: [] }) },
  } as any)
}
register()
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }))
describe('dedicated social setup adapter', () => {
  test('rejects credentials, malformed references and ambiguous Spotify checks', () => {
    expect(setupSocialAccountSchema.safeParse({ action: 'add', platform: 'spotify', profile: 'bad profile' }).success).toBe(false)
    expect(setupSocialAccountSchema.safeParse({ action: 'open', password: 'secret' }).success).toBe(false)
    expect(validatedSetupSocialAccountSchema.safeParse({ action: 'verify', platform: 'spotify', profile: 'main' }).success).toBe(false)
  })
  test('concurrent duplicate additions produce one shared Settings account', async () => {
    const results = await Promise.allSettled([adapter({ action: 'add', platform: 'spotify', profile: 'main' }, 'w', 's'), adapter({ action: 'add', platform: 'spotify', profile: 'MAIN' }, 'w', 's')])
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    expect(profiles).toHaveLength(1)
  })
  test('open focuses the saved browser and does not claim verified', async () => {
    const result = await adapter({ action: 'open', platform: 'spotify', profile: 'main', spotifySurface: 'artists' }, 'w', 's')
    expect(result.opened).toBe(true); expect(result.ready).toBeUndefined(); expect(focus).toHaveBeenCalledWith('social-spotify-main')
  })
  test('provider command errors cannot expose browser evidence to the agent', async () => {
    cli.mockImplementationOnce(async () => { throw new Error('timeout --verification-json private-cookie private-page') })
    let message = ''
    try { await adapter({ action: 'list' }, 'w', 's') } catch (error) { message = String(error) }
    expect(message).not.toContain('private-cookie'); expect(message).not.toContain('private-page'); expect(message).toContain('could not complete')
  })
  test('agent verification survives host recreation and Settings reads the same observation', async () => {
    live = true; navigate.mockClear()
    const checked = await adapter({ action: 'verify', platform: 'spotify', profile: 'main', spotifySurface: 'artists' }, 'w', 's')
    expect(checked.verification.ready).toBe(true)
    expect(checked.checkedSurface).toBe('artists'); expect(checked.ready).toBeUndefined()
    expect(checked.savedCapabilities.webPlayer.historical).toBe(true)
    expect(JSON.stringify(checked)).not.toContain('private-page'); expect(JSON.stringify(checked)).not.toContain('private-cookie')
    expect(navigate).not.toHaveBeenCalled()
    activeSurface = 'web-player'
    await adapter({ action: 'verify', platform: 'spotify', profile: 'main', spotifySurface: 'web-player' }, 'w', 's')
    activeSurface = 'artists'
    const rechecked = await adapter({ action: 'verify', platform: 'spotify', profile: 'main', spotifySurface: 'artists' }, 'w', 's')
    expect(rechecked.savedCapabilities.webPlayer.ready).toBe(true)
    expect(rechecked.savedCapabilities.webPlayer.historical).toBe(true)
    expect(rechecked.checkedSurface).toBe('artists')
    expect(rechecked.ready).toBeUndefined()
    expect(rechecked.verification.label).not.toBe('Spotify Web Player')
    register()
    const settings = await handlers.get(RPC_CHANNELS.settings.SOCIAL_ACCOUNTS_LIST)({ clientId: 'test' })
    expect(settings.platforms[0].profiles[0].spotifyCapabilities.artists.ready).toBe(true)
    expect(settings.platforms[0].profiles[0].liveChecked).toBe(false)
    expect(settings.platforms[0].profiles[0].savedVerification).toBe(true)
  })
})
