import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

type StoredWorkspace = {
  id: string
  name: string
  slug?: string
  rootPath: string
  createdAt: number
  [key: string]: unknown
}

type StoredConfig = {
  workspaces: StoredWorkspace[]
  activeWorkspaceId: string | null
  activeSessionId?: string | null
  [key: string]: unknown
}

type AutomationsConfig = {
  version: number
  automations: Record<string, Array<{ slug?: string; name?: string; [key: string]: unknown }>>
}

const DISCORDTRADER_RECEIVERS = [
  {
    id: 'dtentry1',
    name: 'DiscoTrader entry receiver',
    slug: 'discotrader',
    prompt: 'A signed DiscoTrader entry webhook reached Trading, but the direct deterministic receiver did not handle it. Do not place any trade. Report that the entry receiver is unavailable and preserve the webhook body for diagnosis.',
  },
  {
    id: 'dtmgmt1',
    name: 'DiscoTrader management receiver',
    slug: 'discotrader-management',
    prompt: 'A signed DiscoTrader management webhook reached Trading, but the direct deterministic receiver did not handle it. Do not place, close, or modify any trade. Report that the trade-management receiver is unavailable and preserve the webhook body for diagnosis.',
  },
] as const

export function ensureDiscoTraderReceivers(config: AutomationsConfig): AutomationsConfig {
  const current = config.automations.WebhookReceive ?? []
  const unrelated = current.filter((receiver) => !DISCORDTRADER_RECEIVERS.some(
    ({ slug }) => receiver.slug === slug,
  ))
  return {
    ...config,
    automations: {
      ...config.automations,
      WebhookReceive: [
        ...unrelated,
        ...DISCORDTRADER_RECEIVERS.map((receiver) => ({
          id: receiver.id,
          name: receiver.name,
          slug: receiver.slug,
          secretEnv: 'CRAFT_WH_DISCOTRADER_SECRET',
          allowedMethods: ['POST'],
          permissionMode: 'safe',
          enabled: true,
          actions: [{
            type: 'prompt',
            thinkingLevel: 'medium',
            prompt: receiver.prompt,
          }],
        })),
      ],
    },
  }
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function copyIfPresent(source: string, destination: string): void {
  if (existsSync(source)) cpSync(source, destination, { recursive: true, errorOnExist: true })
}

export function migrateTradeGodAppData(options: {
  legacyConfigRoot: string
  tradeGodConfigRoot: string
  legacyElectronRoot?: string
}): void {
  const { legacyConfigRoot, tradeGodConfigRoot, legacyElectronRoot } = options
  if (existsSync(tradeGodConfigRoot)) {
    throw new Error(`Refusing to overwrite existing Trade God data: ${tradeGodConfigRoot}`)
  }

  const legacyConfig = readJson<StoredConfig>(join(legacyConfigRoot, 'config.json'))
  const tradingWorkspace = legacyConfig.workspaces.find((workspace) =>
    workspace.slug === 'trading'
      || workspace.name.toLowerCase() === 'trading'
      || basename(workspace.rootPath) === 'trading'
  )
  if (!tradingWorkspace) throw new Error('The legacy Runner config has no Trading workspace.')

  const legacyTradingRoot = join(legacyConfigRoot, 'workspaces', 'trading')
  if (!existsSync(join(legacyTradingRoot, 'config.json'))) {
    throw new Error(`Trading workspace is missing: ${legacyTradingRoot}`)
  }

  mkdirSync(dirname(tradeGodConfigRoot), { recursive: true })
  const stagingRoot = mkdtempSync(join(
    dirname(tradeGodConfigRoot),
    `.${basename(tradeGodConfigRoot)}.migration-`,
  ))
  const tradeGodWorkspaceRoot = join(stagingRoot, 'workspaces', 'trading')
  try {
    mkdirSync(join(tradeGodWorkspaceRoot, 'skills'), { recursive: true })

    const migratedWorkspace = {
      ...tradingWorkspace,
      rootPath: '~/.trade-god/workspaces/trading',
      name: 'Trading',
      slug: 'trading',
      artistWorkspaceScope: 'general',
    }
    writeJson(join(stagingRoot, 'config.json'), {
      ...legacyConfig,
      workspaces: [migratedWorkspace],
      activeWorkspaceId: migratedWorkspace.id,
      activeSessionId: null,
    })

    // Credentials are deliberately not copied across app identities. Trade God
    // reconnects only the providers and trading secrets it actually owns.
    copyIfPresent(join(legacyConfigRoot, 'preferences.json'), join(stagingRoot, 'preferences.json'))
    copyIfPresent(join(legacyTradingRoot, 'config.json'), join(tradeGodWorkspaceRoot, 'config.json'))

    const legacyAutomationsPath = join(legacyTradingRoot, 'automations.json')
    if (existsSync(legacyAutomationsPath)) {
      const legacyAutomations = readJson<AutomationsConfig>(legacyAutomationsPath)
      const filtered = Object.fromEntries(
        Object.entries(legacyAutomations.automations)
          .map(([event, automations]) => [
            event,
            automations.filter((automation) =>
              automation.slug?.startsWith('discotrader-')
              || automation.name?.toLowerCase().includes('discotrader')
            ),
          ])
          .filter(([, automations]) => (automations as unknown[]).length > 0)
      )
      writeJson(join(tradeGodWorkspaceRoot, 'automations.json'), ensureDiscoTraderReceivers({
        version: legacyAutomations.version,
        automations: filtered,
      }))
    } else {
      writeJson(join(tradeGodWorkspaceRoot, 'automations.json'), ensureDiscoTraderReceivers({
        version: 2,
        automations: {},
      }))
    }

    writeJson(join(tradeGodWorkspaceRoot, 'activated-agents.json'), {
      version: 1,
      active: [],
      updatedAt: new Date().toISOString(),
    })
    writeJson(join(tradeGodWorkspaceRoot, 'skills', '.global-skills.json'), {
      enabledGlobalSkills: [
        'incident-recovery',
        'order-flow-specialist',
        'trade-desk-operator',
      ],
    })

    if (legacyElectronRoot) {
      mkdirSync(join(stagingRoot, 'electron'), { recursive: true })
      copyIfPresent(
        join(legacyElectronRoot, 'trade-god'),
        join(stagingRoot, 'electron', 'trade-god'),
      )
    }
    renameSync(stagingRoot, tradeGodConfigRoot)
  } catch (error) {
    rmSync(stagingRoot, { recursive: true, force: true })
    throw error
  }
}

if (import.meta.main) {
  const home = homedir()
  migrateTradeGodAppData({
    legacyConfigRoot: join(home, '.craft-agent'),
    tradeGodConfigRoot: join(home, '.trade-god'),
    ...(process.platform === 'darwin'
      ? { legacyElectronRoot: join(home, 'Library', 'Application Support', 'Runner') }
      : {}),
  })
  console.log('Trade God data migrated into its isolated app store. Artist OS data was not changed.')
}
