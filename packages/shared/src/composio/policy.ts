/** Pure policy shared by host tool filtering and browser-safe prompt composition. */
export function canUseComposioGmail(slug: string | undefined, scope: string | undefined, variant: string): boolean {
  return variant === 'artist-os'
    && ['concierge', 'comms-agent', 'outreach-agent'].includes(slug ?? '')
    && (scope === 'hq' || scope === 'campaign');
}
