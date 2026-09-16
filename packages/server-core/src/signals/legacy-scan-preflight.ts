/** Old saved scans must fail before creating model sessions when their required setup is absent. */
export function assertLegacySignalScanSetup(workflowSlug: string, configBody: string | undefined): void {
  if (workflowSlug !== 'weekly-signal-scan') return;
  if (!configBody?.trim()) {
    throw new Error('This older Signal Scan has no saved channel setup. Open Signals → Channels & schedule, save the channels, then use Scan now.');
  }
}
