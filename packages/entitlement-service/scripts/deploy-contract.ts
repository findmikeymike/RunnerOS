import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readEntitlementServiceConfig, type EntitlementServiceConfigV1 } from '../src/config.ts';
import { loadEntitlementSigningMaterial } from '../src/keys.ts';

export type DeploymentEnvironment = 'test' | 'production';

export const WORKER_SECRET_NAMES = [
  'LEMON_STORE_ID',
  'LEMON_PRODUCT_ID',
  'LEMON_VARIANT_ID_BASIC_V1',
  'LEMON_VARIANT_ID_PREMIUM_V1',
  'LEMON_API_KEY',
  'LEMON_WEBHOOK_SECRET',
  'ARTIST_OS_ENTITLEMENT_KEY_ID_CURRENT',
  'ARTIST_OS_ENTITLEMENT_SIGNING_KEY_CURRENT',
  'ARTIST_OS_ENTITLEMENT_VERIFICATION_KEYS_JSON',
] as const;

export interface DeploymentAuthority {
  environment: DeploymentEnvironment;
  accountId: string;
  apiToken: string;
  databaseId: string;
  readinessUrl: string;
  serviceConfig: EntitlementServiceConfigV1;
  workerSecrets: Record<(typeof WORKER_SECRET_NAMES)[number], string>;
}

export async function readDeploymentAuthority(
  environment: DeploymentEnvironment,
  env: Readonly<Record<string, string | undefined>>,
): Promise<DeploymentAuthority> {
  const required = [
    'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN',
    `ARTIST_OS_ENTITLEMENT_D1_DATABASE_ID_${environment.toUpperCase()}`,
    `ARTIST_OS_ENTITLEMENT_READY_URL_${environment.toUpperCase()}`,
    ...WORKER_SECRET_NAMES,
  ];
  const missing = required.filter((name) => !env[name]?.trim());
  if (missing.length > 0) throw new Error(`Missing deployment authority: ${missing.join(', ')}`);
  const configResult = readEntitlementServiceConfig({
    ...env,
    ARTIST_OS_LICENSE_ENVIRONMENT: environment,
  });
  if (!configResult.ok) throw new Error(`Invalid entitlement authority: ${configResult.missing.join(', ')}`);
  await loadEntitlementSigningMaterial(configResult.config);
  const databaseId = env[`ARTIST_OS_ENTITLEMENT_D1_DATABASE_ID_${environment.toUpperCase()}`]!.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(databaseId) || /replace|placeholder/i.test(databaseId)) {
    throw new Error('Invalid D1 database ID');
  }
  const readinessUrl = new URL(env[`ARTIST_OS_ENTITLEMENT_READY_URL_${environment.toUpperCase()}`]!);
  if (readinessUrl.protocol !== 'https:' || readinessUrl.pathname !== '/readyz' || readinessUrl.search || readinessUrl.hash) {
    throw new Error('Readiness URL must be an exact HTTPS /readyz endpoint');
  }
  const workerSecrets = Object.fromEntries(
    WORKER_SECRET_NAMES.map((name) => [name, env[name]!.trim()]),
  ) as DeploymentAuthority['workerSecrets'];
  return {
    environment,
    accountId: env.CLOUDFLARE_ACCOUNT_ID!.trim(),
    apiToken: env.CLOUDFLARE_API_TOKEN!.trim(),
    databaseId,
    readinessUrl: readinessUrl.toString(),
    serviceConfig: configResult.config,
    workerSecrets,
  };
}

export function buildGeneratedWranglerConfig(
  packageRoot: string,
  authority: DeploymentAuthority,
): Record<string, unknown> {
  const source = JSON.parse(readFileSync(join(packageRoot, 'wrangler.jsonc'), 'utf8')) as Record<string, any>;
  const selected = authority.environment === 'production' ? source.env?.production : null;
  const target = structuredClone(selected ? { ...source, ...selected } : source);
  delete target.env;
  const database = target.d1_databases?.[0];
  if (!database) throw new Error('Wrangler D1 binding is missing');
  database.database_id = authority.databaseId;
  target.main = join(packageRoot, 'src', 'worker.ts');
  database.migrations_dir = join(packageRoot, 'migrations');
  return target;
}
