import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from './handler-deps'
import { app } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export const GUI_HANDLED_CHANNELS = [
  RPC_CHANNELS.power.SET_KEEP_AWAKE,
  RPC_CHANNELS.settings.SET_NETWORK_PROXY,
  RPC_CHANNELS.settings.SOCIAL_ACCOUNTS_LIST,
  RPC_CHANNELS.settings.SOCIAL_ACCOUNTS_ADD,
  RPC_CHANNELS.settings.SOCIAL_ACCOUNTS_UPDATE,
  RPC_CHANNELS.settings.SOCIAL_ACCOUNTS_DELETE,
  RPC_CHANNELS.settings.SOCIAL_ACCOUNTS_LOGIN,
  RPC_CHANNELS.settings.SOCIAL_ACCOUNTS_STATUS,
] as const

const SOCIAL_PLATFORMS = new Set(['instagram', 'tiktok', 'x', 'youtube'])

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
    const instanceId = browserPaneManager.createInstance(socialBrowserInstanceId(ref), {
      show: true,
      partition,
    })
    browserPaneManager.focus(instanceId)
    await browserPaneManager.navigate(instanceId, socialLoginUrl(ref.platform))

    return {
      ...result,
      browserInstanceId: instanceId,
      browserPartition: partition,
      sessionExists: sessionPath ? true : result.sessionExists,
      localSessionExists: sessionPath ? true : result.localSessionExists,
      data: {
        ...(result.data || {}),
        browserInstanceId: instanceId,
        browserPartition: partition,
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
      const verification = await verifySocialBrowserProfile(deps.browserPaneManager, ref, current)
      if (verification) {
        return runSocialJson([
          'profile', 'status', ref.platform,
          '--profile', ref.profile,
          '--live',
          '--verification-json', JSON.stringify(verification),
          '--json',
        ])
      }
    }
    return runSocialJson([
      'profile', 'status', ref.platform,
      '--profile', ref.profile,
      ...(input.live ? ['--live'] : []),
      '--json',
    ])
  })
}

type SocialAccountRef = {
  platform?: string
  profile?: string
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

function assertSocialRef(input: SocialAccountRef): { platform: string; profile: string } {
  const platform = String(input?.platform || '')
  const profile = String(input?.profile || '').trim()
  if (!SOCIAL_PLATFORMS.has(platform)) throw new Error(`Unsupported social platform: ${platform || '(missing)'}`)
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(profile)) throw new Error('Profile must be a short slug using letters, numbers, dashes, or underscores')
  return { platform, profile }
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

function socialLoginUrl(platform: string): string {
  if (platform === 'instagram') return 'https://www.instagram.com/'
  if (platform === 'tiktok') return 'https://www.tiktok.com/'
  if (platform === 'x') return 'https://x.com/'
  if (platform === 'youtube') return 'https://www.youtube.com/'
  return 'https://www.google.com/'
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
      show: true,
      partition: socialBrowserPartition(ref),
    })
    instance = browserPaneManager.getInstance(instanceId)
  }
  if (!instance) return null

  browserPaneManager.focus(instanceId)
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
  const loggedIn = hasLoggedInSignal(ref.platform, rawText, urls)

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

function hasLoggedInSignal(platform: string, text: string, urls: string[]): boolean {
  const lower = text.toLowerCase()
  if (platform === 'instagram') {
    return urls.some((url) => /instagram\.com\/(direct|accounts\/edit|create)/i.test(url))
      || /\b(home|messages|notifications|create|profile)\b/i.test(text)
  }
  if (platform === 'x') {
    return urls.some((url) => /x\.com\/(compose|home|messages|notifications|settings)/i.test(url))
      || /\b(post|messages|notifications|premium)\b/i.test(text)
  }
  if (platform === 'tiktok') {
    return urls.some((url) => /tiktok\.com\/(upload|messages|setting|creator-center)/i.test(url))
      || /\b(upload|messages|profile|following)\b/i.test(text)
  }
  if (platform === 'youtube') {
    return urls.some((url) => /youtube\.com\/(feed|account|channel|@|upload|studio)/i.test(url))
      || lower.includes('create') || lower.includes('your channel')
  }
  return false
}

function isSocialPlatformUrl(platform: string, value: string): boolean {
  if (platform === 'instagram') return /(^|\/\/)(www\.)?instagram\.com\//i.test(value)
  if (platform === 'tiktok') return /(^|\/\/)(www\.)?tiktok\.com\//i.test(value)
  if (platform === 'x') return /(^|\/\/)(www\.)?(x|twitter)\.com\//i.test(value)
  if (platform === 'youtube') return /(^|\/\/)(www\.)?youtube\.com\//i.test(value)
  return false
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

function socialToolDir(): string {
  const candidates = [
    process.env.RUNNEROS_ROOT ? path.join(process.env.RUNNEROS_ROOT, 'tools', 'printing-press-social') : null,
    path.join(process.cwd(), 'tools', 'printing-press-social'),
    path.join(app.getAppPath(), 'tools', 'printing-press-social'),
    path.resolve(app.getAppPath(), '..', '..', 'tools', 'printing-press-social'),
  ].filter(Boolean) as string[]

  const found = candidates.find((candidate) => fs.existsSync(path.join(candidate, 'src', 'social.mjs')))
  if (!found) throw new Error('Printing Press Social CLI was not found in this app bundle')
  return found
}

function runSocialJson(args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const cwd = socialToolDir()
    const child = spawn(process.execPath, [path.join(cwd, 'src', 'social.mjs'), ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    const timer = setTimeout(() => {
      finish(() => {
        child.kill('SIGKILL')
        reject(new Error(`Social CLI timed out while running: ${args.join(' ')}`))
      })
    }, 30_000)
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', (error) => finish(() => reject(error)))
    child.on('close', (code) => {
      finish(() => {
        const text = stdout.trim() || stderr.trim()
        try {
          const parsed = text ? JSON.parse(text) as { error?: string } : null
          if (code === 0) resolve(parsed)
          else reject(new Error(parsed?.error || stderr || `social exited ${code}`))
        } catch (error) {
          reject(new Error(`Invalid social CLI response: ${error instanceof Error ? error.message : String(error)}`))
        }
      })
    })
  })
}
