import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { materializeReleaseKitItem, resolveReleaseKitItemPath, updateReleaseKitItemUsage } from '@craft-agent/shared/release-kit'
import type { ScheduledSocialApproval, ScheduledSocialActionPreview, ScheduledWorkOrder } from '@craft-agent/shared/scheduled-work'
import {
  computeScheduledSocialBrowserActionDigest,
  executeScheduledSocialBrowser,
  type ScheduledSocialBrowserPaneManager,
} from '../scheduled-social-browser-executor'

class FakeBrowserPaneManager implements ScheduledSocialBrowserPaneManager {
  readonly mutations: string[] = []
  readonly navigations: string[] = []
  partition = 'persist:social-x-artist-main'
  lastTargetMarker = 'runner-social-caption'
  responses = new Map<string, unknown[]>()
  targets = new Map<string, 'ok' | 'missing' | 'ambiguous'>([
    ['caption', 'ok'], ['upload', 'ok'], ['submit', 'ok'], ['audience', 'ok'], ['visibility', 'ok'],
  ])

  getInstance() { return { currentUrl: 'about:blank', partition: this.partition } }
  createInstance() { return 'social-x-artist-main' }
  focus() {}
  async navigate(_id: string, url: string) { this.navigations.push(url); return { url, title: 'Compose' } }
  async evaluate(_id: string, expression: string) {
    const marker = /runner-social:([^* ]+)/.exec(expression)?.[1] ?? ''
    const queued = this.responses.get(marker)
    if (queued?.length) return queued.shift()
    if (marker.startsWith('target:')) {
      const kind = marker.split(':')[2]!
      this.lastTargetMarker = `runner-social-${kind}`
      return { status: this.targets.get(kind) ?? 'missing' }
    }
    throw new Error(`Unexpected browser evaluation: ${marker}`)
  }
  async getAccessibilitySnapshot() {
    const kind = this.lastTargetMarker.replace('runner-social-', '')
    return { nodes: [{ ref: `@${kind}`, role: kind === 'caption' ? 'textbox' : 'button', name: this.lastTargetMarker }] }
  }
  async fillElement(_id: string, ref: string, value: string) { this.mutations.push(`fill:${ref}:${value}`) }
  async uploadFile(_id: string, ref: string, paths: string[]) { this.mutations.push(`upload:${ref}:${paths.join(',')}`) }
  async clickElement(_id: string, ref: string) { this.mutations.push(`click:${ref}`) }
}

function approvedXTuple(platform = 'x', mediaPath?: string) {
  const order: ScheduledWorkOrder = {
    version: 1,
    id: 'scheduled-x-1',
    owner: { scope: 'campaign', workspaceId: 'campaign-1', campaignId: 'campaign-1' },
    calendarLink: { calendar: 'campaign', itemId: 'calendar-1' },
    title: 'Post teaser',
    type: 'social-publish',
    status: 'scheduled',
    startAt: '2026-07-10T14:00:00.000Z',
    timezone: 'America/Chicago',
    execution: {
      type: 'social-publish',
      platform,
      profileId: 'artist-main',
      caption: 'Out Friday.',
      ...(platform === 'youtube' ? { platformOptions: { postType: 'video', visibility: 'private', madeForKids: 'no' } } : {}),
    },
    inputRefs: [], approvals: [], runs: [],
    executionKey: { payloadDigest: 'payload-1', idempotencyKey: 'idem-1' },
    createdAt: '2026-07-09T00:00:00.000Z',
    updatedAt: '2026-07-09T00:00:00.000Z',
  }
  const dryRun = {
    ok: true,
    status: 'dry_run',
    actionId: 'act_scheduled-x-1',
    platform,
    profile: 'artist-main',
    action: {
      actionId: 'act_scheduled-x-1', verb: 'post', platform, profile: 'artist-main', mode: 'browser',
      payload: {
        text: 'Out Friday.',
        media: mediaPath ? [mediaPath] : [],
        ...(platform === 'youtube' ? { postType: 'video', visibility: 'private', madeForKids: 'no' } : {}),
      },
      options: { dryRun: true, idempotencyKey: 'idem-1' },
    },
    browserPlan: {
      browserSession: {
        kind: 'runneros-electron-partition', platform, profile: 'artist-main',
        instanceId: `social-${platform}-artist-main`, partition: `persist:social-${platform}-artist-main`,
      },
      accountVerification: {
        requiredBeforeLiveSubmit: true, verificationTargetKnown: true, platform, profile: 'artist-main',
        expectedHandle: '@artist-main', expectedAccountUrl: 'https://x.com/artist-main',
      },
    },
  }
  const preview: ScheduledSocialActionPreview = {
    actionId: 'act_scheduled-x-1',
    actionDigest: computeScheduledSocialBrowserActionDigest(dryRun, mediaPath ? 'sha256:test-media' : undefined),
    mediaDigest: mediaPath ? 'sha256:test-media' : undefined,
    platform,
    profileId: 'artist-main',
    preparedAt: '2026-07-09T00:00:00.000Z',
    payloadDigest: 'payload-1',
    dryRun,
  }
  const approval: ScheduledSocialApproval = {
    id: 'approval-1',
    approvedAt: '2026-07-09T00:01:00.000Z',
    expiresAt: '2026-07-09T01:00:00.000Z',
    actionId: preview.actionId,
    actionDigest: preview.actionDigest,
    mediaDigest: preview.mediaDigest,
    payloadDigest: preview.payloadDigest,
    platform,
    profileId: 'artist-main',
    approvedBy: { type: 'user', clientId: 'client-1' },
  }
  return { order, preview, approval }
}

const depsFor = (browserPaneManager: FakeBrowserPaneManager) => ({
  browserPaneManager,
  now: () => new Date('2026-07-09T00:10:00.000Z'),
  successTimeoutMs: 0,
})

describe('executeScheduledSocialBrowser', () => {
  test('rechecks a Release Kit restriction immediately before touching the browser', async () => {
    const root = mkdtempSync(join(tmpdir(), 'release-kit-browser-restriction-'))
    const source = join(root, 'teaser.mp4')
    writeFileSync(source, 'approved-teaser')
    const promoted = materializeReleaseKitItem(root, {
      workspaceId: 'campaign-1', campaignId: 'campaign-1',
      source: { type: 'upload', originalFileName: 'teaser.mp4' }, sourcePath: source,
      category: 'video', subtype: 'teaser', promotedBy: 'user',
    })
    const mediaPath = resolveReleaseKitItemPath(root, promoted.item.relativePath)
    const tuple = approvedXTuple('x', mediaPath)
    tuple.order.inputRefs = [{ kind: 'release-kit', itemId: promoted.item.id, sha256: promoted.item.sha256 }]
    const action = tuple.preview.dryRun.action as { payload: { media: string[] } }
    action.payload.media = [mediaPath]
    updateReleaseKitItemUsage(root, 'campaign-1', 'campaign-1', promoted.item.id, {
      restrictions: { blockedFromUse: true },
    })
    const browser = new FakeBrowserPaneManager()

    await expect(executeScheduledSocialBrowser({ workspaceRootPath: root, ...tuple }, {
      ...depsFor(browser),
      resolveMediaPath: () => mediaPath,
    })).rejects.toThrow(/blocked from use/i)
    expect(browser.navigations).toEqual([])
    expect(browser.mutations).toEqual([])
  })

  test('refuses a wrong visible account before changing the draft', async () => {
    const browser = new FakeBrowserPaneManager()
    browser.responses.set('identity:x', [{ loggedIn: true, candidates: [{ handle: '@wrong-account', accountUrl: 'https://x.com/wrong-account' }] }])
    const tuple = approvedXTuple()

    await expect(executeScheduledSocialBrowser({ workspaceRootPath: '/workspace', ...tuple }, depsFor(browser))).rejects.toThrow(/visible account/i)
    expect(browser.mutations).toEqual([])
  })

  test('refuses a receipt when submit has no positive success evidence', async () => {
    const browser = new FakeBrowserPaneManager()
    browser.responses.set('identity:x', [{ loggedIn: true, candidates: [{ handle: '@artist-main', accountUrl: 'https://x.com/artist-main' }] }])
    browser.responses.set('draft:x', [{ caption: 'Out Friday.', hasMediaPreview: false }])
    browser.responses.set('success:x', [{ proven: false }, { proven: false }])
    const tuple = approvedXTuple()

    await expect(executeScheduledSocialBrowser({ workspaceRootPath: '/workspace', ...tuple }, depsFor(browser))).rejects.toThrow(/no positive success evidence/i)
    expect(browser.mutations).toEqual(['fill:@caption:Out Friday.', 'click:@submit'])
  })

  test('executes the exact successful X flow in the persisted account partition', async () => {
    const browser = new FakeBrowserPaneManager()
    browser.responses.set('identity:x', [{ loggedIn: true, candidates: [{ handle: '@artist-main', accountUrl: 'https://x.com/artist-main' }] }])
    browser.responses.set('media:x', [
      { fileNames: ['teaser.mp4'], hasMediaPreview: false },
      { fileNames: [], hasMediaPreview: true },
    ])
    browser.responses.set('draft:x', [{ caption: 'Out Friday.', hasMediaPreview: true }])
    browser.responses.set('success:x', [
      { proven: false },
      { proven: true, externalUrl: 'https://x.com/artist-main/status/123456789', message: 'Your post was sent' },
    ])
    const mediaPath = '/workspace/finals/teaser.mp4'
    const tuple = approvedXTuple('x', mediaPath)

    const result = await executeScheduledSocialBrowser({ workspaceRootPath: '/workspace', ...tuple }, {
      ...depsFor(browser),
      resolveMediaPath: () => mediaPath,
      fingerprintMediaPath: () => 'sha256:test-media',
    })

    expect(browser.partition).toBe('persist:social-x-artist-main')
    expect(browser.navigations).toEqual(['https://x.com/compose/post'])
    expect(browser.mutations).toEqual([
      'upload:@upload:/workspace/finals/teaser.mp4',
      'fill:@caption:Out Friday.',
      'click:@submit',
    ])
    expect(result).toEqual({
      receiptId: 'x:123456789',
      externalUrl: 'https://x.com/artist-main/status/123456789',
      summary: 'Published to x/artist-main; positive platform evidence was verified.',
    })
  })

  test('refuses to submit while stale success evidence is visible', async () => {
    const browser = new FakeBrowserPaneManager()
    browser.responses.set('identity:x', [{ loggedIn: true, candidates: [{ handle: '@artist-main', accountUrl: 'https://x.com/artist-main' }] }])
    browser.responses.set('draft:x', [{ caption: 'Out Friday.', hasMediaPreview: false }])
    browser.responses.set('success:x', [{ proven: true, externalUrl: 'https://x.com/artist-main/status/999' }])
    const tuple = approvedXTuple()

    await expect(executeScheduledSocialBrowser({ workspaceRootPath: '/workspace', ...tuple }, depsFor(browser))).rejects.toThrow(/already shows success evidence/i)
    expect(browser.mutations).toEqual(['fill:@caption:Out Friday.'])
  })

  test('refuses media when the exact uploaded file or visible preview cannot be proven', async () => {
    const browser = new FakeBrowserPaneManager()
    browser.responses.set('identity:x', [{ loggedIn: true, candidates: [{ handle: '@artist-main', accountUrl: 'https://x.com/artist-main' }] }])
    browser.responses.set('media:x', [{ fileNames: [], hasMediaPreview: true }])
    const mediaPath = '/workspace/finals/teaser.mp4'
    const tuple = approvedXTuple('x', mediaPath)

    await expect(executeScheduledSocialBrowser({ workspaceRootPath: '/workspace', ...tuple }, {
      ...depsFor(browser),
      resolveMediaPath: () => mediaPath,
      fingerprintMediaPath: () => 'sha256:test-media',
    })).rejects.toThrow(/did not attach the exact approved media/i)
    expect(browser.mutations).toEqual(['upload:@upload:/workspace/finals/teaser.mp4'])
  })

  test('fails closed on unsupported platforms and ambiguous selectors', async () => {
    const unsupportedBrowser = new FakeBrowserPaneManager()
    const unsupported = approvedXTuple('linkedin')
    await expect(executeScheduledSocialBrowser({ workspaceRootPath: '/workspace', ...unsupported }, depsFor(unsupportedBrowser))).rejects.toThrow(/unsupported native social platform/i)
    expect(unsupportedBrowser.mutations).toEqual([])

    const ambiguousBrowser = new FakeBrowserPaneManager()
    ambiguousBrowser.responses.set('identity:x', [{ loggedIn: true, candidates: [{ handle: '@artist-main', accountUrl: 'https://x.com/artist-main' }] }])
    ambiguousBrowser.targets.set('caption', 'ambiguous')
    const tuple = approvedXTuple()
    await expect(executeScheduledSocialBrowser({ workspaceRootPath: '/workspace', ...tuple }, depsFor(ambiguousBrowser))).rejects.toThrow(/caption selector is ambiguous/i)
    expect(ambiguousBrowser.mutations).toEqual([])
  })

  test('rejects approved YouTube settings that drift from the work order', async () => {
    const browser = new FakeBrowserPaneManager()
    const mediaPath = '/workspace/finals/video.mp4'
    const tuple = approvedXTuple('youtube', mediaPath)
    const action = tuple.preview.dryRun.action as { payload: Record<string, unknown> }
    action.payload.visibility = 'public'

    await expect(executeScheduledSocialBrowser({ workspaceRootPath: '/workspace', ...tuple }, {
      ...depsFor(browser),
      resolveMediaPath: () => mediaPath,
      fingerprintMediaPath: () => 'sha256:test-media',
    })).rejects.toThrow(/YouTube settings/i)
    expect(browser.mutations).toEqual([])
  })

  test('sets the exact approved YouTube audience and visibility before publishing', async () => {
    const browser = new FakeBrowserPaneManager()
    browser.partition = 'persist:social-youtube-artist-main'
    browser.responses.set('identity:youtube', [{ loggedIn: true, candidates: [{ handle: '@artist-main', accountUrl: 'https://youtube.com/@artist-main' }] }])
    browser.responses.set('media:youtube', [
      { fileNames: ['video.mp4'], hasMediaPreview: false },
      { fileNames: [], hasMediaPreview: true },
    ])
    browser.responses.set('draft:youtube', [{ caption: 'Out Friday.', hasMediaPreview: true }])
    browser.responses.set('success:youtube', [
      { proven: false },
      { proven: true, externalUrl: 'https://www.youtube.com/watch?v=video123' },
    ])
    const mediaPath = '/workspace/finals/video.mp4'
    const tuple = approvedXTuple('youtube', mediaPath)

    const result = await executeScheduledSocialBrowser({ workspaceRootPath: '/workspace', ...tuple }, {
      ...depsFor(browser),
      resolveMediaPath: () => mediaPath,
      fingerprintMediaPath: () => 'sha256:test-media',
    })

    expect(browser.mutations).toEqual([
      'upload:@upload:/workspace/finals/video.mp4',
      'fill:@caption:Out Friday.',
      'click:@audience',
      'click:@submit',
      'click:@submit',
      'click:@submit',
      'click:@visibility',
      'click:@submit',
    ])
    expect(result).toEqual({
      receiptId: 'youtube:video123',
      externalUrl: 'https://www.youtube.com/watch?v=video123',
      summary: 'Published to youtube/artist-main; positive platform evidence was verified.',
    })
  })
})
