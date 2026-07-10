import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigWatcher, snapshotWorkspaceSyncMetadata } from '../../config/watcher.ts'
import { markWorkspaceAsSharedFolder } from '../team-mode.ts'
import { classifyWorkspaceSyncAreas, classifyWorkspaceSyncPath } from '../sync-events.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('classifyWorkspaceSyncPath', () => {
  it.each([
    ['context/artist-profile/CONTEXT.md', 'context'],
    ['records/community/contacts/fan.json', 'records'],
    ['outputs/out-1/output.json', 'outputs'],
    ['runs/run-1/run.json', 'workflow-runs'],
    ['deep-research-runs/research-1/run.json', 'deep-research'],
    ['team/config.json', 'team'],
    ['team/conflicts/conflict.json', 'team'],
    ['pulses/daily/ticks.jsonl', 'pulses'],
    ['vault/music/master.wav', 'vault'],
    ['assets/campaign/manifest.json', 'vault'],
    ['agent-messages/receipt.json', 'agent-messages'],
    ['activated-workflows.json', 'workflows'],
    ['activated-agents.json', 'agents'],
    ['automations.json', 'automations'],
    ['automations-history.jsonl', 'automations'],
    ['notifications.json', 'notifications'],
    ['config.json', 'workspace'],
  ] as const)('classifies %s', (path, expected) => {
    expect(classifyWorkspaceSyncPath(path)).toBe(expected)
  })

  it('normalizes provider paths and ignores temporary noise', () => {
    expect(classifyWorkspaceSyncPath('records\\community\\fan.json')).toBe('records')
    expect(classifyWorkspaceSyncPath('outputs/out/output.json.tmp')).toBeNull()
    expect(classifyWorkspaceSyncPath('.DS_Store')).toBeNull()
    expect(classifyWorkspaceSyncPath('unrelated/file.txt')).toBeNull()
  })

  it('maps record operation transport files to records and Team health', () => {
    expect(classifyWorkspaceSyncAreas('team/record-ops/machine/op.json')).toEqual(['team', 'records'])
    expect(classifyWorkspaceSyncAreas('team/conflicts/conflict.json')).toEqual(['team', 'records'])
  })

  it('metadata reconciliation detects provider changes without reading payload bytes', () => {
    const root = mkdtempSync(join(tmpdir(), 'workspace-sync-metadata-'))
    roots.push(root)
    mkdirSync(join(root, 'records/community'), { recursive: true })
    const before = snapshotWorkspaceSyncMetadata(root)
    writeFileSync(join(root, 'records/community/fan.json'), '{"id":"fan"}')
    mkdirSync(join(root, 'labels'), { recursive: true })
    writeFileSync(join(root, 'labels/config.json'), '{"labels":[]}')
    const after = snapshotWorkspaceSyncMetadata(root)
    expect(after.get('records')).not.toBe(before.get('records'))
    expect(after.get('labels')).not.toBe(before.get('labels'))
    expect(after.get('outputs')).toBe(before.get('outputs'))
  })

  it('batches simulated provider delivery into one multi-surface refresh', async () => {
    const root = mkdtempSync(join(tmpdir(), 'workspace-sync-provider-'))
    const privateRoot = mkdtempSync(join(tmpdir(), 'workspace-sync-private-'))
    roots.push(root, privateRoot)
    const previousConfigDir = process.env.CRAFT_CONFIG_DIR
    process.env.CRAFT_CONFIG_DIR = privateRoot
    writeFileSync(join(root, 'config.json'), JSON.stringify({
      id: 'workspace-sync-test',
      name: 'Workspace Sync Test',
      slug: 'workspace-sync-test',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }))
    markWorkspaceAsSharedFolder(root, { provider: 'generic-folder', providerLabel: 'Test sync' })

    const changes: Array<{ areas: string[]; paths: string[] }> = []
    let labelChanges = 0
    let statusChanges = 0
    const watcher = new ConfigWatcher(root, {
      onWorkspaceSyncChange: (change) => changes.push(change),
      onLabelConfigChange: () => { labelChanges += 1 },
      onStatusConfigChange: () => { statusChanges += 1 },
    })
    try {
      watcher.start()
      mkdirSync(join(root, 'team/record-ops/machine-a'), { recursive: true })
      writeFileSync(join(root, 'team/record-ops/machine-a/op.json'), '{"opId":"op"}')
      mkdirSync(join(root, 'outputs/output-a'), { recursive: true })
      writeFileSync(join(root, 'outputs/output-a/output.json'), '{"id":"output-a"}')
      mkdirSync(join(root, 'labels'), { recursive: true })
      writeFileSync(join(root, 'labels/config.json'), '{"labels":[]}')
      mkdirSync(join(root, 'statuses'), { recursive: true })
      writeFileSync(join(root, 'statuses/config.json'), '{"statuses":[]}')
      writeFileSync(join(root, 'permissions.json'), '{"version":1}')
      watcher.notifyFileChange('labels/config.json')
      watcher.notifyFileChange('statuses/config.json')
      watcher.notifyFileChange('permissions.json')
      watcher.reconcileWorkspaceSyncNow()
      await Bun.sleep(350)
    } finally {
      watcher.stop()
      if (previousConfigDir === undefined) delete process.env.CRAFT_CONFIG_DIR
      else process.env.CRAFT_CONFIG_DIR = previousConfigDir
    }

    expect(changes).toHaveLength(1)
    expect(changes[0]?.areas).toEqual(expect.arrayContaining(['team', 'records', 'outputs', 'permissions']))
    expect(labelChanges).toBeGreaterThan(0)
    expect(statusChanges).toBeGreaterThan(0)
  })
})
