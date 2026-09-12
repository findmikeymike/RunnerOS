import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { getWorkspaceSessionsPath, loadWorkspaceConfig, saveWorkspaceConfig } from '../storage.ts';
import {
  assertWorkspaceOpenable,
  completePreparedWorkspaceMigration,
  listLocalTeamMigrationJournals,
  moveWorkspaceToSharedFolder,
  prepareWorkspaceMoveToSharedFolder,
  promotePreparedPrivateSessions,
  readTeamMigrationJournal,
  rollbackPreparedWorkspaceMigration,
  preflightSharedFolderMigration,
  TEAM_MIGRATIONS_DIR,
  writeMovedToTombstone,
} from '../team-migration.ts';
import type { WorkspaceConfig } from '../types.ts';

const tempDirs: string[] = [];

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeWorkspace(root: string, partial: Partial<WorkspaceConfig> = {}): WorkspaceConfig {
  const config: WorkspaceConfig = {
    id: `ws_${Math.random().toString(36).slice(2)}`,
    name: 'Migrating Workspace',
    slug: 'migrating-workspace',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    defaults: {
      workingDirectory: root,
    },
    ...partial,
  };
  writeFileSync(join(root, 'config.json'), JSON.stringify(config, null, 2), 'utf-8');
  mkdirSync(join(root, 'context'), { recursive: true });
  writeFileSync(join(root, 'context', 'CONTEXT.md'), '# Context\n', 'utf-8');
  return config;
}

afterEach(() => {
  delete process.env.CRAFT_CONFIG_DIR;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('team shared-folder migration', () => {
  it('keeps a deferred destination blocked until the server completes its receipt', () => {
    const source = makeDir('team-migrate-deferred-source-');
    const destinationParent = makeDir('team-migrate-deferred-dest-');
    const privateRoot = makeDir('team-migrate-deferred-private-');
    process.env.CRAFT_CONFIG_DIR = privateRoot;
    writeWorkspace(source);
    mkdirSync(join(source, 'sessions'), { recursive: true });
    writeFileSync(join(source, 'sessions', 'session-1.jsonl'), '{"id":"session-1"}\n', 'utf-8');
    writeFileSync(join(source, 'automations-history.jsonl'), '{"prompt":"private"}\n', 'utf-8');
    writeFileSync(join(source, 'automations-retry-queue.jsonl'), '{"auth":"secret"}\n', 'utf-8');

    const result = prepareWorkspaceMoveToSharedFolder(source, destinationParent, { deferCompletion: true });
    expect(JSON.parse(readFileSync(result.receiptPath, 'utf-8')).status).toBe('ready');
    expect(() => assertWorkspaceOpenable(result.finalRootPath)).toThrow('migration is still in progress');

    completePreparedWorkspaceMigration(result);
    expect(JSON.parse(readFileSync(result.receiptPath, 'utf-8')).status).toBe('complete');
    expect(() => assertWorkspaceOpenable(result.finalRootPath)).not.toThrow();
    expect(existsSync(join(privateRoot, 'team', loadWorkspaceConfig(source)!.id, 'private-sessions', 'session-1.jsonl'))).toBe(true);
  });

  it('durably rolls back a fault before the configured root switch', () => {
    const source = makeDir('team-migrate-fault-source-');
    const destinationParent = makeDir('team-migrate-fault-dest-');
    const privateRoot = makeDir('team-migrate-fault-private-');
    process.env.CRAFT_CONFIG_DIR = privateRoot;
    const config = writeWorkspace(source);
    mkdirSync(join(source, 'sessions'), { recursive: true });
    writeFileSync(join(source, 'sessions', 'session-fault.jsonl'), '{}\n', 'utf-8');

    expect(() => prepareWorkspaceMoveToSharedFolder(source, destinationParent, {
      deferCompletion: true,
      onPhase: (phase) => {
        if (phase === 'destination-staged') throw new Error('injected destination fault');
      },
    })).toThrow('injected destination fault');

    expect(existsSync(join(destinationParent, basename(source)))).toBe(false);
    expect(existsSync(join(source, 'config.json'))).toBe(true);
    const journal = listLocalTeamMigrationJournals().find((item) => item.workspaceId === config.id);
    expect(journal?.phase).toBe('rolled-back');
    expect(journal?.error).toContain('injected destination fault');
    expect(existsSync(join(privateRoot, 'team', config.id, 'private-sessions'))).toBe(false);
    expect(existsSync(join(privateRoot, 'team', config.id, '.migration'))).toBe(false);
  });

  it('moves a workspace into a destination parent with team config, receipt, and portable config', () => {
    const source = makeDir('team-migrate-source-');
    const destinationParent = makeDir('team-migrate-dest-');
    const privateRoot = makeDir('team-migrate-private-');
    process.env.CRAFT_CONFIG_DIR = privateRoot;
    writeWorkspace(source);

    const result = moveWorkspaceToSharedFolder(source, destinationParent, {
      provider: 'generic-folder',
      providerLabel: 'Temp shared folder',
    });

    expect(result.finalRootPath).toBe(join(destinationParent, basename(source)));
    expect(existsSync(result.finalRootPath)).toBe(true);
    expect(existsSync(join(result.finalRootPath, 'config.json'))).toBe(true);
    expect(existsSync(join(result.finalRootPath, 'team', 'config.json'))).toBe(true);
    expect(existsSync(result.receiptPath)).toBe(true);
    expect(existsSync(join(result.finalRootPath, 'context', 'CONTEXT.md'))).toBe(true);
    expect(existsSync(join(result.finalRootPath, 'automations-history.jsonl'))).toBe(false);
    expect(existsSync(join(result.finalRootPath, 'automations-retry-queue.jsonl'))).toBe(false);

    const migrated = loadWorkspaceConfig(result.finalRootPath);
    expect(migrated?.storage?.mode).toBe('shared-folder');
    expect(migrated?.storage?.mode === 'shared-folder' ? migrated.storage.movedFrom : undefined).toBe(source);
    expect(migrated?.team?.enabled).toBe(true);
    expect(migrated?.defaults?.workingDirectory).toBe(source);

    const receipt = JSON.parse(readFileSync(result.receiptPath, 'utf-8'));
    expect(receipt.status).toBe('complete');
  });

  it('rolls back the temp migration folder when preflight fails on secret files', () => {
    const source = makeDir('team-migrate-secret-source-');
    const destinationParent = makeDir('team-migrate-secret-dest-');
    writeWorkspace(source);
    writeFileSync(join(source, '.env'), 'SECRET=value\n', 'utf-8');

    const preflight = preflightSharedFolderMigration(source, destinationParent);
    expect(preflight.ok).toBe(false);
    expect(preflight.blockedFiles).toEqual(['.env']);
    expect(() => moveWorkspaceToSharedFolder(source, destinationParent)).toThrow('Workspace contains files that should not be synced.');
    expect(existsSync(join(destinationParent, basename(source)))).toBe(false);
    expect(existsSync(join(source, 'config.json'))).toBe(true);
  });

  it('blocks symbolic links instead of silently dropping them during migration', () => {
    const source = makeDir('team-migrate-symlink-source-');
    const destinationParent = makeDir('team-migrate-symlink-dest-');
    const outside = makeDir('team-migrate-symlink-outside-');
    writeWorkspace(source);
    writeFileSync(join(outside, 'private.txt'), 'do-not-sync', 'utf-8');
    symlinkSync(join(outside, 'private.txt'), join(source, 'reference.txt'));

    const preflight = preflightSharedFolderMigration(source, destinationParent);
    expect(preflight.ok).toBe(false);
    expect(preflight.blockedFiles).toEqual(['reference.txt']);
    expect(preflight.reason).toContain('symbolic links');
    expect(() => moveWorkspaceToSharedFolder(source, destinationParent)).toThrow('symbolic links');
    expect(existsSync(join(destinationParent, basename(source)))).toBe(false);
    expect(existsSync(join(source, 'reference.txt'))).toBe(true);
  });

  it('blocks credential caches and keeps sessions private during shared-folder migration', () => {
    const source = makeDir('team-migrate-private-source-');
    const destinationParent = makeDir('team-migrate-private-dest-');
    const privateRoot = makeDir('team-migrate-private-root-');
    process.env.CRAFT_CONFIG_DIR = privateRoot;
    writeWorkspace(source);
    mkdirSync(join(source, 'sources', 'google-ads'), { recursive: true });
    writeFileSync(join(source, 'sources', 'google-ads', '.credential-cache.json'), '{"token":"secret"}', 'utf-8');

    const preflight = preflightSharedFolderMigration(source, destinationParent);
    expect(preflight.ok).toBe(false);
    expect(preflight.blockedFiles).toEqual(['sources/google-ads/.credential-cache.json']);

    rmSync(join(source, 'sources', 'google-ads', '.credential-cache.json'));
    mkdirSync(join(source, 'sessions', 'session-1'), { recursive: true });
    writeFileSync(join(source, 'sessions', 'session-1', 'session.jsonl'), '{"private":true}\n', 'utf-8');

	    const result = moveWorkspaceToSharedFolder(source, destinationParent);

	    expect(existsSync(join(result.finalRootPath, 'sessions'))).toBe(false);
	    expect(existsSync(join(result.finalRootPath, 'sources', 'google-ads'))).toBe(false);
	    expect(readFileSync(join(getWorkspaceSessionsPath(result.finalRootPath), 'session-1', 'session.jsonl'), 'utf-8')).toBe('{"private":true}\n');
	  });

	  it('blocks credential-bearing source config files but allows env examples', () => {
	    const source = makeDir('team-migrate-source-secret-source-');
	    const destinationParent = makeDir('team-migrate-source-secret-dest-');
	    writeWorkspace(source);
	    writeFileSync(join(source, '.env.example'), 'OPENAI_API_KEY=\n', 'utf-8');
	    mkdirSync(join(source, 'sources', 'google-calendar'), { recursive: true });
	    writeFileSync(join(source, 'sources', 'google-calendar', 'config.json'), JSON.stringify({
	      name: 'Google Calendar',
	      googleOAuthClientSecret: 'shh',
	    }, null, 2), 'utf-8');

	    const preflight = preflightSharedFolderMigration(source, destinationParent);

	    expect(preflight.ok).toBe(false);
	    expect(preflight.blockedFiles).toEqual(['sources/google-calendar/config.json']);
	  });

  it('blocks common credential files and service-account key material', () => {
    const source = makeDir('team-migrate-common-secrets-source-');
    const destinationParent = makeDir('team-migrate-common-secrets-dest-');
    writeWorkspace(source);
    writeFileSync(join(source, '.npmrc'), '//registry.npmjs.org/:_authToken=secret\n', 'utf-8');
    writeFileSync(join(source, 'deploy-key.pem'), '-----BEGIN PRIVATE KEY-----\nsecret\n', 'utf-8');
    writeFileSync(join(source, 'service-account.json'), JSON.stringify({
      type: 'service_account',
      client_email: 'runner@example.iam.gserviceaccount.com',
      private_key: 'secret',
    }), 'utf-8');

    const preflight = preflightSharedFolderMigration(source, destinationParent);

    expect(preflight.ok).toBe(false);
    expect(preflight.blockedFiles).toEqual(['.npmrc', 'deploy-key.pem', 'service-account.json']);
  });

  it('blocks mixed-case environment files', () => {
    const source = makeDir('env-case-source-');
    const destination = makeDir('env-case-destination-');
    writeWorkspace(source);
    writeFileSync(join(source, '.ENV.staging'), 'API_TOKEN=secret\n', 'utf-8');

    const preflight = preflightSharedFolderMigration(source, destination);

    expect(preflight.ok).toBe(false);
    expect(preflight.blockedFiles).toContain('.ENV.staging');
  });

  it('preserves existing runner automation policy when migrating an enabled team workspace', () => {
    const source = makeDir('team-migrate-policy-source-');
    const destinationParent = makeDir('team-migrate-policy-dest-');
    const privateRoot = makeDir('team-migrate-policy-private-');
    process.env.CRAFT_CONFIG_DIR = privateRoot;
    writeWorkspace(source, {
      team: {
        enabled: true,
        teamId: 'team_existing',
        revision: 4,
        runnerMachineId: 'machine_existing',
        automationsPolicy: 'runner-only',
        backgroundTriggersEnabled: true,
        runnerMissedTickPolicy: 'run-once',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    const result = moveWorkspaceToSharedFolder(source, destinationParent);
    const migrated = loadWorkspaceConfig(result.finalRootPath);

    expect(migrated?.team?.runnerMachineId).toBe('machine_existing');
    expect(migrated?.team?.automationsPolicy).toBe('runner-only');
    expect(migrated?.team?.backgroundTriggersEnabled).toBe(true);
    expect(migrated?.team?.members?.[0]?.role).toBe('owner');
  });

  it('rejects destinations inside the source workspace', () => {
    const source = makeDir('team-migrate-nested-source-');
    writeWorkspace(source);
    const nestedDestinationParent = join(source, 'shared-parent');
    mkdirSync(nestedDestinationParent);

    const preflight = preflightSharedFolderMigration(source, nestedDestinationParent);

    expect(preflight.ok).toBe(false);
    expect(preflight.reason).toBe('Destination cannot be inside the workspace being moved.');
    expect(() => moveWorkspaceToSharedFolder(source, nestedDestinationParent)).toThrow('Destination cannot be inside the workspace being moved.');
    expect(existsSync(join(nestedDestinationParent, basename(source)))).toBe(false);
  });

  it('refuses migrating folders, config-less folders, in-progress receipts, and moved tombstones', () => {
    const parent = makeDir('team-open-guard-');
    const migrating = join(parent, '.craft-migrating-test');
    mkdirSync(migrating);
    expect(() => assertWorkspaceOpenable(migrating)).toThrow('still migrating');

    const configless = join(parent, 'configless-workspace');
    mkdirSync(configless);
    writeFileSync(join(configless, 'CONTEXT.md'), '# Partial\n', 'utf-8');
    expect(() => assertWorkspaceOpenable(configless)).toThrow('config.json is not available');

    const inProgress = join(parent, 'in-progress-workspace');
    mkdirSync(join(inProgress, TEAM_MIGRATIONS_DIR), { recursive: true });
    writeWorkspace(inProgress);
    writeFileSync(join(inProgress, TEAM_MIGRATIONS_DIR, 'mig_test.json'), JSON.stringify({
      version: 1,
      migrationId: 'mig_test',
      status: 'in-progress',
      sourceRootPath: '/old',
      destinationParentPath: parent,
      finalRootPath: inProgress,
      provider: 'generic-folder',
      startedAt: new Date().toISOString(),
    }, null, 2), 'utf-8');
    expect(() => assertWorkspaceOpenable(inProgress)).toThrow('migration is still in progress');

    const moved = join(parent, 'moved-workspace');
    mkdirSync(moved);
    const movedConfig = writeWorkspace(moved);
    writeMovedToTombstone(moved, join(parent, 'new-workspace'), 'mig_done');
    expect(() => assertWorkspaceOpenable(moved)).toThrow('Workspace moved to');
    expect(() => saveWorkspaceConfig(moved, { ...movedConfig, name: 'Old Workspace Write' })).toThrow('Workspace moved to');
  });
});


describe('migration publication and replay ownership', () => {
  function fixture() {
    const root = makeDir('team-migration-races-');
    const source = join(root, 'campaign');
    const destination = join(root, 'shared');
    const privateRoot = join(root, 'private');
    mkdirSync(source); mkdirSync(destination);
    process.env.CRAFT_CONFIG_DIR = privateRoot;
    const config = writeWorkspace(source);
    return { source, destination, privateRoot, config, final: join(destination, 'campaign') };
  }

  it('preserves another folder created after preflight when publication collides', () => {
    const f = fixture();
    expect(() => prepareWorkspaceMoveToSharedFolder(f.source, f.destination, {
      onPhase(phase) {
        if (phase !== 'prepared') return;
        mkdirSync(f.final);
        writeFileSync(join(f.final, 'other-user.txt'), 'keep my work');
      },
    })).toThrow();
    expect(readFileSync(join(f.final, 'other-user.txt'), 'utf8')).toBe('keep my work');
    expect(readFileSync(join(f.source, 'config.json'), 'utf8')).toContain(f.config.id);
  });

  it('startup rollback does not delete a destination replaced by another workspace', () => {
    const f = fixture();
    const result = prepareWorkspaceMoveToSharedFolder(f.source, f.destination, { deferCompletion: true });
    const journal = readTeamMigrationJournal(result.journalPath!)!;
    rmSync(f.final, { recursive: true });
    mkdirSync(f.final);
    writeFileSync(join(f.final, 'other-user.txt'), 'replacement');
    rollbackPreparedWorkspaceMigration(journal);
    expect(readFileSync(join(f.final, 'other-user.txt'), 'utf8')).toBe('replacement');
  });

  for (const [file, content] of [
    ['settings.json', JSON.stringify({ nested: { apiKey: 'fake-private-key' } })],
    ['.ENV.staging', 'API_TOKEN=fake-private-key'],
    ['deploy-key.pem', 'fake-private-key'],
  ]) {
    it(`does not publish ${file} introduced after preflight`, () => {
      const f = fixture();
      expect(() => prepareWorkspaceMoveToSharedFolder(f.source, f.destination, {
        onPhase(phase) { if (phase === 'prepared') writeFileSync(join(f.source, file!), content!); },
      })).toThrow('should not be synced');
      expect(readdirSync(f.destination)).toEqual([]);
      expect(readFileSync(join(f.source, file!), 'utf8')).toBe(content!);
    });
  }

  it('resumes private session promotion after one identical file was already copied', () => {
    const f = fixture();
    mkdirSync(join(f.source, 'sessions'));
    writeFileSync(join(f.source, 'sessions', 'one.jsonl'), 'private one');
    writeFileSync(join(f.source, 'sessions', 'two.jsonl'), 'private two');
    const result = prepareWorkspaceMoveToSharedFolder(f.source, f.destination, { deferCompletion: true });
    const privateDestination = join(f.privateRoot, 'team', f.config.id, 'private-sessions');
    mkdirSync(privateDestination, { recursive: true });
    writeFileSync(join(privateDestination, 'one.jsonl'), 'private one');
    promotePreparedPrivateSessions(result);
    completePreparedWorkspaceMigration(result);
    expect(readFileSync(join(privateDestination, 'one.jsonl'), 'utf8')).toBe('private one');
    expect(readFileSync(join(privateDestination, 'two.jsonl'), 'utf8')).toBe('private two');
    expect(existsSync(join(f.final, 'sessions'))).toBe(false);
  });

  it('preserves conflicting private session bytes and the retry stage', () => {
    const f = fixture();
    mkdirSync(join(f.source, 'sessions'));
    writeFileSync(join(f.source, 'sessions', 'one.jsonl'), 'original private');
    const result = prepareWorkspaceMoveToSharedFolder(f.source, f.destination, { deferCompletion: true });
    const privateDestination = join(f.privateRoot, 'team', f.config.id, 'private-sessions');
    mkdirSync(privateDestination, { recursive: true });
    writeFileSync(join(privateDestination, 'one.jsonl'), 'newer private edit');
    expect(() => promotePreparedPrivateSessions(result)).toThrow('conflicting content');
    expect(readFileSync(join(privateDestination, 'one.jsonl'), 'utf8')).toBe('newer private edit');
    expect(readFileSync(join(f.privateRoot, 'team', f.config.id, '.migration', result.migrationId, 'private-sessions', 'one.jsonl'), 'utf8')).toBe('original private');
  });
});


for (const cleanup of ['rollback', 'promotion', 'prepare-failure'] as const) {
  it(`${cleanup} preserves another pending migration for the same workspace`, () => {
    const root = makeDir('team-independent-journals-');
    const source = join(root, 'campaign');
    const privateRoot = join(root, 'private');
    const destinationA = join(root, 'shared-a');
    const destinationB = join(root, 'shared-b');
    const destinationC = join(root, 'shared-c');
    for (const directory of [source, destinationA, destinationB, destinationC]) mkdirSync(directory);
    process.env.CRAFT_CONFIG_DIR = privateRoot;
    const config = writeWorkspace(source);
    mkdirSync(join(source, 'sessions'));
    writeFileSync(join(source, 'sessions', 'private.jsonl'), 'private transcript');
    const first = prepareWorkspaceMoveToSharedFolder(source, destinationA, { deferCompletion: true });
    const second = prepareWorkspaceMoveToSharedFolder(source, destinationB, { deferCompletion: true });
    const secondStage = join(privateRoot, 'team', config.id, '.migration', second.migrationId, 'private-sessions', 'private.jsonl');
    if (cleanup === 'rollback') rollbackPreparedWorkspaceMigration(readTeamMigrationJournal(first.journalPath!)!);
    else if (cleanup === 'promotion') promotePreparedPrivateSessions(first);
    else expect(() => prepareWorkspaceMoveToSharedFolder(source, destinationC, {
      onPhase(phase) { if (phase === 'destination-staged') throw new Error('third migration failure'); },
    })).toThrow('third migration failure');
    expect(existsSync(secondStage)).toBe(true);
    expect(readFileSync(secondStage, 'utf8')).toBe('private transcript');
    expect(readTeamMigrationJournal(second.journalPath!)?.phase).toBe('destination-staged');
    completePreparedWorkspaceMigration(second);
    expect(readFileSync(join(privateRoot, 'team', config.id, 'private-sessions', 'private.jsonl'), 'utf8')).toBe('private transcript');
  });
}
