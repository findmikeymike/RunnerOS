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

export function registerSettingsGuiHandlers(server: RpcServer, _deps: HandlerDeps): void {
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
      ...optionalFlag('--handle', input.handle),
      ...optionalFlag('--account-url', input.accountUrl),
      '--json',
    ])
  })

  server.handle(RPC_CHANNELS.settings.SOCIAL_ACCOUNTS_DELETE, async (_ctx, input: SocialAccountRef) => {
    const ref = assertSocialRef(input)
    return runSocialJson(['profile', 'delete', ref.platform, '--profile', ref.profile, '--json'])
  })

  server.handle(RPC_CHANNELS.settings.SOCIAL_ACCOUNTS_LOGIN, async (_ctx, input: SocialAccountRef) => {
    const ref = assertSocialRef(input)
    return runSocialJson(['profile', 'login', ref.platform, '--profile', ref.profile, '--json'])
  })

  server.handle(RPC_CHANNELS.settings.SOCIAL_ACCOUNTS_STATUS, async (_ctx, input: SocialAccountStatusInput) => {
    const ref = assertSocialRef(input)
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
  handle?: string
  accountUrl?: string
}

type SocialAccountStatusInput = SocialAccountRef & {
  live?: boolean
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
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
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
}
