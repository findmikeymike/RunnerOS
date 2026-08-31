import { beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importArtistVaultAssets } from '@craft-agent/shared/artist-vault'
import { importMissionAssets } from '@craft-agent/shared/mission-assets'
import { resolveReleaseKitItemPath } from '@craft-agent/shared/release-kit'
import { writeOutputFinalsRegistry } from '@craft-agent/shared/outputs'
import { upsertContextDoc } from '@craft-agent/shared/workspace-context'
import { createCampaignCalendarItem, serializeCampaignCalendarBody } from '@craft-agent/shared/campaign-calendar'
import { serializeScheduledWorkBody, type ScheduledWorkOrder } from '@craft-agent/shared/scheduled-work'
import { ReleaseKitService } from './ReleaseKitService'
import { OutputService } from '../outputs/OutputService'

const workspaces = new Map<string, {
  id: string
  name: string
  rootPath: string
  artistWorkspaceScope: 'hq' | 'campaign'
}>()

beforeEach(() => workspaces.clear())

function service(): ReleaseKitService {
  return new ReleaseKitService({
    getWorkspaceByNameOrId: (id) => workspaces.get(id) as never,
    assertWritePermission: () => {},
  })
}

describe('ReleaseKitService source trust', () => {
  test('promotes a registered Campaign Asset into an independent snapshot', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-kit-service-campaign-'))
    workspaces.set('campaign-1', {
      id: 'campaign-1',
      name: 'Campaign',
      rootPath: campaignRoot,
      artistWorkspaceScope: 'campaign',
    })
    const source = join(campaignRoot, 'incoming-master.wav')
    writeFileSync(source, 'master-v1')
    const asset = importMissionAssets(campaignRoot, 'campaign-1', [source], { kindHint: 'master' }).imported[0]!

    const result = service().promote('campaign-1', {
      source: { type: 'campaign-asset', assetId: asset.id },
      category: 'audio',
      subtype: 'master',
      makePrimary: true,
    }, 'user')
    const snapshot = resolveReleaseKitItemPath(campaignRoot, result.item.relativePath)

    writeFileSync(source, 'master-v2')
    expect(readFileSync(snapshot, 'utf8')).toBe('master-v1')
    expect(result.item.source).toEqual({ type: 'campaign-asset', assetId: asset.id })
  })

  test('blocks arbitrary agent uploads and private HQ Vault records', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-kit-service-campaign-'))
    const hqRoot = mkdtempSync(join(tmpdir(), 'release-kit-service-hq-'))
    workspaces.set('campaign-1', {
      id: 'campaign-1',
      name: 'Campaign',
      rootPath: campaignRoot,
      artistWorkspaceScope: 'campaign',
    })
    workspaces.set('hq-1', {
      id: 'hq-1',
      name: 'Artist HQ',
      rootPath: hqRoot,
      artistWorkspaceScope: 'hq',
    })
    const releaseKit = service()
    const arbitrary = join(campaignRoot, 'unregistered.wav')
    writeFileSync(arbitrary, 'untrusted')

    expect(() => releaseKit.promote('campaign-1', {
      source: { type: 'upload', originalFileName: 'unregistered.wav' },
      uploadPath: arbitrary,
      category: 'audio',
      subtype: 'master',
    }, 'agent')).toThrow(/cannot promote arbitrary upload paths/i)

    const contractPath = join(hqRoot, 'artist-contract.pdf')
    writeFileSync(contractPath, 'private contract')
    const privateAsset = importArtistVaultAssets(hqRoot, 'hq-1', [contractPath], { kindHint: 'contract' }).imported[0]!
    expect(privateAsset.rightsStatus).toBe('private')

    expect(() => releaseKit.promote('campaign-1', {
      source: { type: 'vault-asset', assetId: privateAsset.id, vaultWorkspaceId: 'hq-1' },
      category: 'documents',
      subtype: 'contract',
    }, 'user')).toThrow(/not approved for agent use|private/i)
  })

  test('rejects a registered relative asset replaced by a symlink outside the workspace', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-kit-service-campaign-'))
    const outsideRoot = mkdtempSync(join(tmpdir(), 'release-kit-service-outside-'))
    workspaces.set('campaign-1', {
      id: 'campaign-1', name: 'Campaign', rootPath: campaignRoot, artistWorkspaceScope: 'campaign',
    })
    const source = join(campaignRoot, 'cover.png')
    writeFileSync(source, 'registered')
    const asset = importMissionAssets(campaignRoot, 'campaign-1', [source], { kindHint: 'cover-art' }).imported[0]!
    expect(asset.relativePath).toBeTruthy()
    const registeredPath = join(campaignRoot, asset.relativePath!)
    const outsidePath = join(outsideRoot, 'outside.png')
    writeFileSync(outsidePath, 'outside')
    rmSync(registeredPath)
    symlinkSync(outsidePath, registeredPath)

    expect(() => service().promote('campaign-1', {
      source: { type: 'campaign-asset', assetId: asset.id },
      category: 'artwork', subtype: 'cover-art',
    }, 'user')).toThrow(/symbolic link/i)
  })

  test('fails closed when an approved snapshot changes before agent retrieval', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-kit-service-campaign-'))
    workspaces.set('campaign-1', {
      id: 'campaign-1', name: 'Campaign', rootPath: campaignRoot, artistWorkspaceScope: 'campaign',
    })
    const source = join(campaignRoot, 'cover.png')
    writeFileSync(source, 'cover-a')
    const asset = importMissionAssets(campaignRoot, 'campaign-1', [source], { kindHint: 'cover-art' }).imported[0]!
    const releaseKit = service()
    const promoted = releaseKit.promote('campaign-1', {
      source: { type: 'campaign-asset', assetId: asset.id },
      category: 'artwork', subtype: 'cover-art', makePrimary: true,
    }, 'user')
    const snapshot = resolveReleaseKitItemPath(campaignRoot, promoted.item.relativePath)
    writeFileSync(snapshot, 'cover-b')

    expect(() => releaseKit.getItem('campaign-1', promoted.item.id)).toThrow(/integrity verification/i)
    expect(releaseKit.get('campaign-1').items[0]?.status).toBe('ready')
    expect(releaseKit.verify('campaign-1').manifest.items[0]?.status).toBe('needs-review')
  })

  test('reports a successful promotion and durably marks context for repair when context sync fails', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-kit-service-campaign-'))
    workspaces.set('campaign-1', {
      id: 'campaign-1', name: 'Campaign', rootPath: campaignRoot, artistWorkspaceScope: 'campaign',
    })
    const source = join(campaignRoot, 'master.wav')
    writeFileSync(source, 'master')
    const asset = importMissionAssets(campaignRoot, 'campaign-1', [source], { kindHint: 'master' }).imported[0]!
    const blockedContextPath = join(campaignRoot, 'context', 'release-kit')
    mkdirSync(join(campaignRoot, 'context'), { recursive: true })
    writeFileSync(blockedContextPath, 'blocked')

    const releaseKit = service()
    const promoted = releaseKit.promote('campaign-1', {
      source: { type: 'campaign-asset', assetId: asset.id },
      category: 'audio', subtype: 'master',
    }, 'user')
    const marker = join(campaignRoot, 'release-kit', '.context-sync-pending.json')
    expect(promoted.item.status).toBe('ready')
    expect(existsSync(marker)).toBe(true)

    rmSync(blockedContextPath, { force: true })
    releaseKit.verify('campaign-1')
    expect(existsSync(marker)).toBe(false)
    expect(existsSync(join(campaignRoot, 'context', 'release-kit', 'CONTEXT.md'))).toBe(true)
  })

  test('keeps reads available while denying every mutation without files.write', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-kit-service-campaign-'))
    workspaces.set('campaign-1', {
      id: 'campaign-1', name: 'Campaign', rootPath: campaignRoot, artistWorkspaceScope: 'campaign',
    })
    const source = join(campaignRoot, 'master.wav')
    writeFileSync(source, 'master')
    const asset = importMissionAssets(campaignRoot, 'campaign-1', [source], { kindHint: 'master' }).imported[0]!
    const writable = service()
    const promoted = writable.promote('campaign-1', {
      source: { type: 'campaign-asset', assetId: asset.id }, category: 'audio', subtype: 'master',
    }, 'user')
    const readOnly = new ReleaseKitService({
      getWorkspaceByNameOrId: (id) => workspaces.get(id) as never,
      assertWritePermission: () => { throw new Error('files.write denied') },
    })
    expect(readOnly.get('campaign-1').items).toHaveLength(1)
    expect(readOnly.getItem('campaign-1', promoted.item.id).item.id).toBe(promoted.item.id)
    expect(() => readOnly.setPrimary('campaign-1', promoted.item.id)).toThrow(/files.write denied/i)
    expect(() => readOnly.verify('campaign-1')).toThrow(/files.write denied/i)
    expect(() => readOnly.remove('campaign-1', promoted.item.id)).toThrow(/files.write denied/i)
  })

  test('fails visibly when the legacy Finals registry is malformed', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-kit-service-campaign-'))
    workspaces.set('campaign-1', {
      id: 'campaign-1', name: 'Campaign', rootPath: campaignRoot, artistWorkspaceScope: 'campaign',
    })
    upsertContextDoc(campaignRoot, {
      slug: 'finals',
      metadata: { name: 'Finals', routing: { mode: 'broadcast' }, enabled: true },
      body: '{"schemaVersion":1,"finals":"broken"}',
    })

    expect(() => service().migrateLegacy('campaign-1')).toThrow(/Finals registry is invalid/i)
  })

  test('does not resurrect a removed legacy Final on later migration', async () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-kit-service-campaign-'))
    workspaces.set('campaign-1', {
      id: 'campaign-1', name: 'Campaign', rootPath: campaignRoot, artistWorkspaceScope: 'campaign',
    })
    const outputs = new OutputService({ getWorkspaceRootPath: () => campaignRoot })
    const created = await outputs.createFromSessionTool({
      workspaceId: 'campaign-1', sessionId: 'session-1',
      output: { title: 'Final plan', kind: 'document', summary: 'Approved campaign plan.', content: '# Final plan' },
    })
    expect(created.ok).toBe(true)
    const output = outputs.get('campaign-1', created.outputId!)!
    const asset = output.primary ?? output.assets[0]!
    writeOutputFinalsRegistry(campaignRoot, {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      finals: [{
        id: 'legacy-final-1', scope: 'campaign', campaignId: 'campaign-1', slot: 'Marketing Plan',
        outputId: output.id, assetId: asset.id, isPrimary: true,
        promotedAt: new Date().toISOString(), promotedBy: 'user',
      }],
    })
    const releaseKit = service()
    const first = releaseKit.migrateLegacy('campaign-1')
    expect(first.migrated).toBe(1)
    const itemId = first.manifest.items[0]!.id
    // Simulate a crash after manifest persistence but before the migration ledger write.
    rmSync(join(campaignRoot, 'release-kit', '.legacy-migration.json'), { force: true })
    releaseKit.remove('campaign-1', itemId)
    const second = releaseKit.migrateLegacy('campaign-1')
    expect(second.migrated).toBe(0)
    expect(second.manifest.items).toHaveLength(0)
  })

  test('refuses to remove an item still bound to scheduled work and its calendar shell', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-kit-service-campaign-'))
    workspaces.set('campaign-1', {
      id: 'campaign-1', name: 'Campaign', rootPath: campaignRoot, artistWorkspaceScope: 'campaign',
    })
    const source = join(campaignRoot, 'teaser.mp4')
    writeFileSync(source, 'video')
    const asset = importMissionAssets(campaignRoot, 'campaign-1', [source], { kindHint: 'any' }).imported[0]!
    const releaseKit = service()
    const promoted = releaseKit.promote('campaign-1', {
      source: { type: 'campaign-asset', assetId: asset.id }, category: 'video', subtype: 'teaser',
    }, 'user')
    const ref = { kind: 'release-kit' as const, itemId: promoted.item.id, sha256: promoted.item.sha256, label: promoted.item.title }
    const order: ScheduledWorkOrder = {
      version: 1, id: 'work-1', owner: { scope: 'campaign', workspaceId: 'campaign-1', campaignId: 'campaign-1' },
      calendarLink: { calendar: 'campaign', itemId: 'item-1' }, title: 'Publish teaser', type: 'social-publish', status: 'scheduled',
      startAt: '2026-09-01T15:00:00.000Z', timezone: 'America/Chicago',
      execution: { type: 'social-publish', platform: 'instagram', profileId: 'artist', caption: 'Out now.' },
      inputRefs: [ref], approvals: [], runs: [], executionKey: { payloadDigest: 'digest', idempotencyKey: 'key' },
      createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T00:00:00.000Z',
    }
    const item = createCampaignCalendarItem({
      id: 'item-1', campaignId: 'campaign-1', date: '2026-09-01', time: '10:00', timezone: 'America/Chicago',
      title: order.title, kind: 'scheduled-job', scheduledWorkId: order.id,
      releaseKitRefs: [{ itemId: ref.itemId, sha256: ref.sha256, label: ref.label }],
    })
    upsertContextDoc(campaignRoot, { slug: 'scheduled-work', metadata: { name: 'Scheduled Work', routing: { mode: 'broadcast' }, enabled: true }, body: serializeScheduledWorkBody({ version: 1, workspaceId: 'campaign-1', items: [order], updatedAt: order.updatedAt }) })
    upsertContextDoc(campaignRoot, { slug: 'campaign-calendar', metadata: { name: 'Campaign Calendar', routing: { mode: 'broadcast' }, enabled: true }, body: serializeCampaignCalendarBody({ version: 1, campaignId: 'campaign-1', items: [item], updatedAt: item.updatedAt }) })

    expect(() => releaseKit.remove('campaign-1', promoted.item.id)).toThrow(/still referenced/i)
    expect(releaseKit.get('campaign-1').items.some((candidate) => candidate.id === promoted.item.id)).toBe(true)
  })
})
