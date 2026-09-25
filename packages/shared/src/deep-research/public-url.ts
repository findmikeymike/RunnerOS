/** Keep resource identity while removing known credential and tracking fields. */
export function sanitizeDeepResearchPublicUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    url.username = '';
    url.password = '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      const normalized = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace(/[-.]/g, '_');
      if (/^(?:utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|vero_id|_hsenc|_hsmi)$/.test(normalized)
        || /(?:api_?key|token|authorization|secret|password|signature|credential)/.test(normalized)
        || /(?:^|_)(?:key|auth|sig|jwt|cookie|code|oauth_?verifier|session(?:_?id)?)(?:_|$)/.test(normalized)) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return undefined;
  }
}
