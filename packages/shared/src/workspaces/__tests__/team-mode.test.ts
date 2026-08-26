import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadWorkspaceConfig } from '../storage.ts';
import { createFakeSyncHarness, writeSharedRecord } from '../../records/index.ts';
import {
  approveOwnerRecoveryClaim,
  assertRunnerFence,
  assertTeamPermission,
  clearReadyRunnerHandover,
  evaluateTeamPermission,
  evaluateTeamRunnerGate,
  getTeamHeartbeatFile,
  getTeamModeStatus,
  isTeamRunnerHeartbeatStale,
  joinWorkspaceTeam,
  markWorkspaceAsSharedFolder,
  readOrCreateMachineIdentity,
  recoverWorkspaceOwner,
  rotateOwnerRecoveryCode,
  setRunnerMachine,
  TEAM_CONFIG_FILE,
  TEAM_RUNNER_STALE_AFTER_MS,
} from '../team-mode.ts';
import type { WorkspaceConfig } from '../types.ts';

const tempDirs: string[] = [];

function makeWorkspaceRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'team-workspace-'));
  const privateRoot = mkdtempSync(join(tmpdir(), 'team-private-'));
  tempDirs.push(root, privateRoot);
  process.env.CRAFT_CONFIG_DIR = privateRoot;
  return root;
}

function writeWorkspace(root: string, partial: Partial<WorkspaceConfig> = {}): WorkspaceConfig {
  const config: WorkspaceConfig = {
    id: `ws_${Math.random().toString(36).slice(2)}`,
    name: 'Team Workspace',
    slug: 'team-workspace',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...partial,
  };
  writeFileSync(join(root, 'config.json'), JSON.stringify(config, null, 2), 'utf-8');
  return config;
}

function writeSyncedHeartbeat(root: string, machineId: string): void {
  const memberId = loadWorkspaceConfig(root)?.team?.members?.[0]?.memberId;
  writeFileSync(getTeamHeartbeatFile(root, machineId), JSON.stringify({
    version: 1,
    memberId,
    machineId,
    displayName: machineId,
    canRunAutomations: true,
    isRunner: false,
    observedTeamRevision: 1,
    lastSeenAt: new Date().toISOString(),
  }, null, 2), 'utf-8');
}

afterEach(() => {
  delete process.env.CRAFT_CONFIG_DIR;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('team mode metadata', () => {
  it('moves legacy sessions private and removes automation history before in-place sharing', () => {
    const root = makeWorkspaceRoot();
    const config = writeWorkspace(root);
    mkdirSync(join(root, 'sessions', 'session-1'), { recursive: true });
    writeFileSync(join(root, 'sessions', 'session-1', 'messages.jsonl'), 'private conversation\n');
    writeFileSync(join(root, 'automations-history.jsonl'), '{"prompt":"private"}\n');
    writeFileSync(join(root, 'automations-retry-queue.jsonl'), '{"url":"https://secret"}\n');

    markWorkspaceAsSharedFolder(root);

    expect(existsSync(join(root, 'sessions'))).toBe(false);
    expect(existsSync(join(process.env.CRAFT_CONFIG_DIR!, 'team', config.id, 'private-sessions', 'session-1', 'messages.jsonl'))).toBe(true);
    expect(existsSync(join(root, 'automations-history.jsonl'))).toBe(false);
    expect(existsSync(join(root, 'automations-retry-queue.jsonl'))).toBe(false);
  });

  it('refuses in-place sharing while credential-bearing files are present', () => {
    const root = makeWorkspaceRoot();
    writeWorkspace(root);
    mkdirSync(join(root, 'sources', 'private-source'), { recursive: true });
    writeFileSync(join(root, 'sources', 'private-source', 'secrets.json'), JSON.stringify({ accessToken: 'do-not-sync' }));

    expect(() => markWorkspaceAsSharedFolder(root)).toThrow('credential-bearing files are present');
    expect(loadWorkspaceConfig(root)?.storage?.mode).not.toBe('shared-folder');
  });

  it('refuses in-place sharing when an innocently named file is a symbolic link', () => {
    const root = makeWorkspaceRoot();
    const outside = makeWorkspaceRoot();
    writeWorkspace(root);
    writeWorkspace(outside);
    writeFileSync(join(outside, 'private.txt'), 'do-not-sync', 'utf-8');
    symlinkSync(join(outside, 'private.txt'), join(root, 'reference.txt'));

    expect(() => markWorkspaceAsSharedFolder(root)).toThrow('symbolic links could escape the workspace');
    expect(loadWorkspaceConfig(root)?.storage?.mode).not.toBe('shared-folder');
  });

  it('refuses in-place sharing when private sessions contain symbolic links', () => {
    const root = makeWorkspaceRoot();
    const outside = makeWorkspaceRoot();
    writeWorkspace(root);
    writeWorkspace(outside);
    mkdirSync(join(root, 'sessions'), { recursive: true });
    writeFileSync(join(outside, 'private.txt'), 'do-not-copy', 'utf-8');
    symlinkSync(join(outside, 'private.txt'), join(root, 'sessions', 'linked.txt'));

    expect(() => markWorkspaceAsSharedFolder(root)).toThrow('symbolic links could escape the workspace');
    expect(existsSync(join(root, 'sessions', 'linked.txt'))).toBe(true);
  });

  it('loads legacy workspaces with no storage field unchanged', () => {
    const root = makeWorkspaceRoot();
    writeWorkspace(root);

    const loaded = loadWorkspaceConfig(root);
    expect(loaded).not.toBeNull();
    expect(loaded?.storage).toBeUndefined();
    expect(loaded?.team).toBeUndefined();
  });

  it('returns solo status without mutating legacy workspace config', () => {
    const root = makeWorkspaceRoot();
    writeWorkspace(root);

    const status = getTeamModeStatus(root);
    const saved = loadWorkspaceConfig(root);

    expect(status.storage.mode).toBe('solo');
    expect(status.team.enabled).toBe(false);
    expect(status.machine.machineId).toBe('not_joined');
    expect(saved?.storage).toBeUndefined();
    expect(saved?.team).toBeUndefined();
    expect(existsSync(join(root, TEAM_CONFIG_FILE))).toBe(false);
  });

  it('refuses team status for moved workspace tombstones', () => {
    const root = makeWorkspaceRoot();
    writeWorkspace(root, {
      movedTo: {
        path: join(root, '..', 'new-team-workspace'),
        migrationId: 'mig_done',
        movedAt: new Date().toISOString(),
      },
    });

    expect(() => getTeamModeStatus(root)).toThrow('Workspace moved to');
    expect(() => markWorkspaceAsSharedFolder(root)).toThrow('Workspace moved to');
  });

  it('enabling team mode writes shared-folder storage, team config, and machine heartbeat', () => {
    const root = makeWorkspaceRoot();
    writeWorkspace(root);

    const status = markWorkspaceAsSharedFolder(root, {
      provider: 'generic-folder',
      providerLabel: 'Current folder',
    });
    const mirror = JSON.parse(readFileSync(join(root, TEAM_CONFIG_FILE), 'utf-8'));

    expect(status.storage.mode).toBe('shared-folder');
    expect(status.team.enabled).toBe(true);
    expect(status.team.revision).toBe(1);
    expect(mirror.team.enabled).toBe(true);
    expect(existsSync(status.privateMachinePath)).toBe(true);
    expect(existsSync(status.heartbeatPath)).toBe(true);
  });

  it('reports an existing team workspace without creating private identity or heartbeat files', () => {
    const root = makeWorkspaceRoot();
    writeWorkspace(root, {
      storage: {
        mode: 'shared-folder',
        portabilityVersion: 1,
        provider: 'google-drive',
        sharedRootId: 'shared_existing',
        enabledAt: new Date().toISOString(),
        vaultPolicy: 'copy-into-workspace',
        pathPolicy: 'relative-required',
      },
      team: {
        enabled: true,
        teamId: 'team_existing',
        revision: 4,
        automationsPolicy: 'manual-only',
        backgroundTriggersEnabled: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    const status = getTeamModeStatus(root);

    expect(status.team.teamId).toBe('team_existing');
    expect(status.machine.machineId).toBe('not_joined');
    expect(existsSync(status.privateMachinePath)).toBe(false);
    expect(existsSync(status.heartbeatPath)).toBe(false);
    expect(status.heartbeat.observedTeamRevision).toBe(4);
  });

  it('treats a joined memberless legacy team workspace as owner and persists membership on permission check', () => {
    const root = makeWorkspaceRoot();
    const config = writeWorkspace(root, {
      storage: {
        mode: 'shared-folder',
        portabilityVersion: 1,
        provider: 'generic-folder',
        sharedRootId: 'shared_legacy',
        enabledAt: new Date().toISOString(),
        vaultPolicy: 'copy-into-workspace',
        pathPolicy: 'relative-required',
      },
      team: {
        enabled: true,
        teamId: 'team_legacy',
        revision: 1,
        automationsPolicy: 'runner-only',
        backgroundTriggersEnabled: true,
        runnerMissedTickPolicy: 'run-once',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
    readOrCreateMachineIdentity(config.id);

    expect(getTeamModeStatus(root).currentRole).toBe('owner');
    expect(assertTeamPermission(root, 'team.runner.assign')).toMatchObject({ allowed: true, role: 'owner' });
    expect(loadWorkspaceConfig(root)?.team?.members?.[0]?.role).toBe('owner');
  });

  it('rejects runner assignment while the workspace is still solo', () => {
    const root = makeWorkspaceRoot();
    writeWorkspace(root);

    expect(() => setRunnerMachine(root)).toThrow('Team runner requires an enabled shared-folder team workspace.');
    expect(loadWorkspaceConfig(root)?.storage).toBeUndefined();
    expect(existsSync(join(root, TEAM_CONFIG_FILE))).toBe(false);
  });

  it('sets the current machine as runner and increments the team revision', () => {
    const root = makeWorkspaceRoot();
    writeWorkspace(root);

    const enabled = markWorkspaceAsSharedFolder(root);
    const runner = setRunnerMachine(root);

    expect(runner.team.runnerMachineId).toBe(enabled.machine.machineId);
    expect(runner.team.automationsPolicy).toBe('runner-only');
    expect(runner.team.backgroundTriggersEnabled).toBe(true);
    expect(runner.team.revision).toBe(enabled.team.revision + 1);
    expect(runner.team.runnerEpoch).toBe(1);
  });

  it('mints monotonic runner epochs and rejects a stale captured fence', () => {
    const root = makeWorkspaceRoot();
    writeWorkspace(root);
    const initial = markWorkspaceAsSharedFolder(root, { makeRunner: true });
    const initialGate = evaluateTeamRunnerGate(root);
    if (!initialGate.fence) throw new Error('expected runner fence');
    writeSyncedHeartbeat(root, 'machine_b');

    const switched = setRunnerMachine(root, 'machine_b');

    expect(switched.team.runnerEpoch).toBe((initial.team.runnerEpoch ?? 0) + 1);
    expect(() => assertRunnerFence(root, initialGate.fence!)).toThrow('runner fence');
  });

  it('rejects runner handoff to a machine that has not joined the team', () => {
    const root = makeWorkspaceRoot();
    writeWorkspace(root);
    markWorkspaceAsSharedFolder(root, { makeRunner: true });

    expect(() => setRunnerMachine(root, 'machine_not_joined')).toThrow('joined team machine');
  });

  it('allows solo automation and skips shared-folder non-runners', () => {
    const root = makeWorkspaceRoot();
    writeWorkspace(root);

    expect(evaluateTeamRunnerGate(root)).toMatchObject({ allowed: true, reason: 'solo' });

    markWorkspaceAsSharedFolder(root, { makeRunner: true });
    writeSyncedHeartbeat(root, 'machine_someone_else');
    const runner = setRunnerMachine(root, 'machine_someone_else');

    expect(runner.team.runnerMachineId).toBe('machine_someone_else');
    expect(evaluateTeamRunnerGate(root)).toMatchObject({ allowed: false, reason: 'not-runner' });
  });

  it('reports stale runner heartbeat in status', () => {
    const root = makeWorkspaceRoot();
    writeWorkspace(root);

    const runner = markWorkspaceAsSharedFolder(root, { makeRunner: true });
    const staleAt = new Date(Date.now() - TEAM_RUNNER_STALE_AFTER_MS - 1000).toISOString();
    const heartbeat = JSON.parse(readFileSync(runner.heartbeatPath, 'utf-8'));
    writeFileSync(runner.heartbeatPath, JSON.stringify({
      ...heartbeat,
      lastSeenAt: staleAt,
      lastAutomationHeartbeatAt: staleAt,
    }, null, 2), 'utf-8');

    const status = getTeamModeStatus(root);
    expect(isTeamRunnerHeartbeatStale(status.runnerHeartbeat)).toBe(true);
    expect(status.runnerIsStale).toBe(true);
  });

	  it('keeps a new runner pending until the old runner observes handover', () => {
    const root = makeWorkspaceRoot();
    writeWorkspace(root);

    const initialRunner = markWorkspaceAsSharedFolder(root, { makeRunner: true });
    const machineB = {
      version: 1,
      workspaceId: initialRunner.machine.workspaceId,
      machineId: 'machine_new_runner',
      displayName: 'Machine B',
      createdAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
    };
    writeSyncedHeartbeat(root, machineB.machineId);
    setRunnerMachine(root, machineB.machineId);
    writeFileSync(initialRunner.privateMachinePath, JSON.stringify(machineB, null, 2), 'utf-8');
    const pending = loadWorkspaceConfig(root)!;

    expect(pending.team?.runnerHandover).toMatchObject({
      from: initialRunner.machine.machineId,
      to: 'machine_new_runner',
    });
    const unobservedFromHeartbeat = JSON.parse(readFileSync(initialRunner.heartbeatPath, 'utf-8'));
    writeFileSync(initialRunner.heartbeatPath, JSON.stringify({
      ...unobservedFromHeartbeat,
      observedTeamRevision: pending.team!.revision - 1,
      lastSeenAt: new Date().toISOString(),
    }, null, 2), 'utf-8');
    expect(evaluateTeamRunnerGate(root)).toMatchObject({ allowed: false, reason: 'handover-pending' });
    expect(clearReadyRunnerHandover(root, 'machine_new_runner')).toBeNull();

    const fromHeartbeat = JSON.parse(readFileSync(initialRunner.heartbeatPath, 'utf-8'));
    writeFileSync(initialRunner.heartbeatPath, JSON.stringify({
      ...fromHeartbeat,
      observedTeamRevision: pending.team!.revision,
      lastSeenAt: new Date().toISOString(),
    }, null, 2), 'utf-8');

	    expect(clearReadyRunnerHandover(root, 'machine_new_runner')?.team?.runnerHandover).toBeUndefined();
	  });

	  it('does not auto-activate a handover when the old runner heartbeat is missing', () => {
	    const root = makeWorkspaceRoot();
	    writeWorkspace(root);

	    const initialRunner = markWorkspaceAsSharedFolder(root, { makeRunner: true });
	    const machineB = {
	      version: 1,
	      workspaceId: initialRunner.machine.workspaceId,
	      machineId: 'machine_new_runner',
	      displayName: 'Machine B',
	      createdAt: new Date().toISOString(),
	      lastOpenedAt: new Date().toISOString(),
	    };
	    writeSyncedHeartbeat(root, machineB.machineId);
	    setRunnerMachine(root, machineB.machineId);
	    writeFileSync(initialRunner.privateMachinePath, JSON.stringify(machineB, null, 2), 'utf-8');
	    rmSync(initialRunner.heartbeatPath, { force: true });

	    expect(evaluateTeamRunnerGate(root)).toMatchObject({ allowed: false, reason: 'handover-pending' });
	    expect(clearReadyRunnerHandover(root, 'machine_new_runner')).toBeNull();
	  });

  it('reports future workspace formats as unsupported', () => {
    const root = makeWorkspaceRoot();
    writeWorkspace(root, { formatVersion: 99 });

    const status = getTeamModeStatus(root);
    const saved = loadWorkspaceConfig(root);

    expect(status.supported).toBe(false);
    expect(status.formatVersion).toBe(99);
    expect(status.machine.machineId).toBe('not_joined');
    expect(saved?.storage).toBeUndefined();
    expect(existsSync(join(root, TEAM_CONFIG_FILE))).toBe(false);
  });

  it('fake-sync second machine can join without changing the existing runner', () => {
    const root = makeWorkspaceRoot();
    const sync = createFakeSyncHarness(join(root, 'sync'));
    const privateA = join(root, 'private-a');
    const privateB = join(root, 'private-b');

    process.env.CRAFT_CONFIG_DIR = privateA;
    writeWorkspace(sync.machineA);
    const runner = markWorkspaceAsSharedFolder(sync.machineA, { makeRunner: true });
    sync.syncAtoB();

    process.env.CRAFT_CONFIG_DIR = privateB;
    const beforeJoin = getTeamModeStatus(sync.machineB);
    expect(beforeJoin.joined).toBe(false);
    expect(beforeJoin.syncHealth.status).toBe('warning');
    expect(beforeJoin.syncHealth.checks.some((check) => check.id === 'joined' && check.status === 'warning')).toBe(true);

    const joined = joinWorkspaceTeam(sync.machineB);

    expect(joined.joined).toBe(true);
    expect(joined.currentRole).toBe('editor');
    expect(joined.team.runnerMachineId).toBe(runner.machine.machineId);
    expect(joined.team.automationsPolicy).toBe('runner-only');
    expect(joined.machines.map((machine) => machine.machineId).sort()).toEqual([
      joined.machine.machineId,
      runner.machine.machineId,
    ].sort());
    expect(joined.syncHealth.status).toBe('healthy');
    expect(evaluateTeamRunnerGate(sync.machineB)).toMatchObject({ allowed: false, reason: 'not-runner' });
  });

  it('owners can manage the runner while editors can edit shared work but not manage team settings', () => {
    const root = makeWorkspaceRoot();
    const sync = createFakeSyncHarness(join(root, 'sync'));
    const privateA = join(root, 'private-a');
    const privateB = join(root, 'private-b');

    process.env.CRAFT_CONFIG_DIR = privateA;
    writeWorkspace(sync.machineA);
    const ownerStatus = markWorkspaceAsSharedFolder(sync.machineA, { makeRunner: true });
    expect(ownerStatus.currentRole).toBe('owner');
    expect(evaluateTeamPermission(sync.machineA, 'team.runner.assign')).toMatchObject({ allowed: true, role: 'owner' });
    sync.syncAtoB();

    process.env.CRAFT_CONFIG_DIR = privateB;
    joinWorkspaceTeam(sync.machineB);
    expect(evaluateTeamPermission(sync.machineB, 'records.write')).toMatchObject({ allowed: true, role: 'editor' });
    expect(evaluateTeamPermission(sync.machineB, 'automation.external.execute')).toMatchObject({ allowed: false, role: 'editor', reason: 'owner-required' });
    expect(evaluateTeamPermission(sync.machineB, 'team.runner.assign')).toMatchObject({ allowed: false, role: 'editor', reason: 'owner-required' });
    expect(() => setRunnerMachine(sync.machineB)).toThrow('owner-required');

    process.env.CRAFT_CONFIG_DIR = privateA;
    expect(() => setRunnerMachine(sync.machineA)).not.toThrow();
  });

  it('requires the current owner to approve a one-time replacement-machine recovery request', () => {
    const root = makeWorkspaceRoot();
    const sync = createFakeSyncHarness(join(root, 'sync'));
    const privateA = join(root, 'private-a');
    const privateB = join(root, 'private-b');

    process.env.CRAFT_CONFIG_DIR = privateA;
    writeWorkspace(sync.machineA);
    markWorkspaceAsSharedFolder(sync.machineA, { makeRunner: true });
    const recovery = rotateOwnerRecoveryCode(sync.machineA);
    expect(recovery.recoveryCode.length).toBeGreaterThan(20);
    sync.syncAtoB();
    const armedConfig = readFileSync(join(sync.machineB, 'config.json'), 'utf-8');

    process.env.CRAFT_CONFIG_DIR = privateB;
    const requested = recoverWorkspaceOwner(sync.machineB, recovery.recoveryCode);
    expect(requested.currentRole).toBe('none');
    expect(requested.team.ownerRecovery?.state).toBe('claiming');
    expect(evaluateTeamRunnerGate(sync.machineB).reason).toBe('recovery-pending');
    const claimId = requested.ownerRecoveryClaims[0]!.claimId;
    sync.syncBtoA();

    process.env.CRAFT_CONFIG_DIR = privateA;
    approveOwnerRecoveryClaim(sync.machineA, claimId);
    sync.syncAtoB();

    process.env.CRAFT_CONFIG_DIR = privateB;
    const recovered = getTeamModeStatus(sync.machineB);

    expect(recovered.currentRole).toBe('owner');
    expect(recovered.canManageTeam).toBe(true);
    expect(recovered.team.members?.filter((member) => member.role === 'owner')).toHaveLength(1);
    expect(recovered.team.ownerRecovery?.state).toBe('spent');
    expect(() => setRunnerMachine(sync.machineB)).not.toThrow();

    writeFileSync(join(sync.machineB, 'config.json'), armedConfig, 'utf-8');
    expect(() => recoverWorkspaceOwner(sync.machineB, recovery.recoveryCode)).toThrow('already been used');
  });

  it('fails closed when the same recovery generation is claimed by two offline machines', () => {
    const root = makeWorkspaceRoot();
    const sync = createFakeSyncHarness(join(root, 'sync-contested'));
    const privateA = join(root, 'private-a');
    const privateB = join(root, 'private-b');
    const privateC = join(root, 'private-c');
    process.env.CRAFT_CONFIG_DIR = privateA;
    writeWorkspace(sync.machineA);
    markWorkspaceAsSharedFolder(sync.machineA, { makeRunner: true });
    const recovery = rotateOwnerRecoveryCode(sync.machineA);
    sync.syncAtoB();
    sync.syncAtoC();

    process.env.CRAFT_CONFIG_DIR = privateB;
    const claimB = recoverWorkspaceOwner(sync.machineB, recovery.recoveryCode).ownerRecoveryClaims[0]!;
    process.env.CRAFT_CONFIG_DIR = privateC;
    recoverWorkspaceOwner(sync.machineC, recovery.recoveryCode);
    sync.syncBtoA();
    sync.syncCtoA();

    process.env.CRAFT_CONFIG_DIR = privateA;
    const status = getTeamModeStatus(sync.machineA);
    expect(status.team.ownerRecovery?.state).toBe('contested');
    expect(status.ownerRecoveryClaims).toHaveLength(2);
    expect(evaluateTeamRunnerGate(sync.machineA).reason).toBe('recovery-pending');
    expect(() => approveOwnerRecoveryClaim(sync.machineA, claimB.claimId)).toThrow('contested');
  });

  it('re-enabling team metadata preserves existing runner automation policy', () => {
    const root = makeWorkspaceRoot();
    writeWorkspace(root);
    const first = markWorkspaceAsSharedFolder(root, { makeRunner: true });

    const second = markWorkspaceAsSharedFolder(root);

    expect(second.team.runnerMachineId).toBe(first.machine.machineId);
    expect(second.team.automationsPolicy).toBe('runner-only');
    expect(second.team.backgroundTriggersEnabled).toBe(true);
  });

  it('sync health surfaces open conflict records', () => {
    const root = makeWorkspaceRoot();
    writeWorkspace(root);
    markWorkspaceAsSharedFolder(root);
    const written = writeSharedRecord(root, 'community/contacts', 'fan_sync_health', {
      email: 'sync@example.com',
    }, { machineId: 'machine_a', now: '2026-07-02T12:00:00.000Z' });
    if (written.status !== 'written') throw new Error('expected write');
    const conflict = writeSharedRecord(root, 'community/contacts', 'fan_sync_health', {
      email: 'sync2@example.com',
    }, { machineId: 'machine_a', baseline: { revision: 0, sha256: 'stale', entity: {} }, now: '2026-07-02T12:01:00.000Z' });
    expect(conflict.status).toBe('conflict');

    const status = getTeamModeStatus(root);

    expect(status.syncHealth.conflictCount).toBe(1);
    expect(status.syncHealth.status).toBe('warning');
    expect(status.syncHealth.checks.some((check) => check.id === 'conflicts' && check.status === 'warning')).toBe(true);
  });

  it('fails sync health closed when conflict records cannot be parsed', () => {
    const root = makeWorkspaceRoot();
    writeWorkspace(root);
    markWorkspaceAsSharedFolder(root, { makeRunner: true });
    mkdirSync(join(root, 'team', 'conflicts'), { recursive: true });
    writeFileSync(join(root, 'team', 'conflicts', 'broken.json'), '{broken', 'utf-8');

    const status = getTeamModeStatus(root);

    expect(status.syncHealth.status).toBe('blocked');
    expect(status.syncHealth.checks.find((check) => check.id === 'conflicts')).toMatchObject({ status: 'blocked' });
  });

  it('sync health scans provider conflicted-copy files before counting conflicts', () => {
    const root = makeWorkspaceRoot();
    writeWorkspace(root);
    markWorkspaceAsSharedFolder(root);
    const contactsDir = join(root, 'records', 'community', 'contacts');
    mkdirSync(contactsDir, { recursive: true });
    writeFileSync(join(contactsDir, 'fan_sync_health (conflicted copy).json'), JSON.stringify({
      id: 'fan_sync_health',
      email: 'sync@example.com',
    }, null, 2), 'utf-8');

    const status = getTeamModeStatus(root);

    expect(status.syncHealth.conflictCount).toBe(1);
    expect(status.syncHealth.status).toBe('warning');
    expect(status.syncHealth.checks.some((check) => check.id === 'conflicts' && check.status === 'warning')).toBe(true);
  });
});
