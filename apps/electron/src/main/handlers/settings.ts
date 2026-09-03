import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  assertAdBrowserProfile,
  assertAdBrowserProvider,
  deleteAdBrowserAccount,
  getAdBrowserAccount,
  listAdBrowserAccounts,
  saveAdBrowserAccount,
  type AdBrowserAccount,
  type AdBrowserProvider,
} from '@craft-agent/shared/config'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from './handler-deps'
import fs from 'node:fs'
import { runSocialJson } from '../social-cli'
import {
  findSpotifyUserAccountUrl,
  findSpotifyAdsManagerAccountId,
  hasLoggedInSignal,
  isSocialPlatformUrl,
  socialLoginUrl,
  type SpotifyLoginSurface,
} from './social-account-browser'
import { adDashboardUrl, assessAdDashboardIdentity, inspectAdDashboard } from './ad-account-browser'

export const GUI_HANDLED_CHANNELS = [
  RPC_CHANNELS.power.SET_KEEP_AWAKE,
  RPC_CHANNELS.settings.SET_NETWORK_PROXY,
  RPC_CHANNELS.settings.SOCIAL_ACCOUNTS_LIST,
  RPC_CHANNELS.settings.SOCIAL_ACCOUNTS_ADD,
  RPC_CHANNELS.settings.SOCIAL_ACCOUNTS_UPDATE,
  RPC_CHANNELS.settings.SOCIAL_ACCOUNTS_DELETE,
  RPC_CHANNELS.settings.SOCIAL_ACCOUNTS_LOGIN,
  RPC_CHANNELS.settings.SOCIAL_ACCOUNTS_STATUS,
  RPC_CHANNELS.settings.AD_BROWSER_ACCOUNTS_LIST,
  RPC_CHANNELS.settings.AD_BROWSER_ACCOUNTS_SAVE,
  RPC_CHANNELS.settings.AD_BROWSER_ACCOUNTS_DELETE,
  RPC_CHANNELS.settings.AD_BROWSER_ACCOUNTS_LOGIN,
  RPC_CHANNELS.settings.AD_BROWSER_ACCOUNTS_STATUS,
] as const

const SOCIAL_PLATFORMS = new Set(['instagram', 'tiktok', 'x', 'youtube', 'spotify'])

// ============================================================
// GUI-only settings (require Electron-specific APIs)
// ============================================================

export function registerSettingsGuiHandlers(server: RpcServer, deps: HandlerDeps): void {
  // Set keep awake while running setting (requires Electron power-manager)
  server.handle(RPC_CHANNELS.power.SET_KEEP_AWAKE, async (_ctx, enabled: boolean) => {
    const { setKeepAwakeWhileRunning } = await import('@craft-agent/shared/config/storage')
    const { setKeepAwakeSetting } = await import('../power-manager')
    // Save to config
    setKeepAwakeWhileRunning(enabled)
    // Update the power manager's cached value and power state
    setKeepAwakeSetting(enabled)
  })

  // Set network proxy settings (requires Electron session proxy)
  server.handle(RPC_CHANNELS.settings.SET_NETWORK_PROXY, async (_ctx, settings: import('@craft-agent/shared/config/types').NetworkProxySettings) => {
    const { updateConfiguredProxySettings } = await import('../network-proxy')
    await updateConfiguredProxySettings(settings)
  })

  server.handle(RPC_CHANNELS.settings.SOCIAL_ACCOUNTS_LIST, async () => {
    return runSocialJson(['doctor', '--json'])
  })

  server.handle(RPC_CHANNELS.settings.SOCIAL_ACCOUNTS_ADD, async (_ctx, input: SocialAccountInput) => {
    const ref = assertSocialRef(input)
    return runSocialJson([
      'profile', 'add', ref.platform,
      '--profile', ref.profile,
      ...optionalFlag('--account-group', input.accountGroup),
      ...optionalFlag('--handle', input.handle),
      ...optionalFlag('--account-url', input.accountUrl),
      '--json',
    ])
  })

  server.handle(RPC_CHANNELS.settings.SOCIAL_ACCOUNTS_UPDATE, async (_ctx, input: SocialAccountInput) => {
    const ref = assertSocialRef(input)
    return runSocialJson([
      'profile', 'update', ref.platform,
      '--profile', ref.profile,
      ...optionalStringOrClear('--account-group', '--clear-account-group', input.accountGroup),
      ...optionalStringOrClear('--handle', '--clear-handle', input.handle),
      ...optionalStringOrClear('--account-url', '--clear-account-url', input.accountUrl),
      '--json',
    ])
  })

  server.handle(RPC_CHANNELS.settings.SOCIAL_ACCOUNTS_DELETE, async (_ctx, input: SocialAccountRef) => {
    const ref = assertSocialRef(input)
    return runSocialJson(['profile', 'delete', ref.platform, '--profile', ref.profile, '--json'])
  })

  server.handle(RPC_CHANNELS.settings.SOCIAL_ACCOUNTS_LOGIN, async (_ctx, input: SocialAccountRef) => {
    const ref = assertSocialRef(input)
    const result = await runSocialJson(['profile', 'login', ref.platform, '--profile', ref.profile, '--json']) as SocialAccountCommandResult
    const sessionPath = typeof result.sessionPath === 'string' ? result.sessionPath : null
    if (sessionPath) fs.mkdirSync(sessionPath, { recursive: true })

    const browserPaneManager = deps.browserPaneManager
    if (!browserPaneManager) return result

    const partition = socialBrowserPartition(ref)
    const spotifySurface: SpotifyLoginSurface = ref.platform === 'spotify' && input.spotifySurface === 'web-player'
      ? 'web-player'
      : ref.platform === 'spotify' && input.spotifySurface === 'ads-manager'
        ? 'ads-manager'
        : 'artists'
    const instanceId = browserPaneManager.createInstance(socialBrowserInstanceId(ref), {
      show: false,
      partition,
    })
    void browserPaneManager.navigate(instanceId, socialLoginUrl(ref.platform, spotifySurface)).catch((error) => {
      deps.platform.logger.warn(`[social-accounts] login browser navigation failed for ${ref.platform}/${ref.profile}:`, error)
    })

    return {
      ...result,
      browserInstanceId: instanceId,
      browserPartition: partition,
      spotifySurface: ref.platform === 'spotify' ? spotifySurface : undefined,
      sessionExists: sessionPath ? true : result.sessionExists,
      localSessionExists: sessionPath ? true : result.localSessionExists,
      data: {
        ...(result.data || {}),
        browserInstanceId: instanceId,
        browserPartition: partition,
        spotifySurface: ref.platform === 'spotify' ? spotifySurface : undefined,
      },
    }
  })

  server.handle(RPC_CHANNELS.settings.SOCIAL_ACCOUNTS_STATUS, async (_ctx, input: SocialAccountStatusInput) => {
    const ref = assertSocialRef(input)
    if (input.live && deps.browserPaneManager) {
      const current = await runSocialJson([
        'profile', 'status', ref.platform,
        '--profile', ref.profile,
        '--json',
      ]) as SocialAccountStatusResult
      if (ref.platform === 'spotify') {
        const checked = await verifySpotifyBrowserCapabilities(deps.browserPaneManager, ref, current)
        if (checked) {
          let accountUrl = typeof current.accountUrl === 'string' ? current.accountUrl : null
          if (!accountUrl && checked.discoveredAccountUrl) {
            await runSocialJson([
              'profile', 'update', 'spotify',
              '--profile', ref.profile,
              '--account-url', checked.discoveredAccountUrl,
              '--json',
            ])
            accountUrl = checked.discoveredAccountUrl
          }
          let adsAccountId = typeof current.adsAccountId === 'string' ? current.adsAccountId : null
          const discoveredAdsAccountId = checked.capabilities.adsManager.accountId || null
          if (!adsAccountId && discoveredAdsAccountId) {
            await runSocialJson([
              'profile', 'update', 'spotify',
              '--profile', ref.profile,
              '--ads-account-id', discoveredAdsAccountId,
              '--json',
            ])
            adsAccountId = discoveredAdsAccountId
          }

          const verification = {
            ...checked.verification,
            visibleIdentity: {
              ...checked.verification.visibleIdentity,
              accountUrl: checked.discoveredAccountUrl || accountUrl,
            },
          }
          const result = await runSocialJson([
            'profile', 'status', 'spotify',
            '--profile', ref.profile,
            '--live',
            '--verification-json', JSON.stringify(verification),
            '--json',
          ]) as SocialAccountProfileStatusResult
          const bothReady = checked.capabilities.artists.ready && checked.capabilities.webPlayer.ready
          const anyReady = checked.capabilities.artists.ready || checked.capabilities.webPlayer.ready
          const wrongAccount = checked.capabilities.webPlayer.status === 'wrong_account'
          return {
            ...result,
            accountUrl,
            adsAccountId,
            ready: bothReady,
            loggedIn: bothReady,
            profileStatus: bothReady ? 'verified' : wrongAccount ? 'wrong_account' : anyReady ? 'partial' : 'login_needed',
            severity: bothReady ? 'info' : wrongAccount ? 'error' : 'warning',
            message: spotifyCapabilityMessage(checked.capabilities),
            nextAction: bothReady ? 'none' : checked.capabilities.artists.ready ? 'open_web_player_login' : 'open_artists_login',
            browserInstanceId: socialBrowserInstanceId(ref),
            spotifyCapabilities: checked.capabilities,
          }
        }
      }
      const verification = await verifySocialBrowserProfile(deps.browserPaneManager, ref, current)
      if (verification) {
        const result = await runSocialJson([
          'profile', 'status', ref.platform,
          '--profile', ref.profile,
          '--live',
          '--verification-json', JSON.stringify(verification),
          '--json',
        ]) as SocialAccountProfileStatusResult
        return {
          ...result,
          browserInstanceId: socialBrowserInstanceId(ref),
        }
      }
    }
    return runSocialJson([
      'profile', 'status', ref.platform,
      '--profile', ref.profile,
      ...(input.live ? ['--live'] : []),
      '--json',
    ])
  })

  server.handle(RPC_CHANNELS.settings.AD_BROWSER_ACCOUNTS_LIST, async () => {
    return listAdBrowserAccounts().map(adAccountUncheckedStatus)
  })

  server.handle(RPC_CHANNELS.settings.AD_BROWSER_ACCOUNTS_SAVE, async (_ctx, input: AdBrowserAccountInput) => {
    const ref = assertAdBrowserRef(input)
    const account = saveAdBrowserAccount({
      provider: ref.provider,
      profile: ref.profile,
      label: input?.label,
      accountId: input?.accountId,
    })
    return { ok: true, account: adAccountUncheckedStatus(account) }
  })

  server.handle(RPC_CHANNELS.settings.AD_BROWSER_ACCOUNTS_DELETE, async (_ctx, input: AdBrowserAccountRef) => {
    const ref = assertAdBrowserRef(input)
    const existing = getAdBrowserAccount(ref.provider, ref.profile)
    if (!existing) return { ok: true, deleted: false }
    if (!deps.browserPaneManager) throw new Error('Controlled browser is unavailable; saved login was not removed.')
    // Clear the persistent partition before deleting its routing metadata. If
    // cleanup fails, keep the account visible so the user can retry safely.
    await deps.browserPaneManager.forgetAdProfile(ref.provider, ref.profile)
    const deleted = deleteAdBrowserAccount(ref.provider, ref.profile)
    return { ok: true, deleted }
  })

  server.handle(RPC_CHANNELS.settings.AD_BROWSER_ACCOUNTS_LOGIN, async (_ctx, input: AdBrowserAccountRef) => {
    const ref = assertAdBrowserRef(input)
    const account = getAdBrowserAccount(ref.provider, ref.profile)
    if (!account) throw new Error(`Ad account ${ref.provider}/${ref.profile} is not configured`)
    if (!deps.browserPaneManager) {
      return { ok: false, message: 'Controlled browser is unavailable on this host.' }
    }
    const instanceId = adBrowserInstanceId(ref)
    const partition = adBrowserPartition(ref)
    if (!deps.browserPaneManager.getInstance(instanceId)) {
      deps.browserPaneManager.createInstance(instanceId, { show: false, partition })
    }
    void deps.browserPaneManager.navigate(instanceId, adDashboardUrl(ref.provider)).catch((error) => {
      deps.platform.logger.warn(`[ad-accounts] login navigation failed for ${ref.provider}/${ref.profile}:`, error)
    })
    return {
      ok: true,
      browserInstanceId: instanceId,
      browserPartition: partition,
      account: adAccountUncheckedStatus(account),
    }
  })

  server.handle(RPC_CHANNELS.settings.AD_BROWSER_ACCOUNTS_STATUS, async (_ctx, input: AdBrowserAccountRef) => {
    const ref = assertAdBrowserRef(input)
    const account = getAdBrowserAccount(ref.provider, ref.profile)
    if (!account) throw new Error(`Ad account ${ref.provider}/${ref.profile} is not configured`)
    if (!deps.browserPaneManager) {
      return {
        ...adAccountUncheckedStatus(account),
        status: 'login_needed' as const,
        message: 'Controlled browser is unavailable on this host.',
      }
    }

    const instanceId = adBrowserInstanceId(ref)
    if (!deps.browserPaneManager.getInstance(instanceId)) {
      deps.browserPaneManager.createInstance(instanceId, {
        show: false,
        partition: adBrowserPartition(ref),
      })
    }
    const page = await navigateAndReadBrowserPage(
      deps.browserPaneManager,
      instanceId,
      adDashboardUrl(ref.provider),
    )
    const inspected = inspectAdDashboard(ref.provider, page)
    const identity = assessAdDashboardIdentity(account.accountId, inspected)
    const saved = !identity.expectedId && identity.observedId
      ? saveAdBrowserAccount({ ...account, accountId: identity.observedId })
      : account

    return {
      provider: saved.provider,
      profile: saved.profile,
      label: saved.label,
      accountId: saved.accountId,
      status: identity.status,
      ready: identity.ready,
      loggedIn: inspected.loggedIn,
      matchesExpected: identity.matchesExpected,
      message: identity.status === 'ready'
        ? `${saved.label} is logged in and account identity is verified.`
        : identity.status === 'wrong_account'
          ? `This browser is logged into account ${identity.observedId}, but ${saved.accountId} is expected.`
          : identity.status === 'login_needed'
            ? `Log in to ${saved.label}, then verify again.`
            : `The dashboard is logged in, but its account ID could not be verified.`,
      lastCheckedAt: new Date().toISOString(),
      browserInstanceId: instanceId,
      browserPartition: adBrowserPartition(ref),
      observedAccountId: identity.observedId,
      evidence: { url: inspected.url, title: inspected.title },
    }
  })
}

type SocialAccountRef = {
  platform?: string
  profile?: string
  spotifySurface?: SpotifyLoginSurface
}

type SocialAccountInput = SocialAccountRef & {
  accountGroup?: string
  handle?: string
  accountUrl?: string
}

type SocialAccountStatusInput = SocialAccountRef & {
  live?: boolean
}

type SocialAccountCommandResult = {
  sessionPath?: unknown
  sessionExists?: unknown
  localSessionExists?: unknown
  data?: Record<string, unknown>
  [key: string]: unknown
}

type SocialAccountStatusResult = SocialAccountCommandResult & {
  accountHandle?: unknown
  accountUrl?: unknown
  adsAccountId?: unknown
}

type SocialAccountProfileStatusResult = SocialAccountStatusResult & {
  browserInstanceId?: string
}

type AdBrowserAccountRef = {
  provider?: string
  profile?: string
}

type AdBrowserAccountInput = AdBrowserAccountRef & {
  label?: string
  accountId?: string | null
}

type SocialBrowserVerification = {
  platform: string
  profile: string
  source: 'runner-electron-browser'
  loggedIn: boolean
  visibleIdentity: {
    handle: string | null
    accountUrl: string | null
    rawText: string
    url: string
  }
  checkedAt: string
}

type SpotifyCapability = {
  ready: boolean
  status: 'ready' | 'login_needed' | 'identity_unverified' | 'wrong_account'
  label: string
  message: string
  accountUrl?: string | null
  accountId?: string | null
}

type SpotifyCapabilities = {
  artists: SpotifyCapability
  webPlayer: SpotifyCapability
  adsManager: SpotifyCapability
}

type BrowserIdentityPage = {
  url?: string
  title?: string
  text?: string
  links?: string[]
}

function assertSocialRef(input: SocialAccountRef): { platform: string; profile: string } {
  const platform = String(input?.platform || '')
  const profile = String(input?.profile || '').trim()
  if (!SOCIAL_PLATFORMS.has(platform)) throw new Error(`Unsupported social platform: ${platform || '(missing)'}`)
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(profile)) throw new Error('Profile must be a short slug using letters, numbers, dashes, or underscores')
  return { platform, profile }
}

function assertAdBrowserRef(input: AdBrowserAccountRef): { provider: AdBrowserProvider; profile: string } {
  return {
    provider: assertAdBrowserProvider(input?.provider),
    profile: assertAdBrowserProfile(input?.profile),
  }
}

function adBrowserPartition(ref: { provider: string; profile: string }): string {
  return `persist:ads-${ref.provider}-${socialBrowserSegment(ref.profile)}`
}

function adBrowserInstanceId(ref: { provider: string; profile: string }): string {
  return `ads-${ref.provider}-${socialBrowserSegment(ref.profile)}`
}

function adAccountUncheckedStatus(account: AdBrowserAccount) {
  return {
    provider: account.provider,
    profile: account.profile,
    label: account.label,
    accountId: account.accountId,
    status: 'not_checked' as const,
    ready: false,
    loggedIn: null,
    matchesExpected: null,
    message: 'Saved login has not been verified in this check.',
    lastCheckedAt: null,
    browserInstanceId: adBrowserInstanceId(account),
    browserPartition: adBrowserPartition(account),
  }
}

function optionalFlag(name: string, value: unknown): string[] {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized ? [name, normalized] : []
}

function optionalStringOrClear(name: string, clearName: string, value: unknown): string[] {
  if (value === undefined) return []
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized ? [name, normalized] : [clearName]
}

function socialBrowserPartition(ref: { platform: string; profile: string }): string {
  return `persist:social-${ref.platform}-${socialBrowserSegment(ref.profile)}`
}

function socialBrowserInstanceId(ref: { platform: string; profile: string }): string {
  return `social-${ref.platform}-${socialBrowserSegment(ref.profile)}`
}

function socialBrowserSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '-')
}

async function verifySpotifyBrowserCapabilities(
  browserPaneManager: NonNullable<HandlerDeps['browserPaneManager']>,
  ref: { platform: string; profile: string },
  status: SocialAccountStatusResult,
): Promise<{
  capabilities: SpotifyCapabilities
  discoveredAccountUrl: string | null
  verification: SocialBrowserVerification
} | null> {
  const instanceId = socialBrowserInstanceId(ref)
  let instance = browserPaneManager.getInstance(instanceId)
  if (!instance) {
    browserPaneManager.createInstance(instanceId, {
      show: false,
      partition: socialBrowserPartition(ref),
    })
    instance = browserPaneManager.getInstance(instanceId)
  }
  if (!instance) return null

  const artistsPage = await navigateAndReadBrowserPage(
    browserPaneManager,
    instanceId,
    socialLoginUrl('spotify', 'artists'),
  )
  const artistsLoggedIn = hasLoggedInSignal(
    'spotify',
    String(artistsPage?.text || ''),
    String(artistsPage?.url || ''),
  )

  const webPlayerPage = await navigateAndReadBrowserPage(
    browserPaneManager,
    instanceId,
    socialLoginUrl('spotify', 'web-player'),
  )
  const webPlayerLoggedIn = hasLoggedInSignal(
    'spotify',
    String(webPlayerPage?.text || ''),
    String(webPlayerPage?.url || ''),
  )
  const discoveredAccountUrl = findSpotifyUserAccountUrl([
    String(webPlayerPage?.url || ''),
    ...(Array.isArray(webPlayerPage?.links) ? webPlayerPage.links : []),
  ])
  const expectedAccountUrl = normalizeComparableUrl(status.accountUrl)
  const observedAccountUrl = normalizeComparableUrl(discoveredAccountUrl)
  const wrongAccount = Boolean(
    webPlayerLoggedIn
    && expectedAccountUrl
    && observedAccountUrl
    && expectedAccountUrl !== observedAccountUrl,
  )
  const webPlayerReady = Boolean(
    webPlayerLoggedIn
    && observedAccountUrl
    && !wrongAccount,
  )

  const adsManagerPage = await navigateAndReadBrowserPage(
    browserPaneManager,
    instanceId,
    socialLoginUrl('spotify', 'ads-manager'),
  )
  const adsManagerLoggedIn = hasLoggedInSignal(
    'spotify',
    String(adsManagerPage?.text || ''),
    String(adsManagerPage?.url || ''),
  )
  const discoveredAdsAccountId = findSpotifyAdsManagerAccountId({
    currentUrl: String(adsManagerPage?.url || ''),
    links: Array.isArray(adsManagerPage?.links) ? adsManagerPage.links : [],
    text: String(adsManagerPage?.text || ''),
  })
  const expectedAdsAccountId = String(status.adsAccountId || '').trim() || null
  const wrongAdsAccount = Boolean(
    adsManagerLoggedIn
    && expectedAdsAccountId
    && discoveredAdsAccountId
    && expectedAdsAccountId !== discoveredAdsAccountId,
  )
  const adsManagerReady = Boolean(adsManagerLoggedIn && discoveredAdsAccountId && !wrongAdsAccount)

  const capabilities: SpotifyCapabilities = {
    artists: {
      ready: artistsLoggedIn,
      status: artistsLoggedIn ? 'ready' : 'login_needed',
      label: 'Spotify for Artists',
      message: artistsLoggedIn
        ? 'Analytics access is ready.'
        : 'Log in to Spotify for Artists to enable analytics.',
    },
    webPlayer: {
      ready: webPlayerReady,
      status: wrongAccount
        ? 'wrong_account'
        : !webPlayerLoggedIn
          ? 'login_needed'
          : observedAccountUrl
            ? 'ready'
            : 'identity_unverified',
      label: 'Spotify Web Player',
      message: wrongAccount
        ? 'The Web Player is logged into a different Spotify account.'
        : !webPlayerLoggedIn
          ? 'Log in to the Web Player to enable playlist creation.'
          : observedAccountUrl
            ? 'Playlist access is ready.'
            : 'The Web Player is logged in, but its account identity could not be verified.',
      accountUrl: discoveredAccountUrl,
    },
    adsManager: {
      ready: adsManagerReady,
      status: wrongAdsAccount
        ? 'wrong_account'
        : !adsManagerLoggedIn
          ? 'login_needed'
          : discoveredAdsAccountId
            ? 'ready'
            : 'identity_unverified',
      label: 'Spotify Ads Manager',
      message: wrongAdsAccount
        ? 'Spotify Ads Manager is open to a different ad account.'
        : !adsManagerLoggedIn
          ? 'Log in to Spotify Ads Manager to enable Ad Runner browser work.'
          : discoveredAdsAccountId
            ? 'Paid campaign dashboard access is ready.'
            : 'Select an Ads Manager account so Artist OS can verify it.',
      accountId: discoveredAdsAccountId,
    },
  }

  return {
    capabilities,
    discoveredAccountUrl,
    verification: {
      platform: 'spotify',
      profile: ref.profile,
      source: 'runner-electron-browser',
      loggedIn: artistsLoggedIn && webPlayerLoggedIn,
      visibleIdentity: {
        handle: null,
        accountUrl: discoveredAccountUrl,
        rawText: [String(artistsPage?.text || ''), String(webPlayerPage?.text || ''), String(adsManagerPage?.text || '')]
          .join('\n')
          .slice(0, 50000),
        url: String(artistsPage?.url || ''),
      },
      checkedAt: new Date().toISOString(),
    },
  }
}

async function navigateAndReadBrowserPage(
  browserPaneManager: NonNullable<HandlerDeps['browserPaneManager']>,
  instanceId: string,
  url: string,
): Promise<BrowserIdentityPage | null> {
  await browserPaneManager.navigate(instanceId, url)
  await wait(1500)
  return browserPaneManager.evaluate(instanceId, `(() => {
    const links = Array.from(document.querySelectorAll('a[href]')).slice(0, 500).map((a) => a.href)
    return {
      url: location.href,
      title: document.title,
      text: (document.body?.innerText || '').slice(0, 50000),
      links,
    }
  })()`) as Promise<BrowserIdentityPage | null>
}

function spotifyCapabilityMessage(capabilities: SpotifyCapabilities): string {
  if (capabilities.artists.ready && capabilities.webPlayer.ready) {
    return capabilities.adsManager.ready
      ? 'Spotify is ready for analytics, playlist creation, and paid campaigns.'
      : `Spotify analytics and playlist creation are ready. ${capabilities.adsManager.message}`
  }
  if (capabilities.artists.ready) {
    return `Analytics is ready. ${capabilities.webPlayer.message}`
  }
  if (capabilities.webPlayer.ready) {
    return `Playlist creation is ready. ${capabilities.artists.message}`
  }
  return `${capabilities.artists.message} ${capabilities.webPlayer.message}`
}

async function verifySocialBrowserProfile(
  browserPaneManager: NonNullable<HandlerDeps['browserPaneManager']>,
  ref: { platform: string; profile: string },
  status: SocialAccountStatusResult,
): Promise<SocialBrowserVerification | null> {
  const instanceId = socialBrowserInstanceId(ref)
  let instance = browserPaneManager.getInstance(instanceId)
  if (!instance) {
    browserPaneManager.createInstance(instanceId, {
      show: false,
      partition: socialBrowserPartition(ref),
    })
    instance = browserPaneManager.getInstance(instanceId)
  }
  if (!instance) return null

  if (!isSocialPlatformUrl(ref.platform, instance.currentUrl)) {
    await browserPaneManager.navigate(instanceId, socialLoginUrl(ref.platform))
    await wait(1500)
  }

  const page = await browserPaneManager.evaluate(instanceId, `(() => {
    const links = Array.from(document.querySelectorAll('a[href]')).slice(0, 500).map((a) => a.href)
    return {
      url: location.href,
      title: document.title,
      text: (document.body?.innerText || '').slice(0, 50000),
      links,
    }
  })()`) as { url?: string; title?: string; text?: string; links?: string[] } | null
  if (!page) return null

  const expectedHandle = normalizeHandle(status.accountHandle)
  const expectedUrl = normalizeComparableUrl(status.accountUrl)
  const rawText = String(page.text || '')
  const urls = [String(page.url || ''), ...(Array.isArray(page.links) ? page.links : [])]
  const hasExpectedUrl = expectedUrl ? urls.some((url) => normalizeComparableUrl(url) === expectedUrl) : false
  const hasExpectedHandle = expectedHandle ? pageHasHandle(rawText, urls, expectedHandle) : false
  const loggedIn = hasLoggedInSignal(ref.platform, rawText, String(page.url || ''))

  return {
    platform: ref.platform,
    profile: ref.profile,
    source: 'runner-electron-browser',
    loggedIn,
    visibleIdentity: {
      handle: hasExpectedHandle ? `@${expectedHandle}` : null,
      accountUrl: hasExpectedUrl ? String(status.accountUrl || page.url || '') : null,
      rawText,
      url: String(page.url || ''),
    },
    checkedAt: new Date().toISOString(),
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function pageHasHandle(text: string, urls: string[], expectedHandle: string): boolean {
  const escaped = expectedHandle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (new RegExp(`(^|[^a-z0-9_])@?${escaped}([^a-z0-9_]|$)`, 'i').test(text)) return true
  return urls.some((url) => new RegExp(`/${escaped}([/?#]|$)`, 'i').test(url))
}

function normalizeHandle(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim().replace(/^@+/, '').toLowerCase() : ''
  return normalized || null
}

function normalizeComparableUrl(value: unknown): string | null {
  if (!value) return null
  try {
    const url = new URL(String(value))
    url.hash = ''
    url.search = ''
    return `${url.hostname.replace(/^www\./, '').toLowerCase()}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}
