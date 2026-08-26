import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  getTeamConfigFile,
  createDisabledTeamConfig,
  ensureMachineTeamMember,
  readOrCreateMachineIdentity,
  writeMachineHeartbeat,
  writeTeamConfigMirror,
} from './team-mode.ts';
import {
  CONFIG_DIR,
  loadWorkspaceConfig,
  saveWorkspaceConfig,
} from './storage.ts';
import { WORKSPACE_FORMAT_VERSION, type SharedFolderProvider, type WorkspaceConfig } from './types.ts';
import { verifiedCopyFileSync } from './verified-copy.ts';

export const TEAM_MIGRATIONS_DIR = 'team/migrations';
export const LOCAL_TEAM_MIGRATIONS_DIR = 'team-migrations';

export type TeamMigrationStatus = 'in-progress' | 'ready' | 'complete' | 'failed' | 'aborted';

export type TeamMigrationJournalPhase =
  | 'prepared'
  | 'runtime-quiesced'
  | 'destination-staged'
  | 'root-switched'
  | 'source-tombstoned'
  | 'runtime-rebound'
  | 'complete'
  | 'rolled-back'
  | 'needs-repair';

export interface TeamMigrationJournal {
  version: 1;
  migrationId: string;
  workspaceId: string;
  phase: TeamMigrationJournalPhase;
  sourceRootPath: string;
  destinationParentPath: string;
  finalRootPath: string;
  provider: SharedFolderProvider;
  providerLabel?: string;
  makeRunner?: boolean;
  startedAt: string;
  updatedAt: string;
  error?: string;
}

export interface TeamMigrationReceipt {
  version: 1;
  migrationId: string;
  status: TeamMigrationStatus;
  sourceRootPath: string;
  destinationParentPath: string;
  finalRootPath: string;
  provider: SharedFolderProvider;
  providerLabel?: string;
  startedAt: string;
  completedAt?: string;
  failedAt?: string;
  error?: string;
}

export interface TeamSharedFolderPreflightResult {
  ok: boolean;
  sourceRootPath: string;
  destinationParentPath: string;
  finalRootPath: string;
  blockedFiles: string[];
  warnings: string[];
  reason?: string;
}

export interface TeamSharedFolderMigrationResult {
  migrationId: string;
  originalRootPath: string;
  finalRootPath: string;
  receiptPath: string;
  teamConfigPath: string;
  journalPath?: string;
  tombstoneWritten?: boolean;
  tombstoneError?: string;
}

export interface TeamPreparedMigrationValidation {
  ok: boolean;
  reason?: string;
}

const BLOCKED_SECRET_BASENAMES = new Set([
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.credential-cache.json',
  'credentials.enc',
  'auth.json',
  '.npmrc',
  '.netrc',
  '.pypirc',
  '.dockercfg',
  'credentials',
  'secrets.json',
]);

const SECRET_JSON_KEYS = new Set([
  'clientsecret',
  'googleoauthclientsecret',
  'oauthclientsecret',
  'refreshtoken',
  'accesstoken',
  'apikey',
  'bearertoken',
  'privatekey',
  'password',
  'token',
]);

const SECRET_FILE_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore']);

const PRIVATE_WORKSPACE_DIRS = new Set([
  'sessions',
]);

const PRIVATE_WORKSPACE_FILES = new Set([
  'automations-history.jsonl',
  'automations-retry-queue.jsonl',
]);

function nowIso(): string {
  return new Date().toISOString();
}

function fsyncPath(file: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(file, 'r');
    fsyncSync(fd);
  } catch {
    // Some synced/network folders do not support fsync. Atomic rename still
    // protects against torn JSON on the local filesystem.
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf-8');
  fsyncPath(temp);
  renameSync(temp, file);
  fsyncPath(dirname(file));
}

function readJson<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function assertNotMigratingFolder(rootPath: string): void {
  if (basename(rootPath).startsWith('.craft-migrating-')) {
    throw new Error('This workspace is still migrating. Wait for sync to finish, then open the final folder.');
  }
}

function getMigrationReceiptPath(rootPath: string, migrationId: string): string {
  return join(rootPath, TEAM_MIGRATIONS_DIR, `${migrationId}.json`);
}

export function getLocalTeamMigrationJournalPath(workspaceId: string, migrationId: string): string {
  return join(process.env.CRAFT_CONFIG_DIR || CONFIG_DIR, LOCAL_TEAM_MIGRATIONS_DIR, workspaceId, `${migrationId}.json`);
}

export function readTeamMigrationJournal(file: string): TeamMigrationJournal | null {
  return readJson<TeamMigrationJournal>(file);
}

export function listLocalTeamMigrationJournals(): TeamMigrationJournal[] {
  const root = join(process.env.CRAFT_CONFIG_DIR || CONFIG_DIR, LOCAL_TEAM_MIGRATIONS_DIR);
  if (!existsSync(root)) return [];
  const journals: TeamMigrationJournal[] = [];
  for (const workspaceId of readdirSync(root)) {
    const workspaceDir = join(root, workspaceId);
    try {
      if (!statSync(workspaceDir).isDirectory()) continue;
      for (const name of readdirSync(workspaceDir)) {
        if (!name.endsWith('.json')) continue;
        const journal = readJson<TeamMigrationJournal>(join(workspaceDir, name));
        if (journal?.version === 1 && journal.migrationId) journals.push(journal);
      }
    } catch {
      // A concurrently cleaned-up journal directory is safe to skip.
    }
  }
  return journals;
}

export function updateTeamMigrationJournal(
  journal: TeamMigrationJournal,
  phase: TeamMigrationJournalPhase,
  error?: string,
): TeamMigrationJournal {
  const next: TeamMigrationJournal = {
    ...journal,
    phase,
    updatedAt: nowIso(),
    error,
  };
  writeJson(getLocalTeamMigrationJournalPath(journal.workspaceId, journal.migrationId), next);
  return next;
}

function isSameOrInsidePath(parentPath: string, candidatePath: string): boolean {
  const parent = resolve(parentPath);
  const candidate = resolve(candidatePath);
  const pathBetween = relative(parent, candidate);
  return pathBetween === '' || (!pathBetween.startsWith('..') && !isAbsolute(pathBetween));
}

export function listTeamMigrationReceipts(rootPath: string): TeamMigrationReceipt[] {
  const dir = join(rootPath, TEAM_MIGRATIONS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .map(name => readJson<TeamMigrationReceipt>(join(dir, name)))
    .filter((receipt): receipt is TeamMigrationReceipt => Boolean(receipt?.migrationId));
}

/**
 * Validate the durable destination proof before changing the local workspace
 * registry or tombstoning the source. This deliberately accepts only a
 * staged (`ready`) or already-completed receipt whose identity and paths
 * match both the local journal and destination config.
 */
export function validatePreparedWorkspaceMigration(
  journal: TeamMigrationJournal,
): TeamPreparedMigrationValidation {
  if (!existsSync(journal.finalRootPath)) {
    return { ok: false, reason: 'Migration destination is missing.' };
  }

  const config = loadWorkspaceConfig(journal.finalRootPath);
  if (!config) return { ok: false, reason: 'Migration destination config is missing or corrupt.' };
  if (config.id !== journal.workspaceId) {
    return { ok: false, reason: 'Migration destination workspace identity does not match the journal.' };
  }
  if (config.movedTo?.path) {
    return { ok: false, reason: 'Migration destination is itself a moved workspace tombstone.' };
  }
  if (config.storage?.mode !== 'shared-folder' || !config.team?.enabled) {
    return { ok: false, reason: 'Migration destination is not an enabled shared-folder workspace.' };
  }
  if (config.storage.provider !== journal.provider || config.storage.movedFrom !== journal.sourceRootPath) {
    return { ok: false, reason: 'Migration destination storage metadata does not match the journal.' };
  }

  const receiptPath = getMigrationReceiptPath(journal.finalRootPath, journal.migrationId);
  const receipt = readJson<TeamMigrationReceipt>(receiptPath);
  if (!receipt) return { ok: false, reason: 'Migration destination receipt is missing or corrupt.' };
  if (receipt.status !== 'ready' && receipt.status !== 'complete') {
    return { ok: false, reason: `Migration destination receipt is incomplete (${receipt.status}).` };
  }
  if (
    receipt.migrationId !== journal.migrationId
    || resolve(receipt.sourceRootPath) !== resolve(journal.sourceRootPath)
    || resolve(receipt.destinationParentPath) !== resolve(journal.destinationParentPath)
    || resolve(receipt.finalRootPath) !== resolve(journal.finalRootPath)
    || receipt.provider !== journal.provider
  ) {
    return { ok: false, reason: 'Migration destination receipt does not match the journal.' };
  }

  const mirror = readJson<{
    version?: number;
    workspaceId?: string;
    storage?: WorkspaceConfig['storage'];
    team?: WorkspaceConfig['team'];
  }>(getTeamConfigFile(journal.finalRootPath));
  if (!mirror || mirror.version !== 1 || mirror.workspaceId !== config.id) {
    return { ok: false, reason: 'Migration destination team mirror is missing, corrupt, or mismatched.' };
  }
  if (
    mirror.storage?.mode !== 'shared-folder'
    || mirror.storage.sharedRootId !== config.storage.sharedRootId
    || mirror.team?.teamId !== config.team.teamId
  ) {
    return { ok: false, reason: 'Migration destination team mirror does not match config.json.' };
  }

  return { ok: true };
}

export function assertWorkspaceOpenable(rootPath: string): void {
  assertNotMigratingFolder(rootPath);
  const configPath = join(rootPath, 'config.json');
  if (!existsSync(configPath)) {
    throw new Error('Workspace is still syncing. config.json is not available yet.');
  }
  const config = loadWorkspaceConfig(rootPath);
  if (!config) {
    throw new Error('Workspace config could not be parsed.');
  }
  if (config.movedTo?.path) {
    throw new Error(`Workspace moved to ${config.movedTo.path}`);
  }
  const inProgress = listTeamMigrationReceipts(rootPath).find(receipt => receipt.status === 'in-progress' || receipt.status === 'ready');
  if (inProgress) {
    throw new Error('Workspace migration is still in progress.');
  }
}

function collectWorkspaceFiles(rootPath: string): string[] {
  const files: string[] = [];
  const visit = (relativeDir: string) => {
    const absoluteDir = join(rootPath, relativeDir);
    for (const entry of readdirSync(absoluteDir).sort((a, b) => a.localeCompare(b))) {
      if (entry === 'node_modules' || entry === '.git') continue;
      const relativePath = relativeDir ? join(relativeDir, entry) : entry;
      const absolutePath = join(rootPath, relativePath);
      const stat = lstatSync(absolutePath);
      if (stat.isSymbolicLink()) {
        throw new Error(`Workspace changed during migration; symbolic link found: ${relativePath}`);
      }
      if (stat.isDirectory()) {
        visit(relativePath);
      } else if (stat.isFile()) {
        files.push(relativePath);
      }
    }
  };
  visit('');
  return files;
}

function findWorkspaceSymbolicLinks(rootPath: string): string[] {
  const links: string[] = [];
  const visit = (relativeDir: string) => {
    const absoluteDir = join(rootPath, relativeDir);
    for (const entry of readdirSync(absoluteDir).sort((a, b) => a.localeCompare(b))) {
      if (entry === 'node_modules' || entry === '.git') continue;
      const relativePath = relativeDir ? join(relativeDir, entry) : entry;
      const stat = lstatSync(join(rootPath, relativePath));
      if (stat.isSymbolicLink()) {
        links.push(relativePath);
      } else if (stat.isDirectory()) {
        visit(relativePath);
      }
    }
  };
  visit('');
  return links;
}

function isEnvExampleFile(name: string): boolean {
  return /^\.env\.(?:example|sample|template)$/i.test(name);
}

function normalizedSecretKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function hasCredentialBearingJson(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasCredentialBearingJson);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_JSON_KEYS.has(normalizedSecretKey(key)) && typeof child === 'string' && child.trim()) return true;
    if (hasCredentialBearingJson(child)) return true;
  }
  return false;
}

function isCredentialBearingJsonFile(rootPath: string, relativePath: string): boolean {
  if (!relativePath.toLowerCase().endsWith('.json')) return false;
  try {
    return hasCredentialBearingJson(JSON.parse(readFileSync(join(rootPath, relativePath), 'utf-8')));
  } catch {
    return false;
  }
}

function isSensitiveCredentialFilename(relativePath: string): boolean {
  const name = basename(relativePath).toLowerCase();
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  return BLOCKED_SECRET_BASENAMES.has(name)
    || SECRET_FILE_EXTENSIONS.has(extension)
    || /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i.test(name)
    || /(?:^|[-_.])service[-_.]?account(?:[-_.]|$)/i.test(name)
    || /(?:^|[-_.])credentials?(?:[-_.]|$).*\.json$/i.test(name)
    || /(?:^|[-_.])secrets?(?:[-_.]|$).*\.json$/i.test(name);
}

function findBlockedSecretFiles(rootPath: string): string[] {
  return collectWorkspaceFiles(rootPath).filter(relativePath => {
    const name = basename(relativePath);
    if (isEnvExampleFile(name)) return false;
    return isSensitiveCredentialFilename(relativePath)
      || name.toLowerCase().startsWith('.env.')
      || isCredentialBearingJsonFile(rootPath, relativePath);
  });
}

function shouldCopyWorkspaceFile(relativePath: string): boolean {
  const parts = relativePath.split(/[\\/]+/).filter(Boolean);
  if (parts.some((part) => PRIVATE_WORKSPACE_DIRS.has(part))) return false;
  if (PRIVATE_WORKSPACE_FILES.has(basename(relativePath))) return false;
  return !BLOCKED_SECRET_BASENAMES.has(basename(relativePath));
}

export function preflightSharedFolderMigration(
  sourceRootPath: string,
  destinationParentPath: string,
): TeamSharedFolderPreflightResult {
  const finalRootPath = join(destinationParentPath, basename(sourceRootPath));
  const warnings: string[] = [];

  try {
    assertWorkspaceOpenable(sourceRootPath);
    if (!existsSync(destinationParentPath) || !statSync(destinationParentPath).isDirectory()) {
      return { ok: false, sourceRootPath, destinationParentPath, finalRootPath, blockedFiles: [], warnings, reason: 'Destination folder does not exist.' };
    }
    if (resolve(sourceRootPath) === resolve(finalRootPath)) {
      return { ok: false, sourceRootPath, destinationParentPath, finalRootPath, blockedFiles: [], warnings, reason: 'Destination is already the current workspace folder.' };
    }
    if (isSameOrInsidePath(sourceRootPath, destinationParentPath)) {
      return { ok: false, sourceRootPath, destinationParentPath, finalRootPath, blockedFiles: [], warnings, reason: 'Destination cannot be inside the workspace being moved.' };
    }
    if (existsSync(finalRootPath)) {
      return { ok: false, sourceRootPath, destinationParentPath, finalRootPath, blockedFiles: [], warnings, reason: 'Destination already contains a workspace folder with this name.' };
    }
    const symbolicLinks = findWorkspaceSymbolicLinks(sourceRootPath);
    if (symbolicLinks.length > 0) {
      return {
        ok: false,
        sourceRootPath,
        destinationParentPath,
        finalRootPath,
        blockedFiles: symbolicLinks,
        warnings,
        reason: 'Workspace contains symbolic links. Replace them with real files or folders before moving to Team Mode.',
      };
    }
    const blockedFiles = findBlockedSecretFiles(sourceRootPath);
    if (blockedFiles.length > 0) {
      return { ok: false, sourceRootPath, destinationParentPath, finalRootPath, blockedFiles, warnings, reason: 'Workspace contains files that should not be synced.' };
    }
    return { ok: true, sourceRootPath, destinationParentPath, finalRootPath, blockedFiles, warnings };
  } catch (error) {
    return {
      ok: false,
      sourceRootPath,
      destinationParentPath,
      finalRootPath,
      blockedFiles: [],
      warnings,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function copyWorkspaceFilesConfigLast(sourceRootPath: string, tempRootPath: string): void {
  for (const relativePath of collectWorkspaceFiles(sourceRootPath)) {
    if (relativePath === 'config.json') continue;
    if (!shouldCopyWorkspaceFile(relativePath)) continue;
    const destPath = join(tempRootPath, relativePath);
    verifiedCopyFileSync(join(sourceRootPath, relativePath), destPath, {
      sourceRootPath,
      destinationRootPath: tempRootPath,
    });
  }
}

function copyDirectoryContents(sourceDir: string, destinationDir: string): void {
  if (!existsSync(sourceDir)) return;
  const copyDir = (currentSourceDir: string, currentDestinationDir: string): void => {
    mkdirSync(currentDestinationDir, { recursive: true });
    for (const entry of readdirSync(currentSourceDir)) {
      const sourcePath = join(currentSourceDir, entry);
      const destinationPath = join(currentDestinationDir, entry);
      const stat = lstatSync(sourcePath);
      if (stat.isSymbolicLink()) {
        throw new Error(`Workspace changed during migration; symbolic link found: ${sourcePath}`);
      }
      if (stat.isDirectory()) {
        copyDir(sourcePath, destinationPath);
      } else if (stat.isFile()) {
        verifiedCopyFileSync(sourcePath, destinationPath, {
          sourceRootPath: sourceDir,
          destinationRootPath: destinationDir,
        });
      }
    }
  };
  copyDir(sourceDir, destinationDir);
}

function getPrivateSessionStageDir(journal: TeamMigrationJournal): string {
  return join(process.env.CRAFT_CONFIG_DIR || CONFIG_DIR, 'team', journal.workspaceId, '.migration', journal.migrationId, 'private-sessions');
}

function getPrivateMigrationStageRoot(workspaceId: string): string {
  return join(process.env.CRAFT_CONFIG_DIR || CONFIG_DIR, 'team', workspaceId, '.migration');
}

function getPrivateSessionsDir(workspaceId: string): string {
  return join(process.env.CRAFT_CONFIG_DIR || CONFIG_DIR, 'team', workspaceId, 'private-sessions');
}

function stagePrivateWorkspaceDirs(sourceRootPath: string, journal: TeamMigrationJournal): void {
  const stage = getPrivateSessionStageDir(journal);
  rmSync(dirname(stage), { recursive: true, force: true });
  copyDirectoryContents(join(sourceRootPath, 'sessions'), stage);
}

function writeMigratedWorkspaceConfig(
  sourceRootPath: string,
  tempRootPath: string,
  input: {
    provider: SharedFolderProvider;
    providerLabel?: string;
    makeRunner?: boolean;
  },
): void {
  const sourceConfig = loadWorkspaceConfig(sourceRootPath);
  if (!sourceConfig) throw new Error(`Failed to load workspace config: ${sourceRootPath}`);
  const timestamp = nowIso();
  const previousTeam = sourceConfig.team ?? createDisabledTeamConfig();
  const machine = readOrCreateMachineIdentity(sourceConfig.id);
  const automationsPolicy = input.makeRunner
    ? 'runner-only'
    : previousTeam.enabled
      ? previousTeam.automationsPolicy
      : 'manual-only';
  const backgroundTriggersEnabled = input.makeRunner
    ? true
    : previousTeam.enabled
      ? previousTeam.backgroundTriggersEnabled
      : false;
  let migratedConfig: WorkspaceConfig = {
    ...sourceConfig,
    formatVersion: WORKSPACE_FORMAT_VERSION,
    storage: {
      mode: 'shared-folder',
      portabilityVersion: 1,
      provider: input.provider,
      providerLabel: input.providerLabel,
      sharedRootId: sourceConfig.storage?.mode === 'shared-folder'
        ? sourceConfig.storage.sharedRootId
        : `shared_${randomUUID().slice(0, 8)}`,
      enabledAt: sourceConfig.storage?.mode === 'shared-folder'
        ? sourceConfig.storage.enabledAt
        : timestamp,
      movedFrom: sourceRootPath,
      vaultPolicy: 'copy-into-workspace',
      pathPolicy: 'relative-required',
    },
    team: {
      ...previousTeam,
      enabled: true,
      revision: previousTeam.revision + 1,
      runnerMachineId: input.makeRunner ? machine.machineId : previousTeam.runnerMachineId,
      automationsPolicy,
      backgroundTriggersEnabled,
      updatedAt: timestamp,
    },
  };
  migratedConfig = ensureMachineTeamMember(tempRootPath, migratedConfig, machine, 'owner').config;
  saveWorkspaceConfig(tempRootPath, migratedConfig);
  writeTeamConfigMirror(tempRootPath, migratedConfig);
  writeMachineHeartbeat(tempRootPath, migratedConfig, machine);
}

export interface PrepareWorkspaceMoveOptions {
  provider?: SharedFolderProvider;
  providerLabel?: string;
  makeRunner?: boolean;
  /** Server runtimes set this after watchers/schedulers have been stopped. */
  initialPhase?: 'prepared' | 'runtime-quiesced';
  /** Leave the destination receipt non-openable until the server commits it. */
  deferCompletion?: boolean;
  /** Test-only fault hook. Throwing simulates a crash/failure at a durable phase. */
  onPhase?: (phase: TeamMigrationJournalPhase) => void;
}

export function prepareWorkspaceMoveToSharedFolder(
  sourceRootPath: string,
  destinationParentPath: string,
  input: PrepareWorkspaceMoveOptions = {},
): TeamSharedFolderMigrationResult {
  const preflight = preflightSharedFolderMigration(sourceRootPath, destinationParentPath);
  if (!preflight.ok) {
    throw new Error(preflight.reason ?? 'Shared folder migration preflight failed.');
  }

  const provider = input.provider ?? 'generic-folder';
  const migrationId = `mig_${randomUUID().slice(0, 12)}`;
  const tempRootPath = join(destinationParentPath, `.craft-migrating-${migrationId}`);
  const startedAt = nowIso();
  const receiptPath = getMigrationReceiptPath(tempRootPath, migrationId);
  const receipt: TeamMigrationReceipt = {
    version: 1,
    migrationId,
    status: 'in-progress',
    sourceRootPath,
    destinationParentPath,
    finalRootPath: preflight.finalRootPath,
    provider,
    providerLabel: input.providerLabel,
    startedAt,
  };
  const sourceConfig = loadWorkspaceConfig(sourceRootPath);
  if (!sourceConfig) throw new Error(`Failed to load workspace config: ${sourceRootPath}`);
  let journal: TeamMigrationJournal = {
    version: 1,
    migrationId,
    workspaceId: sourceConfig.id,
    phase: input.initialPhase ?? 'prepared',
    sourceRootPath,
    destinationParentPath,
    finalRootPath: preflight.finalRootPath,
    provider,
    providerLabel: input.providerLabel,
    makeRunner: input.makeRunner,
    startedAt,
    updatedAt: startedAt,
  };
  writeJson(getLocalTeamMigrationJournalPath(sourceConfig.id, migrationId), journal);
  input.onPhase?.(journal.phase);

  try {
    mkdirSync(tempRootPath, { recursive: true });
    stagePrivateWorkspaceDirs(sourceRootPath, journal);
    writeJson(receiptPath, receipt);
    copyWorkspaceFilesConfigLast(sourceRootPath, tempRootPath);

    writeMigratedWorkspaceConfig(sourceRootPath, tempRootPath, {
      provider,
      providerLabel: input.providerLabel,
      makeRunner: input.makeRunner,
    });

    const readyReceipt: TeamMigrationReceipt = {
      ...receipt,
      status: input.deferCompletion ? 'ready' : 'complete',
      completedAt: input.deferCompletion ? undefined : nowIso(),
    };
    writeJson(receiptPath, readyReceipt);
    renameSync(tempRootPath, preflight.finalRootPath);
    fsyncPath(destinationParentPath);
    journal = updateTeamMigrationJournal(journal, 'destination-staged');
    input.onPhase?.('destination-staged');

    return {
      migrationId,
      originalRootPath: sourceRootPath,
      finalRootPath: preflight.finalRootPath,
      receiptPath: getMigrationReceiptPath(preflight.finalRootPath, migrationId),
      teamConfigPath: getTeamConfigFile(preflight.finalRootPath),
      journalPath: getLocalTeamMigrationJournalPath(sourceConfig.id, migrationId),
    };
  } catch (error) {
    try {
      if (existsSync(tempRootPath)) {
        writeJson(receiptPath, {
          ...receipt,
          status: 'failed',
          failedAt: nowIso(),
          error: error instanceof Error ? error.message : String(error),
        } satisfies TeamMigrationReceipt);
        rmSync(tempRootPath, { recursive: true, force: true });
      }
      if (existsSync(preflight.finalRootPath)) {
        rmSync(preflight.finalRootPath, { recursive: true, force: true });
      }
      rmSync(getPrivateMigrationStageRoot(journal.workspaceId), { recursive: true, force: true });
    } catch {
      // Original workspace remains authoritative when rollback cleanup fails.
    }
    updateTeamMigrationJournal(journal, 'rolled-back', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export function completePreparedWorkspaceMigration(result: TeamSharedFolderMigrationResult): void {
  promotePreparedPrivateSessions(result);
  const receipt = readJson<TeamMigrationReceipt>(result.receiptPath);
  if (!receipt || receipt.migrationId !== result.migrationId) {
    throw new Error(`Migration receipt is missing or invalid: ${result.receiptPath}`);
  }
  writeJson(result.receiptPath, {
    ...receipt,
    status: 'complete',
    completedAt: receipt.completedAt ?? nowIso(),
    failedAt: undefined,
    error: undefined,
  } satisfies TeamMigrationReceipt);
}

export function promotePreparedPrivateSessions(result: TeamSharedFolderMigrationResult): void {
  if (!result.journalPath) return;
  const journal = readTeamMigrationJournal(result.journalPath);
  if (!journal) throw new Error(`Migration journal is missing: ${result.journalPath}`);
  const stage = getPrivateSessionStageDir(journal);
  if (!existsSync(stage)) return;
  const destination = getPrivateSessionsDir(journal.workspaceId);
  copyDirectoryContents(stage, destination);
  rmSync(getPrivateMigrationStageRoot(journal.workspaceId), { recursive: true, force: true });
}

export function rollbackPreparedWorkspaceMigration(journal: TeamMigrationJournal): TeamMigrationJournal {
  if (existsSync(journal.finalRootPath)) {
    rmSync(journal.finalRootPath, { recursive: true, force: true });
  }
  const tempRootPath = join(journal.destinationParentPath, `.craft-migrating-${journal.migrationId}`);
  if (existsSync(tempRootPath)) rmSync(tempRootPath, { recursive: true, force: true });
  rmSync(getPrivateMigrationStageRoot(journal.workspaceId), { recursive: true, force: true });
  return updateTeamMigrationJournal(journal, 'rolled-back');
}

export function moveWorkspaceToSharedFolder(
  sourceRootPath: string,
  destinationParentPath: string,
  input: Omit<PrepareWorkspaceMoveOptions, 'deferCompletion'> = {},
): TeamSharedFolderMigrationResult {
  const result = prepareWorkspaceMoveToSharedFolder(sourceRootPath, destinationParentPath, {
    ...input,
    deferCompletion: false,
  });
  const journal = result.journalPath ? readTeamMigrationJournal(result.journalPath) : null;
  promotePreparedPrivateSessions(result);
  if (journal) updateTeamMigrationJournal(journal, 'complete');
  return result;
}

export function writeMovedToTombstone(
  originalRootPath: string,
  movedToPath: string,
  migrationId: string,
): WorkspaceConfig {
  const config = loadWorkspaceConfig(originalRootPath);
  if (!config) throw new Error(`Failed to load original workspace config: ${originalRootPath}`);
  const tombstone: WorkspaceConfig = {
    ...config,
    movedTo: {
      path: movedToPath,
      migrationId,
      movedAt: nowIso(),
    },
  };
  saveWorkspaceConfig(originalRootPath, tombstone, { allowMovedTombstoneWrite: true });
  return tombstone;
}

export { getMigrationReceiptPath };
