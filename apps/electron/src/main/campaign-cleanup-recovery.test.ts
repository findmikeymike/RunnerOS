import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Workspace } from '@craft-agent/core/types'
import { beginCampaignRemovalJournal, recoverCampaignCleanupTransactions } from './campaign-cleanup-recovery'
import { removeFilesAndRegistration } from './campaign-cleanup'

const fixtures: string[] = []
afterEach(() => { for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true }) })
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'campaign-recovery-')))
  fixtures.push(root)
  const configDir = join(root, 'profile')
  mkdirSync(configDir)
  const campaign: Workspace = { id: 'campaign', slug: 'campaign', name: 'Campaign', rootPath: join(root, 'campaign'), createdAt: 123, artistWorkspaceScope: 'campaign' }
  const hq: Workspace = { id: 'hq', slug: 'hq', name: 'HQ', rootPath: join(root, 'hq'), createdAt: 456, artistWorkspaceScope: 'hq' }
  mkdirSync(campaign.rootPath); mkdirSync(hq.rootPath)
  writeFileSync(join(campaign.rootPath, 'song.wav'), 'original audio')
  const config = { workspaces: [campaign, hq], activeWorkspaceId: campaign.id, activeSessionId: null }
  const save = (value: unknown) => writeFileSync(join(configDir, 'config.json'), JSON.stringify(value))
  save(config)
  const begin = () => beginCampaignRemovalJournal(campaign, [campaign.rootPath], config.workspaces, configDir)
  const recover = () => recoverCampaignCleanupTransactions({ configDir })
  const journals = () => readdirSync(join(configDir, 'campaign-cleanup-transactions'))
  return { root, configDir, campaign, hq, config, save, begin, recover, journals }
}

describe('campaign cleanup recovery', () => {
  test.each(['before-registration', 'after-registration'] as const)('recovers real SIGKILL at %s boundary', (boundary) => {
    const f = fixture()
    const script = join(f.root, 'kill-fixture.ts')
    const modulePath = join(import.meta.dir, 'campaign-cleanup.ts')
    const recoveryPath = join(import.meta.dir, 'campaign-cleanup-recovery.ts')
    writeFileSync(script, `
      import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
      import { removeFilesAndRegistration } from ${JSON.stringify(modulePath)};
      import { beginCampaignRemovalJournal } from ${JSON.stringify(recoveryPath)};
      const file = ${JSON.stringify(join(f.configDir, 'config.json'))};
      const config = JSON.parse(readFileSync(file, 'utf8'));
      const campaign = config.workspaces[0], hq = config.workspaces[1];
      removeFilesAndRegistration(campaign, hq, {
        exists: existsSync, loadConfig: () => config,
        beginJournal: (workspace, roots, workspaces) => beginCampaignRemovalJournal(workspace, roots, workspaces, ${JSON.stringify(f.configDir)}),
        rename: (source, staged) => { renameSync(source, staged); if (${JSON.stringify(boundary)} === 'before-registration') process.kill(process.pid, 'SIGKILL'); },
        saveConfig: (value) => { writeFileSync(file, JSON.stringify(value)); if (${JSON.stringify(boundary)} === 'after-registration') process.kill(process.pid, 'SIGKILL'); },
        remove: path => rmSync(path, { recursive: true }),
      });
    `)
    const child = Bun.spawnSync([process.execPath, script], { env: { ...process.env, CRAFT_CONFIG_DIR: f.configDir }, stdout: 'pipe', stderr: 'pipe', timeout: 15_000 })
    expect(child.signalCode).toBe('SIGKILL')
    expect(existsSync(f.campaign.rootPath)).toBe(false)
    expect(f.journals()).toHaveLength(1)
    expect(f.recover()).toEqual([])
    expect(f.journals()).toHaveLength(0)
    if (boundary === 'before-registration') expect(readFileSync(join(f.campaign.rootPath, 'song.wav'), 'utf8')).toBe('original audio')
    else expect(existsSync(f.campaign.rootPath)).toBe(false)
    expect(f.recover()).toEqual([])
  })

  test('prepared journal without a rename leaves the original registered folder intact', () => {
    const f = fixture(); f.begin()
    expect(f.recover()).toEqual([])
    expect(readFileSync(join(f.campaign.rootPath, 'song.wav'), 'utf8')).toBe('original audio')
    expect(f.journals()).toHaveLength(0)
  })

  test.each(['missing-config', 'corrupt-config', 'changed-registration', 'replacement-source', 'replacement-stage', 'dangling-source', 'linked-stage', 'overlap', 'corrupt-journal'] as const)('leaves ambiguous %s transaction for manual recovery', (scenario) => {
    const f = fixture(); const tx = f.begin(); const staged = tx.roots[0]!.staged
    renameSync(f.campaign.rootPath, staged)
    if (scenario === 'missing-config') rmSync(join(f.configDir, 'config.json'))
    if (scenario === 'corrupt-config') writeFileSync(join(f.configDir, 'config.json'), '{bad')
    if (scenario === 'changed-registration') f.save({ workspaces: [{ ...f.campaign, createdAt: 999 }, f.hq] })
    if (scenario === 'replacement-source') { mkdirSync(f.campaign.rootPath); writeFileSync(join(f.campaign.rootPath, 'new.wav'), 'new audio') }
    if (scenario === 'replacement-stage') { renameSync(staged, join(f.root, 'original')); mkdirSync(staged) }
    if (scenario === 'dangling-source') symlinkSync(join(f.root, 'missing-target'), f.campaign.rootPath)
    if (scenario === 'linked-stage') { renameSync(staged, join(f.root, 'original')); symlinkSync(join(f.root, 'original'), staged) }
    if (scenario === 'overlap') f.save({ workspaces: [f.hq, { ...f.campaign, id: 'other', rootPath: staged }] })
    if (scenario === 'corrupt-journal') writeFileSync(join(f.configDir, 'campaign-cleanup-transactions', f.journals()[0]!), '{}')
    expect(f.recover().length).toBeGreaterThan(0)
    expect(existsSync(staged)).toBe(true)
    expect(f.journals()).toHaveLength(1)
    if (scenario === 'replacement-source') expect(readFileSync(join(f.campaign.rootPath, 'new.wav'), 'utf8')).toBe('new audio')
  })

  test('config directory alias is canonicalized consistently during prepare and recovery', () => {
    const f = fixture(); const alias = join(f.root, 'profile-alias')
    symlinkSync(f.configDir, alias)
    const tx = beginCampaignRemovalJournal(f.campaign, [f.campaign.rootPath], f.config.workspaces, alias)
    renameSync(f.campaign.rootPath, tx.roots[0]!.staged)
    expect(recoverCampaignCleanupTransactions({ configDir: alias })).toEqual([])
    expect(readFileSync(join(f.campaign.rootPath, 'song.wav'), 'utf8')).toBe('original audio')
    expect(f.journals()).toHaveLength(0)
  })

  test('registered workspace alias into staging prevents removal', () => {
    const f = fixture(); const tx = f.begin(); const staged = tx.roots[0]!.staged
    mkdirSync(join(f.campaign.rootPath, 'nested'))
    renameSync(f.campaign.rootPath, staged)
    const alias = join(f.root, 'alias')
    symlinkSync(staged, alias)
    f.save({ workspaces: [f.hq, { ...f.campaign, id: 'other', rootPath: join(alias, 'nested', 'not-created-yet') }] })
    expect(f.recover().length).toBeGreaterThan(0)
    expect(readFileSync(join(staged, 'song.wav'), 'utf8')).toBe('original audio')
    expect(f.journals()).toHaveLength(1)
  })

  test('failed removal keeps its journal and retries only owned staging', () => {
    const f = fixture()
    const warnings = removeFilesAndRegistration(f.campaign, f.hq, {
      exists: existsSync, loadConfig: () => f.config as any, saveConfig: f.save,
      rename: renameSync, remove: () => { throw new Error('busy') },
      beginJournal: (workspace, roots, workspaces) => beginCampaignRemovalJournal(workspace, roots, workspaces, f.configDir),
    })
    expect(warnings).toHaveLength(1)
    expect(f.journals()).toHaveLength(1)
    expect(f.recover()).toEqual([])
    expect(f.journals()).toHaveLength(0)
    expect(existsSync(f.campaign.rootPath)).toBe(false)
  })

  test('failed rollback keeps the journal and restores on restart', () => {
    const f = fixture()
    expect(() => removeFilesAndRegistration(f.campaign, f.hq, {
      exists: existsSync, loadConfig: () => f.config as any, saveConfig: () => { throw new Error('config locked') },
      rename: (source, destination) => { if (source.includes('.artist-os-delete-')) throw new Error('busy rollback'); renameSync(source, destination) },
      remove: path => rmSync(path, { recursive: true }),
      beginJournal: (workspace, roots, workspaces) => beginCampaignRemovalJournal(workspace, roots, workspaces, f.configDir),
    })).toThrow('rolled back')
    expect(f.journals()).toHaveLength(1)
    expect(f.recover()).toEqual([])
    expect(readFileSync(join(f.campaign.rootPath, 'song.wav'), 'utf8')).toBe('original audio')
  })

  test('normal config read cannot recreate a failed rollback source before recovery', () => {
    const f = fixture()
    const other = { ...f.hq, id: 'unrelated', slug: 'unrelated', rootPath: join(f.root, 'unrelated'), artistWorkspaceScope: 'campaign' as const }
    f.config.workspaces.push(other)
    f.save(f.config)
    expect(() => removeFilesAndRegistration(f.campaign, f.hq, {
      exists: existsSync, loadConfig: () => f.config as any, saveConfig: () => { throw new Error('config locked') },
      rename: (source, destination) => { if (source.includes('.artist-os-delete-')) throw new Error('rollback locked'); renameSync(source, destination) },
      remove: path => rmSync(path, { recursive: true }),
      beginJournal: (workspace, roots, workspaces) => beginCampaignRemovalJournal(workspace, roots, workspaces, f.configDir),
    })).toThrow('rolled back')
    const script = join(f.root, 'config-read-fixture.ts')
    writeFileSync(script, `
      import { existsSync, readFileSync } from 'node:fs';
      import { loadStoredConfig } from ${JSON.stringify(join(import.meta.dir, '../../../../packages/shared/src/config/storage.ts'))};
      import { recoverCampaignCleanupTransactions } from ${JSON.stringify(join(import.meta.dir, 'campaign-cleanup-recovery.ts'))};
      const config = loadStoredConfig();
      if (!config || existsSync(${JSON.stringify(f.campaign.rootPath)})) throw new Error('Staged source was recreated');
      if (!existsSync(${JSON.stringify(join(other.rootPath, 'config.json'))})) throw new Error('Unrelated workspace initialization was blocked');
      const warnings = recoverCampaignCleanupTransactions();
      if (warnings.length) throw new Error(warnings.join(' '));
      if (readFileSync(${JSON.stringify(join(f.campaign.rootPath, 'song.wav'))}, 'utf8') !== 'original audio') throw new Error('Original audio changed');
    `)
    const child = Bun.spawnSync([process.execPath, script], { env: { ...process.env, CRAFT_CONFIG_DIR: f.configDir }, stdout: 'pipe', stderr: 'pipe', timeout: 15_000 })
    expect(child.stderr.toString()).toBe('')
    expect(child.exitCode).toBe(0)
    expect(f.journals()).toHaveLength(0)
    expect(readFileSync(join(f.campaign.rootPath, 'song.wav'), 'utf8')).toBe('original audio')
  })

  test('config fsync failure retains committed staging and journal without rollback', () => {
    const f = fixture(); let removals = 0
    const warnings = removeFilesAndRegistration(f.campaign, f.hq, {
      exists: existsSync, loadConfig: () => f.config as any, saveConfig: f.save, rename: renameSync,
      remove: () => { removals++ },
      beginJournal: (workspace, roots, workspaces) => {
        const tx = beginCampaignRemovalJournal(workspace, roots, workspaces, f.configDir)
        tx.journal.syncRegistration = () => { throw new Error('sync failed') }
        return tx
      },
    })
    expect(warnings).toHaveLength(1)
    expect(removals).toBe(0)
    expect(existsSync(f.campaign.rootPath)).toBe(false)
    expect(f.journals()).toHaveLength(1)
    expect(f.recover()).toEqual([])
  })

  test('config write throwing after commit does not restore an unregistered campaign', () => {
    const f = fixture()
    const warnings = removeFilesAndRegistration(f.campaign, f.hq, {
      exists: existsSync, loadConfig: () => f.config as any,
      saveConfig: value => { f.save(value); throw new Error('post-write error') }, rename: renameSync,
      remove: path => rmSync(path, { recursive: true }),
      beginJournal: (workspace, roots, workspaces) => beginCampaignRemovalJournal(workspace, roots, workspaces, f.configDir),
    })
    expect(warnings).toEqual([])
    expect(existsSync(f.campaign.rootPath)).toBe(false)
    expect(f.journals()).toHaveLength(0)
    expect(JSON.parse(readFileSync(join(f.configDir, 'config.json'), 'utf8')).workspaces.map((workspace: Workspace) => workspace.id)).toEqual(['hq'])
  })

  test('unrelated legacy suffix folders are never swept', () => {
    const f = fixture(); const orphan = join(f.root, '.unrelated.artist-os-delete-123')
    mkdirSync(orphan); writeFileSync(join(orphan, 'keep.wav'), 'keep')
    expect(f.recover()).toEqual([])
    expect(readFileSync(join(orphan, 'keep.wav'), 'utf8')).toBe('keep')
  })
})
