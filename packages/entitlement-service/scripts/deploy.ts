#!/usr/bin/env bun
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { entitlementVerificationKeyringFingerprint } from '../src/keys.ts';
import { buildGeneratedWranglerConfig, readDeploymentAuthority, type DeploymentEnvironment } from './deploy-contract.ts';

try {
  await main();
} catch (error) {
  console.error(`DEPLOYMENT BLOCKED: ${error instanceof Error ? error.message : 'Unknown deployment failure'}`);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const packageRoot = join(import.meta.dir, '..');
  const environment = process.argv[2] as DeploymentEnvironment;
  const checkOnly = process.argv.includes('--check');
  if (environment !== 'test' && environment !== 'production') throw new Error('Use test or production.');
  const authority = await readDeploymentAuthority(environment, process.env);
  const generatedConfigPath = join(packageRoot, `.wrangler-deploy.${process.pid}.json`);
  const secretRoot = mkdtempSync(join(tmpdir(), 'artistos-entitlement-secrets-'));
  const secretsPath = join(secretRoot, 'secrets.json');
  const logPath = join(tmpdir(), `artistos-wrangler-${environment}-${process.pid}.log`);
  try {
    writeFileSync(generatedConfigPath, `${JSON.stringify(buildGeneratedWranglerConfig(packageRoot, authority), null, 2)}\n`, { mode: 0o600 });
    writeFileSync(secretsPath, JSON.stringify(authority.workerSecrets), { mode: 0o600 });
    chmodSync(secretsPath, 0o600);
    if (checkOnly) {
      runWrangler(['deploy', '--dry-run', '--config', generatedConfigPath], packageRoot, authority, logPath);
      console.log(`Deployment contract ready: ${environment}`);
      return;
    }
    runWrangler(['secret', 'bulk', secretsPath, '--config', generatedConfigPath], packageRoot, authority, logPath);
    runWrangler(['d1', 'migrations', 'apply', `artistos-entitlement-${environment}`, '--remote', '--config', generatedConfigPath], packageRoot, authority, logPath);
    runWrangler(['deploy', '--config', generatedConfigPath], packageRoot, authority, logPath);
    await requireReady(authority.readinessUrl, authority);
    console.log(`Deployment verified ready: ${environment}`);
  } finally {
    rmSync(generatedConfigPath, { force: true });
    rmSync(secretRoot, { recursive: true, force: true });
    rmSync(logPath, { force: true });
  }
}

function runWrangler(
  args: string[],
  cwd: string,
  authority: Awaited<ReturnType<typeof readDeploymentAuthority>>,
  logPath: string,
): void {
  const result = Bun.spawnSync(['bun', 'x', 'wrangler', ...args], {
    cwd,
    env: {
      ...process.env,
      CLOUDFLARE_ACCOUNT_ID: authority.accountId,
      CLOUDFLARE_API_TOKEN: authority.apiToken,
      WRANGLER_LOG_PATH: logPath,
    },
    stdout: 'inherit', stderr: 'inherit',
  });
  if (result.exitCode !== 0) throw new Error(`Wrangler ${args[0]} failed.`);
}

async function requireReady(
  url: string,
  authority: Awaited<ReturnType<typeof readDeploymentAuthority>>,
): Promise<void> {
  const expectedFingerprint = await entitlementVerificationKeyringFingerprint(authority.serviceConfig.verificationKeysJson);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      const body = await response.json() as Record<string, unknown>;
      if (response.ok && body.ok === true && body.status === 'ready'
        && body.environment === authority.environment
        && body.currentKeyId === authority.serviceConfig.signingKeyIdCurrent
        && body.verificationKeyringFingerprint === expectedFingerprint) return;
    } catch {
      // A newly published Worker may need a brief propagation retry.
    }
    await Bun.sleep(2_000);
  }
  throw new Error('Published Worker did not pass the exact authority readiness check.');
}
