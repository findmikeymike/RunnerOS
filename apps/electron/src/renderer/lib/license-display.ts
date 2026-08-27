import type { ArtistOSLicenseSnapshotV1 } from '@craft-agent/shared/licensing';

export interface LicenseDisplayState {
  title: string;
  detail: string;
  tone: 'good' | 'warning' | 'blocked' | 'neutral';
}

function editionLabel(snapshot: ArtistOSLicenseSnapshotV1): string {
  return snapshot.edition === 'basic' ? 'Basic' : 'Premium';
}

export function describeLicense(snapshot: ArtistOSLicenseSnapshotV1): LicenseDisplayState {
  if (snapshot.development) return { title: 'Development access', detail: 'Paid features are enabled in this development build.', tone: 'neutral' };
  switch (snapshot.state) {
    case 'ACTIVE': return { title: `Artist OS ${editionLabel(snapshot)}`, detail: 'Lifetime access is active on this computer.', tone: 'good' };
    case 'REFRESH_DUE': return { title: 'Activated — check due', detail: 'Offline access remains active. Reconnect when convenient.', tone: 'warning' };
    case 'SERVICE_UNAVAILABLE': return snapshot.authorized
      ? { title: 'Activated — offline', detail: 'The license service is unavailable. Your lifetime access remains active.', tone: 'warning' }
      : { title: 'Service unavailable', detail: 'Connect to the internet to activate this computer.', tone: 'warning' };
    case 'ACTIVATING': return { title: 'Activating…', detail: 'Checking this purchase and computer.', tone: 'neutral' };
    case 'SEAT_LIMIT_REACHED': return { title: 'Computer limit reached', detail: 'Deactivate Artist OS on another computer, then try again.', tone: 'blocked' };
    case 'REVOKED': return { title: 'License inactive', detail: 'This purchase is no longer active. Your files remain readable and exportable.', tone: 'blocked' };
    case 'CORRUPT': return { title: 'License needs recovery', detail: 'The protected local license could not be verified. Your files remain safe.', tone: 'blocked' };
    default: return { title: 'Activate Artist OS', detail: 'Enter the purchase email and Lemon Squeezy license key for this computer.', tone: 'neutral' };
  }
}

export function shouldOpenFirstRunActivation(snapshot: ArtistOSLicenseSnapshotV1, dismissed: boolean): boolean {
  return !dismissed && !snapshot.development && snapshot.state === 'UNLICENSED';
}
