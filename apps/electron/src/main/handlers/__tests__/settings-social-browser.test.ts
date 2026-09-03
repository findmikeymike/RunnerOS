import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { RPC_CHANNELS } from '../../../shared/types'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

type HandlerFn = (ctx: { clientId: string; webContentsId?: number }, ...args: any[]) => Promise<any> | any

let savedAccountUrl: string | null = null
let savedAdsAccountId: string | null = null

const runSocialJsonMock = mock(async (args: string[]) => {
  if (args[0] === 'profile' && args[1] === 'login') {
    return { ok: true, sessionPath: '/tmp/social-session' }
  }
  if (args.includes('--verification-json')) {
    return { id: 'spotify/artist-main', ready: true, loggedIn: true }
  }
  if (args[0] === 'profile' && args[1] === 'update') {
    if (args.includes('--account-url')) savedAccountUrl = String(args[args.indexOf('--account-url') + 1] || '')
    if (args.includes('--ads-account-id')) savedAdsAccountId = String(args[args.indexOf('--ads-account-id') + 1] || '')
    return { id: 'spotify/artist-main', accountUrl: savedAccountUrl, adsAccountId: savedAdsAccountId }
  }
  return { id: 'spotify/artist-main', accountHandle: null, accountUrl: savedAccountUrl, adsAccountId: savedAdsAccountId }
})

mock.module('../../social-cli', () => ({ runSocialJson: runSocialJsonMock }))

describe('social account browser presentation', () => {
  const handlers = new Map<string, HandlerFn>()
  const instances = new Map<string, any>()
  const createInstance = mock((id: string, options: unknown) => {
    instances.set(id, { id, currentUrl: 'https://artists.spotify.com/c/artist/home' })
    return id
  })
  const navigate = mock(async (..._args: any[]) => ({ url: 'https://artists.spotify.com/', title: 'Spotify for Artists' }))
  const focus = mock(() => {})
  let currentUrl = 'https://artists.spotify.com/c/artist/home'
  const evaluate = mock(async () => currentUrl.includes('open.spotify.com')
    ? {
        url: 'https://open.spotify.com/collection/playlists',
        title: 'Spotify',
        text: 'Your Library Create playlist',
        links: ['https://open.spotify.com/user/31artistmain'],
      }
    : currentUrl.includes('adsmanager.spotify.com')
      ? {
          url: 'https://adsmanager.spotify.com/campaigns',
          title: 'Spotify Ads Manager',
          text: 'Campaigns Create campaign Reporting',
          links: ['https://adsmanager.spotify.com/advertisers/spotify-ads-main/campaigns'],
        }
    : {
        url: 'https://artists.spotify.com/c/artist/home',
        title: 'Spotify for Artists',
        text: 'Audience Music Songs',
        links: [],
      })

  beforeEach(async () => {
    handlers.clear()
    instances.clear()
    runSocialJsonMock.mockClear()
    createInstance.mockClear()
    navigate.mockClear()
    focus.mockClear()
    evaluate.mockClear()
    currentUrl = 'https://artists.spotify.com/c/artist/home'
    savedAccountUrl = null
    savedAdsAccountId = null
    navigate.mockImplementation(async (_id: string, url: string) => {
      currentUrl = url
      const instance = instances.get('social-spotify-artist-main')
      if (instance) instance.currentUrl = url
      return { url, title: url.includes('open.spotify.com') ? 'Spotify' : 'Spotify for Artists' }
    })

    const server: RpcServer = {
      handle(channel, handler) {
        handlers.set(channel, handler as HandlerFn)
      },
      push() {},
      async invokeClient() {
        return null
      },
    }
    const deps = {
      sessionManager: {},
      platform: {
        logger: { info() {}, warn() {}, error() {}, debug() {} },
      },
      browserPaneManager: {
        createInstance,
        navigate,
        focus,
        evaluate,
        getInstance: (id: string) => instances.get(id),
      },
    } as unknown as HandlerDeps

    const { registerSettingsGuiHandlers } = await import('../settings')
    registerSettingsGuiHandlers(server, deps)
  })

  it('returns the login browser immediately while navigation continues', async () => {
    let releaseNavigation!: () => void
    navigate.mockImplementationOnce(() => new Promise((resolve) => {
      releaseNavigation = () => resolve({ url: 'https://artists.spotify.com/', title: 'Spotify for Artists' })
    }))
    const login = handlers.get(RPC_CHANNELS.settings.SOCIAL_ACCOUNTS_LOGIN)

    const result = await login!({ clientId: 'client-1' }, { platform: 'spotify', profile: 'artist-main' })

    expect(result.browserInstanceId).toBe('social-spotify-artist-main')
    expect(createInstance).toHaveBeenCalledWith('social-spotify-artist-main', {
      show: false,
      partition: 'persist:social-spotify-artist-main',
    })
    expect(navigate).toHaveBeenCalledTimes(1)
    releaseNavigation()
  })

  it('opens Web Player in the same saved Spotify profile when that capability is missing', async () => {
    const login = handlers.get(RPC_CHANNELS.settings.SOCIAL_ACCOUNTS_LOGIN)

    const result = await login!(
      { clientId: 'client-1' },
      { platform: 'spotify', profile: 'artist-main', spotifySurface: 'web-player' },
    )

    expect(result).toMatchObject({
      browserInstanceId: 'social-spotify-artist-main',
      browserPartition: 'persist:social-spotify-artist-main',
      spotifySurface: 'web-player',
    })
    expect(navigate).toHaveBeenCalledWith(
      'social-spotify-artist-main',
      'https://open.spotify.com/collection/playlists',
    )
  })

  it('verifies in a hidden sidecar-ready browser without focusing a standalone window', async () => {
    const verify = handlers.get(RPC_CHANNELS.settings.SOCIAL_ACCOUNTS_STATUS)

    const result = await verify!(
      { clientId: 'client-1' },
      { platform: 'spotify', profile: 'artist-main', live: true },
    )

    expect(createInstance).toHaveBeenCalledWith('social-spotify-artist-main', {
      show: false,
      partition: 'persist:social-spotify-artist-main',
    })
    expect(focus).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      ready: true,
      browserInstanceId: 'social-spotify-artist-main',
      spotifyCapabilities: {
        artists: { ready: true, status: 'ready' },
        webPlayer: {
          ready: true,
          status: 'ready',
          accountUrl: 'https://open.spotify.com/user/31artistmain',
        },
        adsManager: { ready: true, status: 'ready', accountId: 'spotify-ads-main' },
      },
    })
    expect(navigate).toHaveBeenCalledWith('social-spotify-artist-main', 'https://artists.spotify.com/')
    expect(navigate).toHaveBeenCalledWith('social-spotify-artist-main', 'https://open.spotify.com/collection/playlists')
    expect(navigate).toHaveBeenCalledWith('social-spotify-artist-main', 'https://adsmanager.spotify.com/campaigns')
    expect(runSocialJsonMock).toHaveBeenCalledWith(expect.arrayContaining([
      'profile', 'update', 'spotify', '--profile', 'artist-main', '--account-url',
      'https://open.spotify.com/user/31artistmain',
    ]))
    expect(runSocialJsonMock).toHaveBeenCalledWith(expect.arrayContaining([
      'profile', 'update', 'spotify', '--profile', 'artist-main', '--ads-account-id',
      'spotify-ads-main',
    ]))
  })

  it('fails the Ads Manager capability when it opens a different saved ad account', async () => {
    savedAdsAccountId = 'expected-ads-account'
    const verify = handlers.get(RPC_CHANNELS.settings.SOCIAL_ACCOUNTS_STATUS)

    const result = await verify!(
      { clientId: 'client-1' },
      { platform: 'spotify', profile: 'artist-main', live: true },
    )

    expect(result.spotifyCapabilities.adsManager).toMatchObject({
      ready: false,
      status: 'wrong_account',
      accountId: 'spotify-ads-main',
    })
    expect(result.message).toContain('different ad account')
  })

  it('keeps Ads Manager unavailable until the advertiser identity is visible', async () => {
    evaluate.mockImplementation(async () => currentUrl.includes('open.spotify.com')
      ? {
          url: 'https://open.spotify.com/collection/playlists',
          title: 'Spotify',
          text: 'Your Library Create playlist',
          links: ['https://open.spotify.com/user/31artistmain'],
        }
      : currentUrl.includes('adsmanager.spotify.com')
        ? {
            url: 'https://adsmanager.spotify.com/campaigns',
            title: 'Spotify Ads Manager',
            text: 'Campaigns Create campaign Reporting',
            links: [],
          }
        : {
            url: 'https://artists.spotify.com/c/artist/home',
            title: 'Spotify for Artists',
            text: 'Audience Music Songs',
            links: [],
          })
    const verify = handlers.get(RPC_CHANNELS.settings.SOCIAL_ACCOUNTS_STATUS)

    const result = await verify!(
      { clientId: 'client-1' },
      { platform: 'spotify', profile: 'artist-main', live: true },
    )

    expect(result.spotifyCapabilities.adsManager).toMatchObject({
      ready: false,
      status: 'identity_unverified',
      accountId: null,
    })
    expect(result.message).toContain('Select an Ads Manager account')
    expect(runSocialJsonMock).not.toHaveBeenCalledWith(expect.arrayContaining([
      'profile', 'update', 'spotify', '--ads-account-id',
    ]))
  })

  it('fails closed when the Web Player account differs from the saved identity', async () => {
    savedAccountUrl = 'https://open.spotify.com/user/expected-account'
    const verify = handlers.get(RPC_CHANNELS.settings.SOCIAL_ACCOUNTS_STATUS)

    const result = await verify!(
      { clientId: 'client-1' },
      { platform: 'spotify', profile: 'artist-main', live: true },
    )

    expect(result).toMatchObject({
      ready: false,
      profileStatus: 'wrong_account',
      severity: 'error',
      spotifyCapabilities: {
        artists: { ready: true },
        webPlayer: { ready: false, status: 'wrong_account' },
      },
    })
    expect(runSocialJsonMock).not.toHaveBeenCalledWith(expect.arrayContaining([
      'profile', 'update', 'spotify', '--account-url',
    ]))
  })
})
