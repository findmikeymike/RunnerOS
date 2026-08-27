#!/usr/bin/env bun
import { entitlementVerificationKeyringFingerprint } from '../packages/entitlement-service/src/keys.ts';

const readyUrl = process.env.ARTIST_OS_ENTITLEMENT_READY_URL_PRODUCTION;
const currentKeyId = process.env.ARTIST_OS_ENTITLEMENT_KEY_ID_CURRENT;
const verificationKeysJson = process.env.ARTIST_OS_ENTITLEMENT_VERIFICATION_KEYS_JSON;
if (!readyUrl || !currentKeyId || !verificationKeysJson) fail('Missing production Artist OS entitlement release authority.');

const url = new URL(readyUrl);
if (url.protocol !== 'https:' || url.pathname !== '/readyz' || url.search || url.hash) {
  fail('Production Artist OS entitlement readiness URL must be exact HTTPS /readyz.');
}
const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
const body = await response.json() as Record<string, unknown>;
const fingerprint = await entitlementVerificationKeyringFingerprint(verificationKeysJson);
if (!response.ok || body.ok !== true || body.status !== 'ready' || body.environment !== 'production'
  || body.currentKeyId !== currentKeyId || body.verificationKeyringFingerprint !== fingerprint) {
  fail('Desktop Artist OS entitlement keys do not match the production licensing service.');
}
console.log('Production Artist OS entitlement release authority verified.');

function fail(message: string): never {
  console.error(`RELEASE BLOCKED: ${message}`);
  process.exit(1);
}
