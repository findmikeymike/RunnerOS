import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth';

/** Register Pi's statically bundled OAuth implementations before any provider resolves auth. */
export function registerPiBundledOAuthFlows(): void {
  registerBunOAuthFlows();
}
