import { beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importArtistVaultAssets, loadArtistVaultManifest, updateArtistVaultAsset, saveArtistVaultTrackDraft, reviewArtistVaultTrackIntelligence } from '@craft-agent/shared/artist-vault'
import { importMissionAssets, saveMissionLyricsAsync } from '@craft-agent/shared/mission-assets'
import { resolveReleaseKitItemPath, loadReleaseKitManifest, saveReleaseKitManifest } from '@craft-agent/shared/release-kit'
import { writeOutputFinalsRegistry } from '@craft-agent/shared/outputs'
import { loadContextDoc, upsertContextDoc } from '@craft-agent/shared/workspace-context'
import { createCampaignCalendarItem, parseCampaignCalendarDocResult, serializeCampaignCalendarBody } from '@craft-agent/shared/campaign-calendar'
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
    getWorkspaces: () => [...workspaces.values()] as never,
    getWorkspaceByNameOrId: (id) => workspaces.get(id) as never,
    assertWritePermission: () => {},
  })
}

describe('ReleaseKitService source trust', () => {
  test('snapshots one exact HQ Output asset into a Campaign Release Kit', async () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-kit-service-campaign-'))
    const hqRoot = mkdtempSync(join(tmpdir(), 'release-kit-service-hq-'))
    workspaces.set('campaign-1', { id: 'campaign-1', name: 'Campaign', rootPath: campaignRoot, artistWorkspaceScope: 'campaign' })
    workspaces.set('hq-1', { id: 'hq-1', name: 'Artist HQ', rootPath: hqRoot, artistWorkspaceScope: 'hq' })
    const sourcePath = join(hqRoot, 'hq-variant.mp4')
    writeFileSync(sourcePath, 'hq-video-variant')
    const outputs = new OutputService({ getWorkspaceRootPath: (id) => workspaces.get(id)!.rootPath })
    const created = await outputs.createFromSessionTool({
      workspaceId: 'hq-1',
      sessionId: 'editor-1',
      output: { title: 'HQ Variant', kind: 'video', summary: 'Ready cut.', files: [{ path: sourcePath, role: 'primary' }] },
    })
    expect(created.ok).toBe(true)
    const output = outputs.get('hq-1', created.outputId!)!
    const asset = output.primary ?? output.assets[0]!

    const promoted = service().promote('campaign-1', {
      source: { type: 'output', outputId: output.id, assetId: asset.id, sourceWorkspaceId: 'hq-1' },
      category: 'video',
      subtype: 'social-variant',
    }, 'user')

    expect(promoted.item.source).toEqual({ type: 'output', outputId: output.id, assetId: asset.id, sourceWorkspaceId: 'hq-1' })
    expect(readFileSync(resolveReleaseKitItemPath(campaignRoot, promoted.item.relativePath), 'utf8')).toBe('hq-video-variant')

    writeFileSync(outputs.resolveAssetPath('hq-1', output.id, asset.path), 'drifted-output')
    expect(() => service().promote('campaign-1', {
      source: { type: 'output', outputId: output.id, assetId: asset.id, sourceWorkspaceId: 'hq-1' },
      category: 'video', subtype: 'social-variant',
    }, 'user')).toThrow(/changed after it was created/i)
  })

  test('promotes a registered Campaign Asset with reviewed Track Intelligence into an independent snapshot', async () => {
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
    await saveMissionLyricsAsync(campaignRoot, 'campaign-1', {
      sourceAudioAssetId: asset.id,
      lyricsText: 'drive all night',
      lyricLines: [{ text: 'drive all night', start_time: 0, end_time: 2.4 }],
      character: { genre: ['alt-pop'], tempoBpm: 92, themes: ['escape'] },
    }, 'client-1')

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
    expect(result.item.trackIntelligence).toMatchObject({
      lyrics: { lines: [{ text: 'drive all night' }] },
      character: { genre: ['alt-pop'], tempoBpm: 92 },
      reviewedBy: { type: 'user', clientId: 'client-1' },
    })
  })

  test('withholds Track Intelligence from list reads when snapshot bytes change', async () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-kit-service-campaign-'))
    workspaces.set('campaign-1', {
      id: 'campaign-1', name: 'Campaign', rootPath: campaignRoot, artistWorkspaceScope: 'campaign',
    })
    const source = join(campaignRoot, 'listed-master.wav')
    writeFileSync(source, 'master-v1')
    const asset = importMissionAssets(campaignRoot, 'campaign-1', [source], { kindHint: 'master' }).imported[0]!
    await saveMissionLyricsAsync(campaignRoot, 'campaign-1', {
      sourceAudioAssetId: asset.id,
      lyricsText: 'do not serve after drift',
    }, 'client-1')
    const releaseKit = service()
    const promoted = releaseKit.promote('campaign-1', {
      source: { type: 'campaign-asset', assetId: asset.id },
      category: 'audio',
      subtype: 'master',
    }, 'user')
    writeFileSync(resolveReleaseKitItemPath(campaignRoot, promoted.item.relativePath), 'master-v2')

    const listed = releaseKit.get('campaign-1').items[0]

    expect(listed?.status).toBe('needs-review')
    expect(listed?.trackIntelligence).toBeUndefined()
    expect(loadContextDoc(campaignRoot, 'release-kit')?.body).not.toContain('do not serve after drift')
  })

  test('refuses to pair approved lyrics with campaign audio bytes changed afterward', async () => {
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
    await saveMissionLyricsAsync(campaignRoot, 'campaign-1', {
      sourceAudioAssetId: asset.id,
      lyricsText: 'approved against v1',
    }, 'client-1')
    writeFileSync(join(campaignRoot, asset.relativePath!), 'master-v2')

    expect(() => service().promote('campaign-1', {
      source: { type: 'campaign-asset', assetId: asset.id },
      category: 'audio',
      subtype: 'master',
    }, 'user')).toThrow(/audio changed after its lyrics were approved/i)
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
    expect(releaseKit.get('campaign-1').items[0]?.status).toBe('needs-review')
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
    expect(releaseKit.refreshAgentContext('campaign-1').contextPersisted).toBe(false)

    rmSync(blockedContextPath, { force: true })
    releaseKit.verify('campaign-1')
    expect(existsSync(marker)).toBe(false)
    expect(existsSync(join(campaignRoot, 'context', 'release-kit', 'CONTEXT.md'))).toBe(true)
  })

  test('keeps reads available while denying every mutation without files.write', async () => {
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
      getWorkspaces: () => [...workspaces.values()] as never,
    getWorkspaceByNameOrId: (id) => workspaces.get(id) as never,
      assertWritePermission: () => { throw new Error('files.write denied') },
    })
    expect(readOnly.get('campaign-1').items).toHaveLength(1)
    expect(readOnly.getItem('campaign-1', promoted.item.id).item.id).toBe(promoted.item.id)
    expect(readOnly.listUses('campaign-1', promoted.item.id)).toEqual([])
    expect(() => readOnly.setPrimary('campaign-1', promoted.item.id)).toThrow(/files.write denied/i)
    await expect(readOnly.updateUsage('campaign-1', promoted.item.id, { notes: 'For launch week.' })).rejects.toThrow(/files.write denied/i)
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

  for (const existingSubtype of ['cover-art', 'press-art', undefined]) {
    test(`migration preserves primary choices with existing ${existingSubtype ?? 'no artwork'}`, async () => {
      const campaignRoot = mkdtempSync(join(tmpdir(), 'release-kit-primary-migration-'))
      try {
        workspaces.set('campaign-1', {
          id: 'campaign-1', name: 'Campaign', rootPath: campaignRoot, artistWorkspaceScope: 'campaign',
        })
        const releaseKit = service()
        let existingId: string | undefined
        if (existingSubtype) {
          const uploadPath = join(campaignRoot, 'current-art.png')
          writeFileSync(uploadPath, 'current user artwork')
          existingId = releaseKit.promote('campaign-1', {
            source: { type: 'upload', originalFileName: 'current-art.png' }, uploadPath,
            category: 'artwork', subtype: existingSubtype, makePrimary: true,
          }, 'user').item.id
        }
        const outputs = new OutputService({ getWorkspaceRootPath: () => campaignRoot })
        const finals = []
        // Different legacy slots collapse into the same Release Kit placement.
        for (const [index, slot] of ['Cover Art', 'Single Artwork'].entries()) {
          const path = join(campaignRoot, `legacy-${index}.png`)
          writeFileSync(path, `legacy artwork ${index}`)
          const created = await outputs.createFromSessionTool({
            workspaceId: 'campaign-1', sessionId: 'session-1',
            output: { title: `Legacy ${index}`, kind: 'image', summary: 'Legacy artwork', files: [{ path, role: 'primary' }] },
          })
          expect(created.ok).toBe(true)
          const output = outputs.get('campaign-1', created.outputId!)!
          const asset = output.primary ?? output.assets[0]!
          finals.push({
            id: `legacy-${index}`, scope: 'campaign' as const, campaignId: 'campaign-1', slot,
            outputId: output.id, assetId: asset.id, isPrimary: true,
            promotedAt: '2025-01-01T00:00:00.000Z', promotedBy: 'user' as const,
          })
        }
        writeOutputFinalsRegistry(campaignRoot, { schemaVersion: 1, updatedAt: new Date().toISOString(), finals })
        const first = releaseKit.migrateLegacy('campaign-1')
        expect(first.migrated).toBe(2)
        expect(first.skipped).toEqual([])
        const imported = first.manifest.items.filter((item) => item.source.type === 'legacy-final')
        expect(imported.map((item) => item.isPrimary)).toEqual([existingSubtype !== 'cover-art', false])
        if (existingId) {
          const existing = first.manifest.items.find((item) => item.id === existingId)!
          expect(existing.isPrimary).toBe(true)
          expect(readFileSync(resolveReleaseKitItemPath(campaignRoot, existing.relativePath), 'utf8')).toBe('current user artwork')
        }
        expect(releaseKit.migrateLegacy('campaign-1').migrated).toBe(0)
        // A later explicit selection also survives recovery when the ledger write was lost.
        const chosen = imported[1]!
        releaseKit.setPrimary('campaign-1', chosen.id)
        rmSync(join(campaignRoot, 'release-kit', '.legacy-migration.json'), { force: true })
        const recovered = releaseKit.migrateLegacy('campaign-1')
        expect(recovered.migrated).toBe(0)
        expect(recovered.manifest.items).toHaveLength(existingId ? 3 : 2)
        expect(recovered.manifest.items.filter((item) => item.subtype === 'cover-art' && item.isPrimary).map((item) => item.id)).toEqual([chosen.id])
        expect(releaseKit.migrateLegacy('campaign-1').migrated).toBe(0)
      } finally {
        rmSync(campaignRoot, { recursive: true, force: true })
      }
    })
  }

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

  test('refuses to remove an item still bound to scheduled work and its calendar shell', async () => {
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

    expect(releaseKit.listUses('campaign-1', promoted.item.id)).toMatchObject([{
      orderId: 'work-1',
      calendarItemId: 'item-1',
      platform: 'instagram',
      profileId: 'artist',
      status: 'scheduled',
    }])
    await releaseKit.updateUsage('campaign-1', promoted.item.id, { restrictions: { blockedFromUse: true } })
    expect(releaseKit.listUses('campaign-1', promoted.item.id)).toMatchObject([{
      orderId: 'work-1', status: 'needs-attention', attentionMessage: expect.stringContaining('now restricted'),
    }])
    const reconciledCalendar = parseCampaignCalendarDocResult(loadContextDoc(campaignRoot, 'campaign-calendar') ?? undefined, 'campaign-1')
    expect(reconciledCalendar.ok).toBe(true)
    expect(reconciledCalendar.calendar.items[0]?.status).toBe('failed')
    expect(() => releaseKit.remove('campaign-1', promoted.item.id)).toThrow(/still referenced/i)
    expect(releaseKit.get('campaign-1').items.some((candidate) => candidate.id === promoted.item.id)).toBe(true)
  })

  test('updates bounded usage metadata and mirrors it into campaign context', async () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'release-kit-service-campaign-'))
    workspaces.set('campaign-1', {
      id: 'campaign-1', name: 'Campaign', rootPath: campaignRoot, artistWorkspaceScope: 'campaign',
    })
    const source = join(campaignRoot, 'cover.png')
    writeFileSync(source, 'cover')
    const asset = importMissionAssets(campaignRoot, 'campaign-1', [source], { kindHint: 'cover-art' }).imported[0]!
    const releaseKit = service()
    const promoted = releaseKit.promote('campaign-1', {
      source: { type: 'campaign-asset', assetId: asset.id }, category: 'artwork', subtype: 'cover-art',
    }, 'user')

    const manifest = await releaseKit.updateUsage('campaign-1', promoted.item.id, {
      bestFor: ['social', 'press'],
      contentRating: 'clean',
      notes: 'Use the square crop on release day.',
      restrictions: { needsRightsClearance: true },
    })

    expect(manifest.items[0]?.usage).toMatchObject({
      bestFor: ['social', 'press'],
      contentRating: 'clean',
      notes: 'Use the square crop on release day.',
      restrictions: { blockedFromUse: false, needsRightsClearance: true, artistLikenessRestricted: false },
      updatedBy: 'user',
    })
    expect(readFileSync(join(campaignRoot, 'context', 'release-kit', 'CONTEXT.md'), 'utf8')).toContain('needsRightsClearance')
  })
})

test('observer failure does not turn a persisted Release Kit promotion into failure', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-kit-observer-'))
  try {
    const kit = new ReleaseKitService({
      getWorkspaceByNameOrId: () => ({ id: 'campaign', name: 'Campaign', rootPath: root, artistWorkspaceScope: 'campaign' }) as never,
      assertWritePermission: () => {},
      onChanged: () => { throw new Error('renderer disconnected') },
    })
    const source = join(root, 'master.wav')
    writeFileSync(source, 'audio fixture')
    const result = kit.promote('campaign', {
      source: { type: 'upload', originalFileName: 'master.wav' }, uploadPath: source,
      category: 'audio', subtype: 'master',
    }, 'user')
    expect(result.item.status).toBe('ready')
    expect(loadContextDoc(root, 'release-kit')?.body).toContain(result.item.id)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('unchanged kit reads do not refresh briefs but missing files do', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-kit-refresh-'))
  try {
    const changes: boolean[] = []
    const kit = new ReleaseKitService({
      getWorkspaceByNameOrId: () => ({ id: 'campaign', name: 'Campaign', rootPath: root, artistWorkspaceScope: 'campaign' }) as never,
      assertWritePermission: () => {},
      onChanged: (_id, _manifest, changed) => changes.push(changed),
    })
    const source = join(root, 'master.wav')
    writeFileSync(source, 'audio fixture')
    const result = kit.promote('campaign', {
      source: { type: 'upload', originalFileName: 'master.wav' }, uploadPath: source,
      category: 'audio', subtype: 'master',
    }, 'user')
    kit.get('campaign')
    kit.get('campaign')
    expect(changes).toEqual([true, false, false])
    rmSync(resolveReleaseKitItemPath(root, result.item.relativePath))
    expect(kit.get('campaign').items[0]?.status).toBe('missing')
    expect(changes).toEqual([true, false, false, true])
    kit.get('campaign')
    expect(changes.at(-1)).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('Release Kit audio intake', () => {
  test('uploads master into HQ Vault and reuses exact existing audio for later lyric approval', async () => {
    const root = mkdtempSync(join(tmpdir(), 'release-audio-intake-'))
    const hq = join(root, 'hq'); mkdirSync(hq)
    workspaces.set('hq-1', { id: 'hq-1', name: 'HQ', rootPath: hq, artistWorkspaceScope: 'hq' })
    workspaces.set('campaign-1', { id: 'campaign-1', name: 'Campaign', rootPath: root, artistWorkspaceScope: 'campaign' })
    try {
      const path = join(root, 'final.wav')
      writeFileSync(path, 'audio bytes')
      const input = { source: { type: 'upload' as const, originalFileName: 'final.wav' }, uploadPath: path, category: 'audio' as const, subtype: 'master' }
      const first = await service().promoteUserUpload('campaign-1', input)
      const second = await service().promoteUserUpload('campaign-1', input)
      expect(first.item.source.type).toBe('vault-asset')
      expect(second.item.source).toEqual(first.item.source)
      expect(second.item.id).toBe(first.item.id)
      expect(second.manifest.items).toHaveLength(1)
      expect(first.item.trackIntelligence).toBeUndefined()
      const manifest = loadArtistVaultManifest(hq, 'hq-1')
      expect(manifest.assets).toHaveLength(1)
      expect(manifest.assets[0]!.kind).toBe('master-final')
      expect(manifest.assets[0]!.sha256).toBe(first.item.sha256)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  test('does not reuse drifted campaign audio or route artwork through audio intake', async () => {
    const root = mkdtempSync(join(tmpdir(), 'release-audio-drift-'))
    const hq = join(root, 'hq'); mkdirSync(hq)
    workspaces.set('hq-1', { id: 'hq-1', name: 'HQ', rootPath: hq, artistWorkspaceScope: 'hq' })
    workspaces.set('campaign-1', { id: 'campaign-1', name: 'Campaign', rootPath: root, artistWorkspaceScope: 'campaign' })
    try {
      const path = join(root, 'final.wav')
      writeFileSync(path, 'audio bytes')
      const imported = importMissionAssets(root, 'campaign-1', [path], { kindHint: 'master' }).imported[0]!
      writeFileSync(join(root, imported.relativePath!), 'modified bytes')
      const result = await service().promoteUserUpload('campaign-1', { source: { type: 'upload', originalFileName: 'final.wav' }, uploadPath: path, category: 'audio', subtype: 'master' })
      expect(result.item.source).not.toEqual({ type: 'campaign-asset', assetId: imported.id })
      const art = join(root, 'cover.png')
      writeFileSync(art, 'image')
      const picture = await service().promoteUserUpload('campaign-1', { source: { type: 'upload', originalFileName: 'cover.png' }, uploadPath: art, category: 'artwork', subtype: 'cover' })
      expect(picture.item.source.type).toBe('upload')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})

test('HQ master reuse preserves approved lyrics; later approval refreshes same-byte campaign context', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hq-master-review-'))
  const hq = join(root, 'hq'); mkdirSync(hq)
  workspaces.set('campaign-1', { id: 'campaign-1', name: 'Campaign', rootPath: root, artistWorkspaceScope: 'campaign' })
  workspaces.set('hq-1', { id: 'hq-1', name: 'HQ', rootPath: hq, artistWorkspaceScope: 'hq' })
  try {
    const path = join(root, 'master.wav'); writeFileSync(path, 'master bytes')
    const audio = importArtistVaultAssets(hq, 'hq-1', [path], { kindHint: 'master-final' }).imported[0]!
    const draft = { id: 'draft-1', lyrics: { lines: [{ id: 'line-1', text: 'original lyric' }], timingSource: 'manual' as const, timingStatus: 'needs-alignment' as const }, provenance: { sourceSha256: audio.sha256 } }
    saveArtistVaultTrackDraft(hq, 'hq-1', audio.id, { status: 'draft', schemaVersion: 1, draft })
    const kit = service()
    const result = await kit.promoteUserUpload('campaign-1', { source: { type: 'upload', originalFileName: 'master.wav' }, uploadPath: path, category: 'audio', subtype: 'master' })
    expect(result.item.source).toEqual({ type: 'vault-asset', assetId: audio.id, vaultWorkspaceId: 'hq-1' })
    expect(loadArtistVaultManifest(hq, 'hq-1').assets).toHaveLength(1)
    expect(loadArtistVaultManifest(hq, 'hq-1').assets[0]!.trackIntelligence?.draft?.id).toBe('draft-1')
    reviewArtistVaultTrackIntelligence(hq, 'hq-1', { assetId: audio.id, draftId: draft.id, lyrics: { ...draft.lyrics, lines: [{ id: 'line-1', text: 'artist approved lyric' }] } }, 'artist')
    expect(kit.getItem('campaign-1', result.item.id).item.trackIntelligence?.lyrics?.lines[0]!.text).toBe('artist approved lyric')
    kit.refreshAgentContext('campaign-1')
    expect(loadContextDoc(root, 'release-kit')?.body).toContain('\"hasLyrics\": true')
    const again = await kit.promoteUserUpload('campaign-1', { source: { type: 'upload', originalFileName: 'master.wav' }, uploadPath: path, category: 'audio', subtype: 'master' })
    expect(again.item.trackIntelligence?.reviewedBy.clientId).toBe('artist')
    updateArtistVaultAsset(hq, 'hq-1', audio.id, { rightsStatus: 'private' })
    expect(kit.getItem('campaign-1', result.item.id).item.trackIntelligence).toBeUndefined()
    await expect(kit.promoteUserUpload('campaign-1', { source: { type: 'upload', originalFileName: 'master.wav' }, uploadPath: path, category: 'audio', subtype: 'master' })).rejects.toThrow(/private/i)
    expect(loadArtistVaultManifest(hq, 'hq-1').assets).toHaveLength(1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('missing or ambiguous HQ refuses audio intake before creating any files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hq-master-missing-'))
  workspaces.set('campaign-1', { id: 'campaign-1', name: 'Campaign', rootPath: root, artistWorkspaceScope: 'campaign' })
  try {
    const path = join(root, 'master.wav'); writeFileSync(path, 'audio')
    const input = { source: { type: 'upload' as const, originalFileName: 'master.wav' }, uploadPath: path, category: 'audio' as const, subtype: 'master' }
    await expect(service().promoteUserUpload('campaign-1', input)).rejects.toThrow(/set up Artist HQ/i)
    workspaces.set('hq-1', { id: 'hq-1', name: 'HQ', rootPath: join(root, 'one'), artistWorkspaceScope: 'hq' })
    workspaces.set('hq-2', { id: 'hq-2', name: 'HQ2', rootPath: join(root, 'two'), artistWorkspaceScope: 'hq' })
    await expect(service().promoteUserUpload('campaign-1', input)).rejects.toThrow(/multiple/i)
    expect(existsSync(join(root, 'vault'))).toBe(false)
    expect(existsSync(join(root, 'assets'))).toBe(false)
    expect(existsSync(join(root, 'release-kit'))).toBe(false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('copies exact campaign approval to new HQ master and retries do not duplicate finals', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hq-master-campaign-review-'))
  const hq = join(root, 'hq'); mkdirSync(hq)
  workspaces.set('campaign-1', { id: 'campaign-1', name: 'Campaign', rootPath: root, artistWorkspaceScope: 'campaign' })
  workspaces.set('hq-1', { id: 'hq-1', name: 'HQ', rootPath: hq, artistWorkspaceScope: 'hq' })
  try {
    const path = join(root, 'master.wav'); writeFileSync(path, 'master bytes')
    const audio = importMissionAssets(root, 'campaign-1', [path], { kindHint: 'master' }).imported[0]!
    await saveMissionLyricsAsync(root, 'campaign-1', { sourceAudioAssetId: audio.id, lyricsText: 'existing approved lyric' }, 'artist')
    const kit = service()
    const input = { source: { type: 'upload' as const, originalFileName: 'master.wav' }, uploadPath: path, category: 'audio' as const, subtype: 'master', title: 'Homebody' }
    const first = await kit.promoteUserUpload('campaign-1', input)
    const again = await kit.promoteUserUpload('campaign-1', { ...input, makePrimary: true })
    expect(again.item.id).toBe(first.item.id)
    expect(again.item.isPrimary).toBe(true)
    expect(again.manifest.items).toHaveLength(1)
    const master = loadArtistVaultManifest(hq, 'hq-1').assets[0]!
    expect(master.label).toBe('Homebody')
    expect(master.trackIntelligence?.approved?.lyrics?.lines[0]?.text).toBe('existing approved lyric')
    expect(master.trackIntelligence?.approved?.reviewedBy.clientId).toBe('artist')
    updateArtistVaultAsset(hq, 'hq-1', master.id, { rightsStatus: 'needs-clearance' })
    const variant = kit.promote('campaign-1', { source: { type: 'vault-asset', assetId: master.id, vaultWorkspaceId: 'hq-1' }, category: 'audio', subtype: 'clean-version', title: 'Clean' }, 'user')
    expect(variant.item.usage.restrictions.needsRightsClearance).toBe(true)
    expect(variant.manifest.items.filter(item => item.category === 'audio')).toHaveLength(1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('Final Audio replacement preserves old bytes, updates one slot, and failures retain current final', () => {
  const root = mkdtempSync(join(tmpdir(), 'single-final-audio-'))
  workspaces.set('campaign-1', { id: 'campaign-1', name: 'Campaign', rootPath: root, artistWorkspaceScope: 'campaign' })
  try {
    const path = join(root, 'master.wav'); writeFileSync(path, 'original')
    const kit = service()
    const first = kit.promote('campaign-1', { source: { type: 'upload', originalFileName: 'master.wav' }, uploadPath: path, category: 'audio', subtype: 'master' }, 'user')
    const original = resolveReleaseKitItemPath(root, first.item.relativePath)
    writeFileSync(path, 'replacement')
    const campaignAsset = importMissionAssets(root, 'campaign-1', [path], { kindHint: 'master' }).imported[0]!
    const replacement = { source: { type: 'campaign-asset' as const, assetId: campaignAsset.id }, category: 'audio' as const, subtype: 'clean-version', title: 'Updated master' }
    const second = kit.promote('campaign-1', replacement, 'agent')
    expect(second.manifest.items.filter(item => item.category === 'audio')).toHaveLength(1)
    expect(second.item.id).not.toBe(first.item.id)
    expect(readFileSync(original, 'utf8')).toBe('original')
    expect(readFileSync(join(root, 'release-kit', '.replaced-audio.json'), 'utf8')).toContain(first.item.id)
    expect(kit.promote('campaign-1', replacement, 'agent').item.id).toBe(second.item.id)
    expect(() => kit.promote('campaign-1', { ...replacement, source: { type: 'campaign-asset', assetId: 'missing' } }, 'agent')).toThrow()
    expect(kit.get('campaign-1').items[0]!.id).toBe(second.item.id)
    const calendarItem = createCampaignCalendarItem({ id: 'future-use', campaignId: 'campaign-1', date: '2026-10-01', title: 'Use this exact master', kind: 'manual', releaseKitRefs: [{ itemId: second.item.id, sha256: second.item.sha256, label: second.item.title }] })
    upsertContextDoc(root, { slug: 'campaign-calendar', metadata: { name: 'Calendar', enabled: true, routing: { mode: 'broadcast' } }, body: serializeCampaignCalendarBody({ version: 1, campaignId: 'campaign-1', items: [calendarItem], updatedAt: calendarItem.updatedAt }) })
    expect(() => kit.promote('campaign-1', { ...replacement, title: 'Another' }, 'user')).toThrow(/referenced/i)
    expect(loadReleaseKitManifest(root, 'campaign-1').items[0]!.id).toBe(second.item.id)
    expect(readFileSync(original, 'utf8')).toBe('original')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('legacy multiple audio slots collapse to valid primary and archived files never reappear on removal', () => {
  const root = mkdtempSync(join(tmpdir(), 'single-audio-legacy-'))
  workspaces.set('campaign-1', { id: 'campaign-1', name: 'Campaign', rootPath: root, artistWorkspaceScope: 'campaign' })
  try {
    const path = join(root, 'master.wav'); writeFileSync(path, 'original')
    const kit = service()
    const first = kit.promote('campaign-1', { source: { type: 'upload', originalFileName: 'master.wav' }, uploadPath: path, category: 'audio', subtype: 'master' }, 'user')
    writeFileSync(path, 'new')
    const second = kit.promote('campaign-1', { source: { type: 'upload', originalFileName: 'master.wav' }, uploadPath: path, category: 'audio', subtype: 'master' }, 'user')
    saveReleaseKitManifest(root, { ...second.manifest, items: [{ ...first.item, isPrimary: true }, { ...second.item, isPrimary: false }] })
    expect(kit.get('campaign-1').items.map(item => item.id)).toEqual([first.item.id])
    expect(existsSync(resolveReleaseKitItemPath(root, second.item.relativePath))).toBe(true)
    kit.remove('campaign-1', first.item.id)
    expect(kit.get('campaign-1').items).toHaveLength(0)
    expect(kit.migrateLegacy('campaign-1').manifest.items).toHaveLength(0)
    saveReleaseKitManifest(root, { ...second.manifest, items: [{ ...first.item, isPrimary: true }, { ...second.item, isPrimary: false }] })
    expect(kit.get('campaign-1').items.map(item => item.id)).toEqual([second.item.id])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
