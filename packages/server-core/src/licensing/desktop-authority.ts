import {
  ARTIST_OS_APP_ID,
  ARTIST_OS_PRODUCT,
  type ActivateEntitlementRequestV1,
  type EntitlementFailureCode,
  type ArtistOSActivateInputV1,
  type ArtistOSEntitlementBinding,
  type ArtistOSLicenseCommandResultV1,
  type ArtistOSLicenseSnapshotV1,
  type ValidateEntitlementRequestV1,
} from '@craft-agent/shared/licensing';
import { verifyArtistOSEntitlementToken, type ArtistOSEntitlementKeyring } from './entitlement-verify.ts';

export interface DesktopLicenseRecordV1 {
  schemaVersion: 1;
  installationId: string;
  purchaseEmail: string;
  licenseKey: string;
  signedEntitlement: string;
  maskedEmail: string;
  licenseLastFour: string;
  revokedAt: string | null;
  revocationCode: EntitlementFailureCode | null;
}

export interface DesktopLicenseRecordStore {
  read(): Promise<unknown | null>;
  write(record: DesktopLicenseRecordV1): Promise<void>;
  remove(): Promise<void>;
  quarantine(): Promise<void>;
}

export interface InstallationIdentityStore {
  getOrCreate(): Promise<string>;
}

export type EntitlementServiceResult =
  | { ok: true; signedEntitlement: string; maskedEmail: string; lastFour: string; seatLimit: 3; status: 'active'; refreshAfter: string }
  | EntitlementServiceFailure;

export interface EntitlementServiceFailure {
  ok: false;
  code: EntitlementFailureCode;
  retryable: boolean;
  schemaVersion?: 1;
  correlationId?: string;
  safeMessage?: string;
}

export interface DesktopEntitlementServiceClient {
  activate(input: ActivateEntitlementRequestV1): Promise<EntitlementServiceResult>;
  validate(input: ValidateEntitlementRequestV1): Promise<EntitlementServiceResult>;
  deactivate(input: ValidateEntitlementRequestV1): Promise<{ ok: true } | EntitlementServiceFailure>;
}

export interface DesktopEntitlementAuthorityOptions {
  packaged: boolean;
  appVersion: string;
  architecture: 'arm64' | 'x64';
  keyring: ArtistOSEntitlementKeyring;
  installationStore: InstallationIdentityStore;
  recordStore: DesktopLicenseRecordStore;
  service: DesktopEntitlementServiceClient;
  now?: () => number;
  randomUuid?: () => string;
}

const TERMINAL_CODES = new Set<EntitlementFailureCode>([
  'INVALID_LICENSE', 'LICENSE_EXPIRED', 'LICENSE_DISABLED', 'INSTANCE_NOT_FOUND',
]);

export class DesktopEntitlementAuthority {
  private snapshot: ArtistOSLicenseSnapshotV1 = emptySnapshot('UNLICENSED');
  private installationId: string | null = null;
  private record: DesktopLicenseRecordV1 | null = null;
  private operation: Promise<ArtistOSLicenseCommandResultV1> | null = null;
  private operationKey: string | null = null;
  private readonly listeners = new Set<(snapshot: ArtistOSLicenseSnapshotV1) => void>();

  constructor(private readonly options: DesktopEntitlementAuthorityOptions) {}

  async initialize(): Promise<ArtistOSLicenseSnapshotV1> {
    if (!this.options.packaged) {
      this.setSnapshot({ ...emptySnapshot('ACTIVE'), authorized: true, development: true, safeMessage: 'Development entitlement' });
      return this.getSnapshot();
    }
    let raw: unknown | null;
    try {
      this.installationId = await this.options.installationStore.getOrCreate();
      raw = await this.options.recordStore.read();
    } catch {
      this.setSnapshot({ ...emptySnapshot('CORRUPT'), safeMessage: 'Protected license storage is unavailable.' });
      return this.getSnapshot();
    }
    if (raw === null) return this.getSnapshot();
    const record = parseRecord(raw, this.installationId);
    if (!record) {
      await this.options.recordStore.quarantine();
      this.setSnapshot({ ...emptySnapshot('CORRUPT'), safeMessage: 'License record needs recovery.' });
      return this.getSnapshot();
    }
    this.record = record;
    if (record.revokedAt) {
      this.setSnapshot(snapshotFromRecord('REVOKED', false, record, null, 'License is no longer active.'));
      return this.getSnapshot();
    }
    const verified = await this.verify(record.signedEntitlement);
    if (!verified.ok || verified.entitlement.status !== 'active') {
      await this.options.recordStore.quarantine();
      this.record = null;
      this.setSnapshot({ ...emptySnapshot('CORRUPT'), safeMessage: 'License record needs recovery.' });
      return this.getSnapshot();
    }
    const due = Date.parse(verified.entitlement.refreshAfter) <= this.now();
    this.setSnapshot(snapshotFromRecord(due ? 'REFRESH_DUE' : 'ACTIVE', true, record, verified.entitlement));
    return this.getSnapshot();
  }

  getSnapshot(): ArtistOSLicenseSnapshotV1 {
    return { ...this.snapshot };
  }

  isPaidExecutionAuthorized(): boolean {
    return this.snapshot.authorized;
  }

  subscribe(listener: (snapshot: ArtistOSLicenseSnapshotV1) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  activate(input: ArtistOSActivateInputV1): Promise<ArtistOSLicenseCommandResultV1> {
    return this.runExclusive(`activate:${input.email.toLowerCase()}:${input.licenseKey}`, async () => {
      await this.ensureInstallation();
      this.setSnapshot({ ...this.snapshot, state: 'ACTIVATING', safeMessage: null });
      const response = await this.options.service.activate(this.request(input.email, input.licenseKey));
      if (!response.ok) return await this.applyFailure(response);
      const verified = await this.verify(response.signedEntitlement);
      if (!verified.ok || verified.entitlement.status !== 'active') return this.corruptResult();
      if (response.lastFour !== input.licenseKey.slice(-4)) return this.corruptResult();
      const record: DesktopLicenseRecordV1 = {
        schemaVersion: 1,
        installationId: this.installationId!,
        purchaseEmail: input.email,
        licenseKey: input.licenseKey,
        signedEntitlement: response.signedEntitlement,
        maskedEmail: response.maskedEmail,
        licenseLastFour: response.lastFour,
        revokedAt: null,
        revocationCode: null,
      };
      await this.options.recordStore.write(record);
      this.record = record;
      const state = Date.parse(verified.entitlement.refreshAfter) <= this.now() ? 'REFRESH_DUE' : 'ACTIVE';
      this.setSnapshot(snapshotFromRecord(state, true, record, verified.entitlement));
      return { ok: true, snapshot: this.getSnapshot() };
    });
  }

  refresh(): Promise<ArtistOSLicenseCommandResultV1> {
    return this.runExclusive('refresh', async () => {
      if (!this.record || this.record.revokedAt) return { ok: false, snapshot: this.getSnapshot() };
      const response = await this.options.service.validate(this.validateRequest(this.record));
      if (!response.ok) return await this.applyFailure(response);
      const verified = await this.verify(response.signedEntitlement);
      if (!verified.ok || verified.entitlement.status !== 'active') {
        this.setSnapshot({ ...this.snapshot, state: 'SERVICE_UNAVAILABLE', authorized: true, safeMessage: 'License response could not be verified; offline access remains active.' });
        return { ok: false, snapshot: this.getSnapshot() };
      }
      const updated = { ...this.record, signedEntitlement: response.signedEntitlement, maskedEmail: response.maskedEmail, licenseLastFour: response.lastFour };
      await this.options.recordStore.write(updated);
      this.record = updated;
      this.setSnapshot(snapshotFromRecord('ACTIVE', true, updated, verified.entitlement));
      return { ok: true, snapshot: this.getSnapshot() };
    });
  }

  deactivate(): Promise<ArtistOSLicenseCommandResultV1> {
    return this.runExclusive('deactivate', async () => {
      if (!this.record) return { ok: true, snapshot: this.getSnapshot() };
      const response = await this.options.service.deactivate(this.validateRequest(this.record));
      if (!response.ok) return await this.applyFailure(response);
      await this.options.recordStore.remove();
      this.record = null;
      this.setSnapshot(emptySnapshot('UNLICENSED'));
      return { ok: true, snapshot: this.getSnapshot() };
    });
  }

  private async ensureInstallation(): Promise<void> {
    this.installationId ??= await this.options.installationStore.getOrCreate();
  }

  private request(email: string, licenseKey: string): ActivateEntitlementRequestV1 {
    return { schemaVersion: 1, email, licenseKey, installationId: this.installationId!, appVersion: this.options.appVersion, platform: 'macos', architecture: this.options.architecture, requestId: (this.options.randomUuid ?? crypto.randomUUID)() };
  }

  private validateRequest(record: DesktopLicenseRecordV1): ValidateEntitlementRequestV1 {
    const entitlement = decodePayload(record.signedEntitlement);
    return { ...this.request(record.purchaseEmail, record.licenseKey), activationInstanceId: entitlement?.activationInstanceId ?? '', signedEntitlement: record.signedEntitlement };
  }

  private verify(token: string) {
    return verifyArtistOSEntitlementToken(token, this.options.keyring, binding(this.installationId!), this.now());
  }

  private async applyFailure(response: Extract<EntitlementServiceResult, { ok: false }>): Promise<ArtistOSLicenseCommandResultV1> {
    if (TERMINAL_CODES.has(response.code) && this.record) {
      const revoked = { ...this.record, revokedAt: new Date(this.now()).toISOString(), revocationCode: response.code };
      await this.options.recordStore.write(revoked);
      this.record = revoked;
      this.setSnapshot(snapshotFromRecord('REVOKED', false, revoked, null, 'License is no longer active.'));
    } else if (response.code === 'SEAT_LIMIT_REACHED') {
      this.setSnapshot({ ...this.snapshot, state: 'SEAT_LIMIT_REACHED', safeMessage: 'All licensed installations are already in use.' });
    } else if (TERMINAL_CODES.has(response.code)) {
      this.setSnapshot({ ...emptySnapshot('UNLICENSED'), safeMessage: 'License key or purchase email was not accepted.' });
    } else {
      const authorized = Boolean(this.record) && this.snapshot.authorized;
      this.setSnapshot({ ...this.snapshot, state: 'SERVICE_UNAVAILABLE', authorized, safeMessage: 'License service is temporarily unavailable.' });
    }
    return { ok: false, snapshot: this.getSnapshot() };
  }

  private corruptResult(): ArtistOSLicenseCommandResultV1 {
    this.setSnapshot({ ...emptySnapshot('CORRUPT'), safeMessage: 'License response could not be verified.' });
    return { ok: false, snapshot: this.getSnapshot() };
  }

  private runExclusive(key: string, task: () => Promise<ArtistOSLicenseCommandResultV1>): Promise<ArtistOSLicenseCommandResultV1> {
    if (this.operation) {
      return this.operationKey === key
        ? this.operation
        : Promise.resolve({ ok: false, snapshot: this.getSnapshot() });
    }
    this.operationKey = key;
    const operation = task().finally(() => {
      if (this.operation === operation) {
        this.operation = null;
        this.operationKey = null;
      }
    });
    this.operation = operation;
    return operation;
  }

  private setSnapshot(snapshot: ArtistOSLicenseSnapshotV1): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener(this.getSnapshot());
  }

  private now(): number { return (this.options.now ?? Date.now)(); }
}

function binding(installationId: string): ArtistOSEntitlementBinding {
  return { installationId, appId: ARTIST_OS_APP_ID, product: ARTIST_OS_PRODUCT, majorVersion: 1, distributionChannel: 'direct' };
}

function emptySnapshot(state: ArtistOSLicenseSnapshotV1['state']): ArtistOSLicenseSnapshotV1 {
  return { schemaVersion: 1, state, authorized: false, development: false, maskedEmail: null, licenseLastFour: null, edition: null, plan: null, seatLimit: null, lastValidatedAt: null, refreshAfter: null, safeMessage: null };
}

function snapshotFromRecord(state: ArtistOSLicenseSnapshotV1['state'], authorized: boolean, record: DesktopLicenseRecordV1, entitlement: { edition: NonNullable<ArtistOSLicenseSnapshotV1['edition']>; plan: NonNullable<ArtistOSLicenseSnapshotV1['plan']>; seatLimit: 3; lastValidatedAt: string; refreshAfter: string } | null, safeMessage: string | null = null): ArtistOSLicenseSnapshotV1 {
  return { schemaVersion: 1, state, authorized, development: false, maskedEmail: record.maskedEmail, licenseLastFour: record.licenseLastFour, edition: entitlement?.edition ?? null, plan: entitlement?.plan ?? null, seatLimit: entitlement?.seatLimit ?? null, lastValidatedAt: entitlement?.lastValidatedAt ?? null, refreshAfter: entitlement?.refreshAfter ?? null, safeMessage };
}

function parseRecord(input: unknown, installationId: string): DesktopLicenseRecordV1 | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  const keys = ['installationId', 'licenseKey', 'licenseLastFour', 'maskedEmail', 'purchaseEmail', 'revocationCode', 'revokedAt', 'schemaVersion', 'signedEntitlement'];
  if (Object.keys(value).sort().join('\0') !== keys.join('\0')) return null;
  if (value.schemaVersion !== 1 || value.installationId !== installationId) return null;
  if (![value.purchaseEmail, value.licenseKey, value.signedEntitlement, value.maskedEmail, value.licenseLastFour].every((item) => typeof item === 'string')) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.purchaseEmail as string)
    || (value.purchaseEmail as string).length > 320
    || (value.licenseKey as string).length < 8
    || (value.licenseKey as string).length > 256
    || new TextEncoder().encode(value.signedEntitlement as string).byteLength > 16 * 1024
    || (value.maskedEmail as string).length > 320) return null;
  if (value.revokedAt !== null && (typeof value.revokedAt !== 'string' || !isStrictUtc(value.revokedAt))) return null;
  if (value.revocationCode !== null && (typeof value.revocationCode !== 'string' || !TERMINAL_CODES.has(value.revocationCode as EntitlementFailureCode))) return null;
  if ((value.revokedAt === null) !== (value.revocationCode === null)) return null;
  if (typeof value.licenseLastFour !== 'string' || value.licenseLastFour.length !== 4) return null;
  if (!(value.licenseKey as string).endsWith(value.licenseLastFour)) return null;
  return value as unknown as DesktopLicenseRecordV1;
}

function isStrictUtc(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function decodePayload(token: string): { activationInstanceId?: string } | null {
  try {
    const segment = token.split('.')[1];
    if (!segment) return null;
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as { activationInstanceId?: string };
  } catch { return null; }
}
