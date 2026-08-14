import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

export type RuntimeProductVariant = 'runner' | 'artist-os';

export interface RuntimeIdentity {
  variant: RuntimeProductVariant;
  productName: 'Runner' | 'Artist OS';
  appId: 'com.findmikeymike.runner' | 'com.findmikeymike.artistos';
  deeplinkScheme: 'craftagents' | 'artistos';
  dataRoot: string;
  workspacesRoot: string;
  credentialsFile: string;
  credentialsKeyFile: string;
  logsRoot: string;
  browserDataRoot: string;
  integrationCacheRoot: string;
  socialDataRoot: string;
  agentsRoot: string;
  agentsDir: string;
  skillsDir: string;
  sourcesDir: string;
  workflowsDir: string;
  keychainService: 'com.findmikeymike.runner.credentials' | 'com.findmikeymike.artistos.credentials';
  rpcNamespace: 'runner' | 'artist-os';
  defaultRpcPort: 9100 | 9200;
  defaultTriggerPort: 9101 | 9201;
  updateFeedUrl: string;
}

export interface ResolveRuntimeIdentityOptions {
  env?: Record<string, string | undefined>;
  homeDir?: string;
}

const VARIANT_ENV = 'CRAFT_PRODUCT_VARIANT';

function bundledProductVariant(): RuntimeProductVariant | undefined {
  try {
    return process.env.CRAFT_PRODUCT_VARIANT === 'artist-os' ? 'artist-os' : undefined;
  } catch {
    return undefined;
  }
}

function assertVariant(value: string | undefined): RuntimeProductVariant {
  if (value === undefined || value === '' || value === 'runner') return 'runner';
  if (value === 'artist-os') return value;
  throw new Error(`Invalid ${VARIANT_ENV} value "${value}". Expected "runner" or "artist-os".`);
}

function isWithin(parent: string, candidate: string): boolean {
  const child = relative(resolve(parent), resolve(candidate));
  return child === '' || (!child.startsWith('..') && !isAbsolute(child));
}

function resolveDataRoot(
  variant: RuntimeProductVariant,
  env: Record<string, string | undefined>,
  homeDir: string,
): string {
  const runnerRoot = resolve(homeDir, '.craft-agent');
  const configured = env.CRAFT_CONFIG_DIR?.trim();
  const fallback = join(homeDir, variant === 'artist-os' ? '.artist-os' : '.craft-agent');
  const dataRoot = resolve(configured || fallback);

  if (variant === 'artist-os' && isWithin(runnerRoot, dataRoot)) {
    throw new Error(
      `Artist OS refuses to use Runner's data root (${dataRoot}). ` +
      'Set CRAFT_CONFIG_DIR to an isolated Artist OS directory or remove the override.',
    );
  }

  return dataRoot;
}

export function resolveRuntimeIdentity(
  options: ResolveRuntimeIdentityOptions = {},
): RuntimeIdentity {
  const env = options.env ?? process.env;
  const homeDir = resolve(options.homeDir ?? homedir());
  const variant = assertVariant(env[VARIANT_ENV] ?? (options.env ? undefined : bundledProductVariant()));
  const dataRoot = resolveDataRoot(variant, env, homeDir);

  if (variant === 'artist-os') {
    const agentsRoot = join(dataRoot, 'libraries', 'agents');
    return Object.freeze({
      variant,
      productName: 'Artist OS',
      appId: 'com.findmikeymike.artistos',
      deeplinkScheme: 'artistos',
      dataRoot,
      workspacesRoot: join(dataRoot, 'workspaces'),
      credentialsFile: join(dataRoot, 'credentials.enc'),
      credentialsKeyFile: join(dataRoot, 'credentials.key'),
      logsRoot: join(dataRoot, 'logs'),
      browserDataRoot: join(dataRoot, 'electron'),
      integrationCacheRoot: join(dataRoot, 'cache', 'integrations'),
      socialDataRoot: join(dataRoot, 'integrations', 'social'),
      agentsRoot,
      agentsDir: join(agentsRoot, 'agents'),
      skillsDir: join(agentsRoot, 'skills'),
      sourcesDir: join(agentsRoot, 'sources'),
      workflowsDir: join(dataRoot, 'libraries', 'workflows'),
      keychainService: 'com.findmikeymike.artistos.credentials',
      rpcNamespace: 'artist-os',
      defaultRpcPort: 9200,
      defaultTriggerPort: 9201,
      updateFeedUrl: 'https://github.com/findmikeymike/ArtistOS/releases/latest/download',
    });
  }

  const agentsRoot = join(homeDir, '.agents');
  return Object.freeze({
    variant,
    productName: 'Runner',
    appId: 'com.findmikeymike.runner',
    deeplinkScheme: 'craftagents',
    dataRoot,
    workspacesRoot: join(dataRoot, 'workspaces'),
    credentialsFile: join(dataRoot, 'credentials.enc'),
    credentialsKeyFile: join(dataRoot, 'credentials.key'),
    logsRoot: join(dataRoot, 'logs'),
    browserDataRoot: join(dataRoot, 'electron'),
    integrationCacheRoot: join(homeDir, '.config', 'runneros'),
    socialDataRoot: join(homeDir, '.config', 'printing-press-clis'),
    agentsRoot,
    agentsDir: join(agentsRoot, 'agents'),
    skillsDir: join(agentsRoot, 'skills'),
    sourcesDir: join(agentsRoot, 'sources'),
    workflowsDir: join(homeDir, '.workflows'),
    keychainService: 'com.findmikeymike.runner.credentials',
    rpcNamespace: 'runner',
    defaultRpcPort: 9100,
    defaultTriggerPort: 9101,
    updateFeedUrl: 'https://github.com/findmikeymike/RunnerOS/releases/latest/download',
  });
}

export const RUNTIME_IDENTITY = resolveRuntimeIdentity();

export function assertPathWithinProductRoot(candidate: string): string {
  const resolved = resolve(candidate);
  if (!isWithin(RUNTIME_IDENTITY.dataRoot, resolved)) {
    throw new Error(
      `${RUNTIME_IDENTITY.productName} refused a product-managed path outside its data root: ${resolved}`,
    );
  }
  return resolved;
}
