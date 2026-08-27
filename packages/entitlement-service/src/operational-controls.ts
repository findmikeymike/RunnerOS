import type { EntitlementServiceConfigV1 } from './config.ts';

const WINDOW_MS = 15 * 60_000;
const ROUTE_LIMITS = {
  activate: { network: 30, license: 10 },
  validate: { network: 120, license: 30 },
  deactivate: { network: 30, license: 15 },
} as const;

export type EntitlementAction = keyof typeof ROUTE_LIMITS;

export interface RequestAuthority {
  correlationId: string;
  networkSha256: string;
  licenseSha256: string;
}

export async function deriveRequestAuthority(
  request: Request,
  body: unknown,
  correlationId = crypto.randomUUID(),
): Promise<RequestAuthority> {
  const network = coarseNetwork(request.headers.get('CF-Connecting-IP'));
  const licenseKey = readLicenseKey(body);
  return {
    correlationId,
    networkSha256: await sha256Hex(`network\0${network}`),
    licenseSha256: await sha256Hex(`license\0${licenseKey ?? 'missing'}`),
  };
}

export async function consumeRequestLimits(
  db: D1Database,
  environment: EntitlementServiceConfigV1['environment'],
  action: EntitlementAction,
  authority: RequestAuthority,
  nowMs = Date.now(),
): Promise<boolean> {
  const windowStartedAt = Math.floor(nowMs / WINDOW_MS) * WINDOW_MS;
  const limits = ROUTE_LIMITS[action];
  const [network, license] = await Promise.all([
    increment(db, environment, 'network', authority.networkSha256, action, windowStartedAt),
    increment(db, environment, 'license', authority.licenseSha256, action, windowStartedAt),
  ]);
  return network <= limits.network && license <= limits.license;
}

export async function recordOperationalAudit(
  db: D1Database,
  environment: EntitlementServiceConfigV1['environment'],
  action: EntitlementAction,
  outcome: string,
  authority: RequestAuthority,
  now = new Date(),
): Promise<void> {
  const rateCutoff = Math.floor((now.getTime() - 24 * 60 * 60_000) / WINDOW_MS) * WINDOW_MS;
  const auditCutoff = new Date(now.getTime() - 90 * 24 * 60 * 60_000).toISOString();
  const results = await db.batch([
    db.prepare(`
      INSERT INTO operational_audit (
        correlation_id, environment, action, outcome, network_sha256, license_sha256, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      authority.correlationId,
      environment,
      action,
      sanitizeOutcome(outcome),
      authority.networkSha256,
      authority.licenseSha256,
      now.toISOString(),
    ),
    db.prepare('DELETE FROM request_rate_limits WHERE window_started_at < ?').bind(rateCutoff),
    db.prepare('DELETE FROM operational_audit WHERE occurred_at < ?').bind(auditCutoff),
  ]);
  if (!results.every((result) => result.success)) throw new Error('Operational audit unavailable');
}

export async function syncSigningKeyMetadata(
  db: D1Database,
  config: EntitlementServiceConfigV1,
  now = new Date(),
): Promise<void> {
  const parsed = JSON.parse(config.verificationKeysJson) as Record<string, Record<string, unknown>>;
  const seenAt = now.toISOString();
  const existing = await db.prepare(`
    SELECT key_id, public_key_sha256 FROM signing_keys WHERE environment = ?
  `).bind(config.environment).all<{ key_id: string; public_key_sha256: string }>();
  const fingerprints = new Map(await Promise.all(Object.entries(parsed).map(async ([keyId, jwk]) => (
    [keyId, await sha256Hex(canonicalJson(jwk))] as const
  ))));
  for (const row of existing.results) {
    const configured = fingerprints.get(row.key_id);
    if (!configured) throw new Error('Historic entitlement verification key is missing');
    if (configured !== row.public_key_sha256) throw new Error('Entitlement key ID changed public authority');
  }
  const statements = Object.entries(parsed).map(([keyId]) => db.prepare(`
    INSERT INTO signing_keys (
      environment, key_id, public_key_sha256, lifecycle, first_seen_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(environment, key_id) DO UPDATE SET
      public_key_sha256=excluded.public_key_sha256,
      lifecycle=excluded.lifecycle,
      last_seen_at=excluded.last_seen_at
  `).bind(
    config.environment,
    keyId,
    fingerprints.get(keyId)!,
    keyId === config.signingKeyIdCurrent ? 'current' : 'retired',
    seenAt,
    seenAt,
  ));
  const results = await db.batch([
    db.prepare("UPDATE signing_keys SET lifecycle = 'retired', last_seen_at = ? WHERE environment = ? AND lifecycle = 'current' AND key_id <> ?")
      .bind(seenAt, config.environment, config.signingKeyIdCurrent),
    ...statements,
  ]);
  if (!results.every((result) => result.success)) throw new Error('Signing key metadata unavailable');
}

function coarseNetwork(value: string | null): string {
  if (!value || value.length > 64) return 'unknown';
  const ipv4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
  if (ipv4 && ipv4.slice(1).every((part) => Number(part) <= 255)) return `${ipv4[1]}.${ipv4[2]}.${ipv4[3]}.0/24`;
  if (/^[0-9a-f:]+$/i.test(value) && value.includes(':')) return `${value.toLowerCase().split(':').slice(0, 4).join(':')}::/56`;
  return 'unknown';
}

function readLicenseKey(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const value = (body as Record<string, unknown>).licenseKey;
  if (typeof value !== 'string') return null;
  const canonical = value.trim();
  return canonical.length > 0 && canonical.length <= 256 ? canonical : null;
}

async function increment(
  db: D1Database,
  environment: string,
  dimension: 'network' | 'license',
  subjectSha256: string,
  route: EntitlementAction,
  windowStartedAt: number,
): Promise<number> {
  const row = await db.prepare(`
    INSERT INTO request_rate_limits (
      environment, dimension, subject_sha256, route, window_started_at, request_count
    ) VALUES (?, ?, ?, ?, ?, 1)
    ON CONFLICT(environment, dimension, subject_sha256, route, window_started_at)
    DO UPDATE SET request_count=request_count + 1
    RETURNING request_count
  `).bind(environment, dimension, subjectSha256, route, windowStartedAt).first<{ request_count: number }>();
  if (!row || !Number.isSafeInteger(row.request_count) || row.request_count < 1) throw new Error('Rate limit state unavailable');
  return row.request_count;
}

function sanitizeOutcome(value: string): string {
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : 'INTERNAL_ERROR';
}

function canonicalJson(value: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
