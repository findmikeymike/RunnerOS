import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LicensePanel } from './LicensePanel';
import { shouldOpenFirstRunActivation } from '@/lib/license-display';

const ACTIVATION_DISMISSED_KEY = 'artistOsLicenseActivationDismissedV1';

async function readActivationDismissed(): Promise<boolean> {
  try {
    const { content } = await window.electronAPI.readPreferences();
    const preferences: unknown = JSON.parse(content || '{}');
    return Boolean(preferences && typeof preferences === 'object'
      && (preferences as Record<string, unknown>)[ACTIVATION_DISMISSED_KEY] === true);
  } catch { return false; }
}

async function writeActivationDismissed(): Promise<void> {
  try {
    const { content } = await window.electronAPI.readPreferences();
    const parsed: unknown = JSON.parse(content || '{}');
    const preferences = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
    await window.electronAPI.writePreferences(JSON.stringify({
      ...preferences,
      [ACTIVATION_DISMISSED_KEY]: true,
    }, null, 2));
  } catch {
    // Dismissal persistence is convenience only; licensing authority is unaffected.
  }
}

export function LicenseDialogHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.all([window.electronAPI.getLicenseState(), readActivationDismissed()]).then(([snapshot, dismissed]) => {
      if (!active) return;
      if (shouldOpenFirstRunActivation(snapshot, dismissed)) setOpen(true);
    });
    const unsubscribe = window.electronAPI.onLicenseRequired(() => setOpen(true));
    return () => { active = false; unsubscribe(); };
  }, []);

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) void writeActivationDismissed();
  };

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogContent className="border-white/10 bg-[#111113] text-white sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Activate Artist OS</DialogTitle>
        <DialogDescription>Agent actions need an active license. You can close this and continue reading or exporting your files.</DialogDescription>
      </DialogHeader>
      <LicensePanel onActivated={() => changeOpen(false)} />
    </DialogContent>
  </Dialog>;
}
