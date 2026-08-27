import { describe, expect, test } from 'bun:test';
import { exportJWK, exportPKCS8, generateKeyPair } from 'jose';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGeneratedWranglerConfig, readDeploymentAuthority, WORKER_SECRET_NAMES } from '../scripts/deploy-contract.ts';
import { entitlementVerificationKeyringFingerprint } from './keys.ts';

const packageRoot = join(import.meta.dir, '..');
const wranglerConfig = JSON.parse(readFileSync(join(packageRoot, 'wrangler.jsonc'), 'utf8')) as Record<string, any>;
const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
const deployWorkflow = readFileSync(join(packageRoot, '..', '..', '.github', 'workflows', 'deploy-entitlement-service.yml'), 'utf8');
const authorityTemplate = readFileSync(join(packageRoot, 'authority.env.example'), 'utf8');

describe('LIC6 deployment contract', () => {
  test('tracked Wrangler config contains no commerce or signing secrets', () => {
    expect(wranglerConfig.vars).toEqual({ ARTIST_OS_LICENSE_ENVIRONMENT: 'test' });
    expect(wranglerConfig.env?.production?.vars).toEqual({ ARTIST_OS_LICENSE_ENVIRONMENT: 'production' });
    const source = JSON.stringify(wranglerConfig);
    for (const secret of WORKER_SECRET_NAMES) expect(source).not.toContain(secret);
  });

  test('preflight rejects missing authority and a signing-key mismatch', async () => {
    await expect(readDeploymentAuthority('production', {})).rejects.toThrow('Missing deployment authority');
    const env = await validEnvironment();
    const other = await generateKeyPair('EdDSA', { extractable: true });
    env.ARTIST_OS_ENTITLEMENT_SIGNING_KEY_CURRENT = await exportPKCS8(other.privateKey);
    await expect(readDeploymentAuthority('production', env)).rejects.toThrow('does not match');
  });

  test('preflight validates exact authority and generates only the chosen D1 binding', async () => {
    const authority = await readDeploymentAuthority('production', await validEnvironment());
    const generated = buildGeneratedWranglerConfig(packageRoot, authority) as Record<string, any>;
    expect(generated.d1_databases[0].database_id).toBe(authority.databaseId);
    expect(generated.name).toBe('artistos-entitlement-production');
    expect(generated.vars.ARTIST_OS_LICENSE_ENVIRONMENT).toBe('production');
    expect(generated.env).toBeUndefined();
    expect(generated.main).toBe(join(packageRoot, 'src', 'worker.ts'));
    expect(packageJson.scripts['deploy:production']).toBe('bun scripts/deploy.ts production');
    expect(packageJson.scripts['deploy:check:production']).toBe('bun scripts/deploy.ts production --check');
  });

  test('github workflow exposes an auditable dry-run and deploy lane for test and production', () => {
    expect(deployWorkflow).toContain('workflow_dispatch:');
    expect(deployWorkflow).toContain('Deploy Entitlement Service');
    expect(deployWorkflow).toContain('environment:\n        description: Target entitlement environment');
    expect(deployWorkflow).toContain('- test');
    expect(deployWorkflow).toContain('- production');
    expect(deployWorkflow).toContain('mode:\n        description: Run a dry preflight or publish');
    expect(deployWorkflow).toContain("group: entitlement-${{ github.event.inputs.environment }}");
    expect(deployWorkflow).toContain('bun run --cwd packages/entitlement-service deploy:check');
    expect(deployWorkflow).toContain('bun run --cwd packages/entitlement-service deploy:check:production');
    expect(deployWorkflow).toContain('bun run --cwd packages/entitlement-service deploy:test');
    expect(deployWorkflow).toContain('bun run --cwd packages/entitlement-service deploy:production');
    for (const secret of [
      'CLOUDFLARE_API_TOKEN',
      'LEMON_API_KEY',
      'LEMON_WEBHOOK_SECRET',
      'ARTIST_OS_ENTITLEMENT_KEY_ID_CURRENT',
      'ARTIST_OS_ENTITLEMENT_SIGNING_KEY_CURRENT',
      'ARTIST_OS_ENTITLEMENT_VERIFICATION_KEYS_JSON',
    ]) expect(deployWorkflow).toContain(secret);
    for (const variable of [
      'CLOUDFLARE_ACCOUNT_ID',
      'ARTIST_OS_ENTITLEMENT_D1_DATABASE_ID_TEST',
      'ARTIST_OS_ENTITLEMENT_D1_DATABASE_ID_PRODUCTION',
      'ARTIST_OS_ENTITLEMENT_READY_URL_TEST',
      'ARTIST_OS_ENTITLEMENT_READY_URL_PRODUCTION',
      'LEMON_STORE_ID',
      'LEMON_PRODUCT_ID',
      'LEMON_VARIANT_ID_BASIC_V1',
      'LEMON_VARIANT_ID_PREMIUM_V1',
    ]) expect(deployWorkflow).toContain(variable);
  });

  test('tracked authority template names every required live authority without real values', () => {
    for (const name of [
      'CLOUDFLARE_ACCOUNT_ID',
      'CLOUDFLARE_API_TOKEN',
      'ARTIST_OS_ENTITLEMENT_D1_DATABASE_ID_PRODUCTION',
      'ARTIST_OS_ENTITLEMENT_READY_URL_PRODUCTION',
      'LEMON_STORE_ID',
      'LEMON_PRODUCT_ID',
      'LEMON_VARIANT_ID_BASIC_V1',
      'LEMON_VARIANT_ID_PREMIUM_V1',
      'LEMON_API_KEY',
      'LEMON_WEBHOOK_SECRET',
      'ARTIST_OS_ENTITLEMENT_KEY_ID_CURRENT',
      'ARTIST_OS_ENTITLEMENT_SIGNING_KEY_CURRENT',
      'ARTIST_OS_ENTITLEMENT_VERIFICATION_KEYS_JSON',
    ]) expect(authorityTemplate).toContain(`${name}=`);
    expect(authorityTemplate).toContain('Pricing is configured in Lemon Squeezy');
    expect(authorityTemplate).not.toContain('BEGIN PRIVATE KEY');
    expect(authorityTemplate).not.toContain('replace-with-live-api-key=');
  });

  test('authority fingerprint is stable across harmless JSON ordering differences', async () => {
    const left = '{"key-1":{"kty":"OKP","crv":"Ed25519","x":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}';
    const right = '{"key-1":{"x":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","crv":"Ed25519","kty":"OKP"}}';
    expect(await entitlementVerificationKeyringFingerprint(left))
      .toBe(await entitlementVerificationKeyringFingerprint(right));
  });
});

async function validEnvironment(): Promise<Record<string, string>> {
  const keys = await generateKeyPair('EdDSA', { extractable: true });
  const publicJwk = await exportJWK(keys.publicKey);
  return {
    CLOUDFLARE_ACCOUNT_ID: 'account-id',
    CLOUDFLARE_API_TOKEN: 'cloudflare-token',
    ARTIST_OS_ENTITLEMENT_D1_DATABASE_ID_PRODUCTION: '12345678-1234-1234-1234-123456789abc',
    ARTIST_OS_ENTITLEMENT_READY_URL_PRODUCTION: 'https://license.artistos.app/readyz',
    LEMON_STORE_ID: '1', LEMON_PRODUCT_ID: '2', LEMON_VARIANT_ID_BASIC_V1: 'disabled', LEMON_VARIANT_ID_PREMIUM_V1: '4',
    LEMON_API_KEY: 'lemon-api-key', LEMON_WEBHOOK_SECRET: 'lemon-webhook-secret',
    ARTIST_OS_ENTITLEMENT_KEY_ID_CURRENT: 'key-1',
    ARTIST_OS_ENTITLEMENT_SIGNING_KEY_CURRENT: await exportPKCS8(keys.privateKey),
    ARTIST_OS_ENTITLEMENT_VERIFICATION_KEYS_JSON: JSON.stringify({ 'key-1': publicJwk }),
  };
}
