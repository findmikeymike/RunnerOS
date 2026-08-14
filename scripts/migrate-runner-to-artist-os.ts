#!/usr/bin/env bun

import { createHash, randomUUID } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

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
        'Credentials are never copied. Source data is never moved or deleted.',
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

function hashTree(root: string): Record<string, string> {
  const hashes: Record<string, string> = {};
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      const key = relative(root, path).replace(/\\/g, '/');
      const stats = lstatSync(path);
      if (stats.isDirectory()) walk(path);
      else if (stats.isSymbolicLink()) {
        throw new Error(`Workspace migration refuses symbolic links: ${path} -> ${readlinkSync(path)}`);
      }
      else hashes[key] = createHash('sha256').update(readFileSync(path)).digest('hex');
    }
  };
  walk(root);
  return hashes;
}

const SENSITIVE_FILENAMES = new Set([
  '.env',
  'auth.json',
  'credentials.enc',
  'credentials.json',
  'credentials.key',
  'token.json',
]);

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
      if (SENSITIVE_FILENAMES.has(entry.name.toLowerCase())) {
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

const runnerConfigPath = join(options.runnerRoot, 'config.json');
if (!existsSync(runnerConfigPath)) throw new Error(`Runner config not found: ${runnerConfigPath}`);
const runnerConfig = readConfig(runnerConfigPath);
const selected = options.workspaceIds.map((id) => {
  const workspace = runnerConfig.workspaces.find((candidate) => candidate.id === id);
  if (!workspace) throw new Error(`Workspace not found in Runner registry: ${id}`);
  if ((workspace.artistWorkspaceScope ?? 'general') === 'general' && !options.allowGeneral) {
    throw new Error(`Workspace ${id} is general/ambiguous. Re-run with --allow-general only if that explicit copy is intended.`);
  }
  const source = resolvePortablePath(workspace.rootPath);
  if (!existsSync(source) || !lstatSync(source).isDirectory()) throw new Error(`Workspace folder missing: ${source}`);
  assertWorkspaceContainsNoEmbeddedCredentials(source);
  const destination = join(options.artistRoot, 'workspaces', workspace.id);
  if (existsSync(destination)) throw new Error(`Destination already exists; refusing to overwrite: ${destination}`);
  return { workspace, source, destination, sourceHashes: hashTree(source) };
});

const preview = {
  mode: options.apply ? 'apply' : 'dry-run',
  runnerRoot: options.runnerRoot,
  artistRoot: options.artistRoot,
  credentials: 'not-copied-reconnect-required',
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
const committed: string[] = [];
try {
  for (const entry of staged) {
    mkdirSync(dirname(entry.path), { recursive: true });
    cpSync(entry.item.source, entry.path, { recursive: true, errorOnExist: true, force: false, dereference: false });
    const destinationHashes = hashTree(entry.path);
    if (JSON.stringify(destinationHashes) !== JSON.stringify(entry.item.sourceHashes)) {
      throw new Error(`Checksum mismatch after staging workspace ${entry.item.workspace.id}. Source remains untouched.`);
    }
  }
  for (const entry of staged) {
    renameSync(entry.path, entry.item.destination);
    committed.push(entry.item.destination);
  }
  atomicWriteJson(manifestPath, manifest);
  atomicWriteJson(artistConfigPath, artistConfig);
} catch (error) {
  for (const entry of staged) rmSync(entry.path, { recursive: true, force: true });
  for (const destination of committed) rmSync(destination, { recursive: true, force: true });
  rmSync(manifestPath, { force: true });
  throw error;
}
console.log(JSON.stringify({ ok: true, manifestPath, copied: selected.map((item) => item.workspace.id) }, null, 2));
