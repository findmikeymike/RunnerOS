import { useCallback, useEffect, useState } from 'react';
import { KeyRound, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { validateArtistOSActivateInput, type ArtistOSLicenseLinkKind, type ArtistOSLicenseSnapshotV1 } from '@craft-agent/shared/licensing';
import { describeLicense } from '@/lib/license-display';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function useLicenseSnapshot(): ArtistOSLicenseSnapshotV1 | null {
  const [snapshot, setSnapshot] = useState<ArtistOSLicenseSnapshotV1 | null>(null);
  useEffect(() => {
    let active = true;
    void window.electronAPI.getLicenseState().then((next) => { if (active) setSnapshot(next); });
    const unsubscribe = window.electronAPI.onLicenseStateChanged((next) => { if (active) setSnapshot(next); });
    return () => { active = false; unsubscribe(); };
  }, []);
  return snapshot;
}

export function LicensePanel({ onActivated }: { onActivated?: () => void }) {
  const snapshot = useLicenseSnapshot();
  const [email, setEmail] = useState('');
  const [licenseKey, setLicenseKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const display = snapshot ? describeLicense(snapshot) : null;

  const activate = useCallback(async () => {
    const input = { schemaVersion: 1 as const, email: email.trim(), licenseKey: licenseKey.trim() };
    if (!validateArtistOSActivateInput(input)) { setLocalError('Enter the purchase email and complete license key from your receipt.'); return; }
    setBusy(true); setLocalError(null);
    try {
      const result = await window.electronAPI.activateLicense(input);
      if (result.ok) { setLicenseKey(''); onActivated?.(); }
      else setLocalError(result.snapshot.safeMessage ?? describeLicense(result.snapshot).detail);
    } catch { setLocalError('Activation could not be completed. Check the details and try again.'); }
    finally { setBusy(false); }
  }, [email, licenseKey, onActivated]);

  const refresh = useCallback(async () => {
    setBusy(true); setLocalError(null);
    try { const result = await window.electronAPI.refreshLicense(); if (!result.ok) setLocalError(result.snapshot.safeMessage ?? describeLicense(result.snapshot).detail); }
    catch { setLocalError('The license service could not be reached. Offline access is unchanged.'); }
    finally { setBusy(false); }
  }, []);

  const openLink = useCallback(async (kind: ArtistOSLicenseLinkKind) => {
    setLocalError(null);
    try { await window.electronAPI.openLicenseLink(kind); }
    catch { setLocalError('That page could not be opened. Please try again.'); }
  }, []);

  const deactivate = useCallback(async () => {
    setBusy(true); setLocalError(null);
    try {
      const result = await window.electronAPI.deactivateLicense();
      if (result.ok) setConfirmDeactivate(false);
      else setLocalError(result.snapshot.safeMessage ?? describeLicense(result.snapshot).detail);
    } catch { setLocalError('This computer could not be deactivated. Nothing was removed.'); }
    finally { setBusy(false); }
  }, []);

  if (!snapshot || !display) return <div className="text-sm text-white/45" role="status">Loading license…</div>;
  const Icon = snapshot.authorized ? ShieldCheck : snapshot.state === 'UNLICENSED' ? KeyRound : TriangleAlert;
  const edition = snapshot.edition === 'basic' ? 'Basic' : snapshot.edition === 'premium' ? 'Premium' : null;

  return <div className="space-y-4" aria-live="polite">
    <div className="flex items-start gap-3">
      <Icon className={snapshot.authorized ? 'mt-0.5 h-5 w-5 text-emerald-400' : 'mt-0.5 h-5 w-5 text-orange-400'} aria-hidden="true" />
      <div className="min-w-0">
        <div className="text-sm font-semibold text-white/90">{display.title}</div>
        <p className="mt-1 text-xs leading-5 text-white/48">{display.detail}</p>
        {snapshot.safeMessage && snapshot.safeMessage !== display.detail && <p className="mt-1 text-xs leading-5 text-white/48">{snapshot.safeMessage}</p>}
        {snapshot.maskedEmail && <p className="mt-1 text-[11px] text-white/35">{snapshot.maskedEmail} · key ending {snapshot.licenseLastFour} · Up to {snapshot.seatLimit ?? 3} Macs</p>}
        {snapshot.authorized && <p className="mt-1 text-[11px] text-white/35">{edition ?? 'Artist OS'} · Lifetime access{snapshot.lastValidatedAt ? ` · checked ${new Date(snapshot.lastValidatedAt).toLocaleDateString()}` : ''}</p>}
      </div>
    </div>
    {!snapshot.authorized && snapshot.state !== 'ACTIVATING' && <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1.5 text-xs text-white/55">Purchase email<Input autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
      <label className="space-y-1.5 text-xs text-white/55">License key<Input type="password" autoComplete="off" value={licenseKey} onChange={(event) => setLicenseKey(event.target.value)} placeholder="XXXX-XXXX-XXXX" /></label>
      <Button className="sm:col-span-2 bg-orange-500 text-black hover:bg-orange-400" disabled={busy} onClick={activate}>{busy ? 'Activating…' : 'Activate Artist OS'}</Button>
    </div>}
    {!snapshot.authorized && <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      <button type="button" className="text-orange-300 hover:text-orange-200" onClick={() => void openLink('buy')}>Buy Artist OS</button>
      <button type="button" className="text-white/55 hover:text-white/80" onClick={() => void openLink('recover')}>Find my license</button>
      <button type="button" className="text-white/55 hover:text-white/80" onClick={() => void openLink('support')}>Contact support</button>
    </div>}
    {snapshot.authorized && !snapshot.development && <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" disabled={busy} onClick={refresh}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Check license</Button>
      {!confirmDeactivate ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmDeactivate(true)}>Deactivate this computer</Button> : <><Button variant="outline" size="sm" onClick={() => setConfirmDeactivate(false)}>Keep active</Button><Button variant="destructive" size="sm" disabled={busy} onClick={deactivate}>Confirm deactivation</Button></>}
    </div>}
    {snapshot.authorized && !snapshot.development && <button type="button" className="text-xs text-white/55 hover:text-white/80" onClick={() => void openLink('manage')}>Manage purchase</button>}
    {localError && <p className="text-xs text-orange-300" role="alert">{localError}</p>}
    <p className="text-[11px] leading-4 text-white/30">Licensing never changes project files. Reading and raw export remain available without activation.</p>
    <button type="button" className="text-[11px] text-white/45 underline-offset-2 hover:text-white/70 hover:underline" onClick={() => void openLink('privacy')}>Privacy details</button>
  </div>;
}
