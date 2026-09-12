#!/usr/bin/env bun

import { createHash, randomUUID } from 'node:crypto';
import {
  cpSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

interface WorkspaceRecord {
  id: string;
  name: string;
  rootPath: string;
  artistWorkspaceScope?: 'hq' | 'campaign' | 'general';
  [key: string]: unknown;
}

interface StoredConfig {
  workspaces: WorkspaceRecord[];
  activeWorkspaceId: string | null;
  activeSessionId: string | null;
  [key: string]: unknown;
}

interface Options {
  apply: boolean;
  allowGeneral: boolean;
  runnerRoot: string;
  artistRoot: string;
  workspaceIds: string[];
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    apply: false,
    allowGeneral: false,
    runnerRoot: join(homedir(), '.craft-agent'),
    artistRoot: join(homedir(), '.artist-os'),
    workspaceIds: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--allow-general') options.allowGeneral = true;
    else if (arg === '--runner-root') options.runnerRoot = argv[++index] ?? '';
    else if (arg === '--artist-root') options.artistRoot = argv[++index] ?? '';
    else if (arg === '--workspace') options.workspaceIds.push(argv[++index] ?? '');
    else if (arg === '--help') {
      console.log([
        'Selective Runner -> Artist OS workspace copier (dry-run by default)',
        '',
        '  --workspace <id>     required; repeat for multiple workspaces',
        '  --apply              perform the copy after a successful dry-run',
        '  --allow-general      permit an explicitly selected general workspace',
        '  --runner-root <path> override Runner root',
        '  --artist-root <path> override Artist OS root',
        '',
        'Known credential stores are rejected and must be reconnected. Source data is never moved or deleted.',
      ].join('\n'));
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  options.workspaceIds = [...new Set(options.workspaceIds.filter(Boolean))];
  if (options.workspaceIds.length === 0) throw new Error('At least one explicit --workspace <id> is required.');
  options.runnerRoot = resolve(options.runnerRoot);
  options.artistRoot = resolve(options.artistRoot);
  return options;
}

function isWithin(parent: string, candidate: string): boolean {
  const child = relative(resolve(parent), resolve(candidate));
  return child === '' || (!child.startsWith('..') && !isAbsolute(child));
}

// Resolve existing ancestors too: a not-yet-created destination can still sit
// beneath a symlink into the source tree or outside the selected profile.
function actualPath(path: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // A dangling symlink is not a missing directory we may safely create.
    try { lstatSync(path); } catch (statError) {
      if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError;
      const parent = dirname(path);
      if (parent === path) throw error;
      return join(actualPath(parent), relative(parent, path));
    }
    throw error;
  }
}

function assertSeparatePaths(a: string, b: string): void {
  if (isWithin(a, b) || isWithin(b, a)) {
    throw new Error('Source and destination roots must be completely separate.');
  }
}

function assertSafeDestination(source: string, destination: string, artistRoot: string): void {
  const actualArtist = actualPath(artistRoot);
  const actualDestination = actualPath(destination);
  assertSeparatePaths(actualPath(source), actualArtist);
  if (actualDestination === actualArtist || !isWithin(actualArtist, actualDestination)) {
    throw new Error('Workspace destination must remain inside the Artist OS root.');
  }
}

function readConfig(path: string): StoredConfig {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as StoredConfig;
  if (!Array.isArray(parsed.workspaces)) throw new Error(`Invalid workspace registry: ${path}`);
  return parsed;
}

function resolvePortablePath(value: string): string {
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return join(homedir(), value.slice(2));
  return resolve(value);
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function hashTree(root: string): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  const walk = async (directory: string): Promise<void> => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      const key = relative(root, path).replace(/\\/g, '/');
      const stats = lstatSync(path);
      if (stats.isDirectory()) await walk(path);
      else if (stats.isSymbolicLink()) {
        throw new Error(`Workspace migration refuses symbolic links: ${path} -> ${readlinkSync(path)}`);
      }
      else hashes[key] = await hashFile(path);
    }
  };
  await walk(root);
  return hashes;
}

const SENSITIVE_FILENAMES = new Set([
  '.env',
  '.credential-cache.json',
  'auth.json',
  'credentials.enc',
  'credentials.json',
  'credentials.key',
  'token.json',
]);

const SENSITIVE_FILENAME_PATTERNS = [
  /^\.env\..+$/i,
  /^(?:client[_-]?secret|service[_-]?account).*\.json$/i,
  /^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)(?:\..+)?$/i,
  /\.(?:p8|p12|pfx)$/i,
  /(?:^|[._-])private[._-]?key(?:[._-]|$)/i,
];

function isSensitiveFilename(name: string): boolean {
  const normalized = name.toLowerCase();
  return SENSITIVE_FILENAMES.has(normalized)
    || SENSITIVE_FILENAME_PATTERNS.some((pattern) => pattern.test(name));
}

function hasValues(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasValues);
  if (value && typeof value === 'object') return Object.values(value).some(hasValues);
  return value !== undefined && value !== null;
}

function valueAt(root: unknown, path: string[]): unknown {
  let current = root;
  for (const segment of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function assertWorkspaceContainsNoEmbeddedCredentials(root: string): void {
  const violations: string[] = [];
  const sourceSecretPaths = [
    ['mcp', 'env'],
    ['mcp', 'headers'],
    ['api', 'defaultHeaders'],
    ['api', 'testEndpoint', 'headers'],
    ['api', 'renewEndpoint', 'headers'],
    ['api', 'googleOAuthClientSecret'],
    ['api', 'oauth', 'clientSecret'],
  ];

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const relativePath = relative(root, path).replace(/\\/g, '/');
      const stats = lstatSync(path);
      if (stats.isSymbolicLink()) {
        violations.push(`${relativePath} (symbolic link)`);
        continue;
      }
      if (stats.isDirectory()) {
        walk(path);
        continue;
      }
      if (isSensitiveFilename(entry.name)) {
        violations.push(relativePath);
        continue;
      }
      if (!/(^|\/)sources\/[^/]+\/config\.json$/.test(relativePath)) continue;
      try {
        const config = JSON.parse(readFileSync(path, 'utf8')) as unknown;
        for (const secretPath of sourceSecretPaths) {
          if (hasValues(valueAt(config, secretPath))) {
            violations.push(`${relativePath}:${secretPath.join('.')}`);
          }
        }
      } catch {
        // Existing workspace validation owns malformed non-secret config files.
      }
    }
  };
  walk(root);

  if (violations.length > 0) {
    throw new Error(
      'Workspace contains embedded credentials or links that cannot cross the product boundary. ' +
      `Remove them and reconnect inside Artist OS:\n- ${violations.join('\n- ')}`,
    );
  }
}

function atomicWriteJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
}

const options = parseArgs(Bun.argv.slice(2));
if (isWithin(options.runnerRoot, options.artistRoot) || isWithin(options.artistRoot, options.runnerRoot)) {
  throw new Error('Runner and Artist OS roots must be completely separate.');
}

assertSeparatePaths(actualPath(options.runnerRoot), actualPath(options.artistRoot));

const runnerConfigPath = join(options.runnerRoot, 'config.json');
if (!existsSync(runnerConfigPath)) throw new Error(`Runner config not found: ${runnerConfigPath}`);
const runnerConfig = readConfig(runnerConfigPath);
const selected: Array<{
  workspace: WorkspaceRecord;
  source: string;
  destination: string;
  sourceHashes: Record<string, string>;
}> = [];
for (const id of options.workspaceIds) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) {
    throw new Error(`Invalid workspace ID: ${id}`);
  }
  const workspace = runnerConfig.workspaces.find((candidate) => candidate.id === id);
  if (!workspace) throw new Error(`Workspace not found in Runner registry: ${id}`);
  if ((workspace.artistWorkspaceScope ?? 'general') === 'general' && !options.allowGeneral) {
    throw new Error(`Workspace ${id} is general/ambiguous. Re-run with --allow-general only if that explicit copy is intended.`);
  }
  const source = resolvePortablePath(workspace.rootPath);
  if (!existsSync(source) || !lstatSync(source).isDirectory()) throw new Error(`Workspace folder missing: ${source}`);
  assertWorkspaceContainsNoEmbeddedCredentials(source);
  const destination = join(options.artistRoot, 'workspaces', workspace.id);
  assertSafeDestination(source, destination, options.artistRoot);
  if (existsSync(destination)) throw new Error(`Destination already exists; refusing to overwrite: ${destination}`);
  selected.push({ workspace, source, destination, sourceHashes: await hashTree(source) });
}

const preview = {
  mode: options.apply ? 'apply' : 'dry-run',
  runnerRoot: options.runnerRoot,
  artistRoot: options.artistRoot,
  credentials: 'known-stores-rejected-reconnect-required',
  sourceDataPolicy: 'copy-only-source-remains-untouched',
  workspaces: selected.map(({ workspace, source, destination, sourceHashes }) => ({
    id: workspace.id,
    name: workspace.name,
    scope: workspace.artistWorkspaceScope ?? 'general',
    source,
    destination,
    fileCount: Object.keys(sourceHashes).length,
    sourceHashes,
  })),
};

if (!options.apply) {
  console.log(JSON.stringify(preview, null, 2));
  process.exit(0);
}

const artistConfigPath = join(options.artistRoot, 'config.json');
const artistConfig: StoredConfig = existsSync(artistConfigPath)
  ? readConfig(artistConfigPath)
  : { workspaces: [], activeWorkspaceId: null, activeSessionId: null };
for (const item of selected) {
  if (artistConfig.workspaces.some((workspace) => workspace.id === item.workspace.id)) {
    throw new Error(`Artist OS registry already contains workspace ${item.workspace.id}; refusing to overwrite.`);
  }
  artistConfig.workspaces.push({ ...item.workspace, rootPath: item.destination });
}
artistConfig.activeWorkspaceId ??= selected[0]?.workspace.id ?? null;

const manifest = {
  ...preview,
  mode: 'applied',
  appliedAt: new Date().toISOString(),
  manifestId: randomUUID(),
  backup: 'Original Runner workspace folders remain unchanged at their source paths.',
};
const manifestPath = join(options.artistRoot, 'migrations', `runner-copy-${Date.now()}.json`);

// Copy into private staging folders first. Nothing becomes visible to Artist OS
// until every workspace passes checksum verification. If any later registry or
// manifest write fails, remove only destinations created by this invocation.
const staged = selected.map((item) => ({
  item,
  path: `${item.destination}.migration-${process.pid}-${randomUUID()}.tmp`,
}));
const owned = new Map<string, { dev: number; ino: number }>();
function rememberOwned(path: string): void {
  const { dev, ino } = lstatSync(path);
  owned.set(path, { dev, ino });
}
function removeOwned(path: string): void {
  const identity = owned.get(path);
  if (!identity) return;
  try {
    const current = lstatSync(path);
    if (current.dev === identity.dev && current.ino === identity.ino && current.isDirectory()) {
      rmSync(path, { recursive: true, force: true });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
const committed: string[] = [];
try {
  for (const entry of staged) {
    assertSafeDestination(entry.item.source, entry.path, options.artistRoot);
    mkdirSync(dirname(entry.path), { recursive: true });
    mkdirSync(entry.path); // Exclusive creation: cleanup never owns a pre-existing folder.
    rememberOwned(entry.path);
    cpSync(entry.item.source, entry.path, { recursive: true, errorOnExist: true, force: false, dereference: false });
    const destinationHashes = await hashTree(entry.path);
    if (JSON.stringify(destinationHashes) !== JSON.stringify(entry.item.sourceHashes)) {
      throw new Error(`Checksum mismatch after staging workspace ${entry.item.workspace.id}. Source remains untouched.`);
    }
  }
  for (const entry of staged) {
    assertSafeDestination(entry.item.source, entry.item.destination, options.artistRoot);
    if (existsSync(entry.item.destination)) throw new Error('Destination appeared during migration; refusing to overwrite.');
    renameSync(entry.path, entry.item.destination);
    owned.set(entry.item.destination, owned.get(entry.path)!);
    owned.delete(entry.path);
    committed.push(entry.item.destination);
  }
  atomicWriteJson(manifestPath, manifest);
  atomicWriteJson(artistConfigPath, artistConfig);
} catch (error) {
  for (const entry of staged) removeOwned(entry.path);
  for (const destination of committed) removeOwned(destination);
  rmSync(manifestPath, { force: true });
  throw error;
}
console.log(JSON.stringify({ ok: true, manifestPath, copied: selected.map((item) => item.workspace.id) }, null, 2));
