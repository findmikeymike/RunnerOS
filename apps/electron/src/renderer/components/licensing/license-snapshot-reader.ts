import type { ArtistOSLicenseSnapshotV1 } from '@craft-agent/shared/licensing';

export interface LicenseSnapshotReadState {
  snapshot: ArtistOSLicenseSnapshotV1 | null;
  error: string | null;
  loading: boolean;
}

export function createLicenseSnapshotReader(
  api: {
    getLicenseState(): Promise<ArtistOSLicenseSnapshotV1>;
    onLicenseStateChanged(listener: (snapshot: ArtistOSLicenseSnapshotV1) => void): () => void;
  },
  update: (state: LicenseSnapshotReadState) => void,
) {
  let active = true;
  let revision = 0;
  let snapshot: ArtistOSLicenseSnapshotV1 | null = null;
  const unsubscribe = api.onLicenseStateChanged((next) => {
    if (!active) return;
    revision += 1;
    snapshot = next;
    update({ snapshot, error: null, loading: false });
  });
  return {
    async retry() {
      const request = ++revision;
      if (!active) return;
      update({ snapshot, error: null, loading: true });
      try {
        const next = await api.getLicenseState();
        if (!active || request !== revision) return;
        snapshot = next;
        update({ snapshot, error: null, loading: false });
      } catch {
        if (!active || request !== revision) return;
        update({ snapshot, error: 'Could not load license status. Please try again.', loading: false });
      }
    },
    dispose() { active = false; revision += 1; unsubscribe(); },
  };
}
