import type { LoadedSource } from '../sources/types.ts';
import type { DeepResearchSourceCapability, DeepResearchSourceProfile } from './types.ts';

type SourceLike = Pick<LoadedSource, 'config' | 'guide'>;

const CERTIFIED_PUBLIC_WEB_ENDPOINTS: Record<string, Set<string>> = {
  exa: new Set(['https://api.exa.ai/']),
};

export function isCertifiedPublicWebResearchSource(source: SourceLike): boolean {
  const cfg = source.config;
  const allowedEndpoints = CERTIFIED_PUBLIC_WEB_ENDPOINTS[cfg.provider.toLowerCase()];
  if (!allowedEndpoints || cfg.type !== 'api') return false;
  const endpoint = cfg.api?.baseUrl;
  if (!endpoint) return false;
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      allowedEndpoints.has(url.href)
    );
  } catch {
    return false;
  }
}

export function inferDeepResearchSourceCapabilities(source: SourceLike): DeepResearchSourceCapability[] {
  const cfg = source.config;
  const text = [
    cfg.slug,
    cfg.name,
    cfg.provider,
    cfg.type,
    cfg.tagline,
    source.guide?.scope,
    source.guide?.guidelines,
    source.guide?.context,
  ].filter(Boolean).join(' ').toLowerCase();
  const capabilities = new Set<DeepResearchSourceCapability>();

  if (cfg.type === 'mcp') capabilities.add('mcp');
  if (cfg.type === 'api') capabilities.add('api');
  if (cfg.type === 'local') capabilities.add('local');
  if (/\b(exa|search|web|google|brave|tavily|perplexity|serp|crawl|firecrawl)\b/.test(text)) {
    capabilities.add('search');
  }
  if (/\b(browser|computer-use|chrome|playwright|crawl|firecrawl|page|website|webpage)\b/.test(text)) {
    capabilities.add('browser');
  }
  if (/\b(notebooklm|docs|knowledge|field-theory|drive|files|documents|notes)\b/.test(text)) {
    capabilities.add('knowledge');
  }

  return Array.from(capabilities).sort();
}

export function profileDeepResearchSource(source: SourceLike): DeepResearchSourceProfile {
  const cfg = source.config;
  return {
    slug: cfg.slug,
    name: cfg.name,
    provider: cfg.provider,
    type: cfg.type,
    capabilities: inferDeepResearchSourceCapabilities(source),
    publicWebCertified: isCertifiedPublicWebResearchSource(source),
    tagline: cfg.tagline || source.guide?.scope,
  };
}

export function hasDeepResearchDiscoveryCapability(source: SourceLike): boolean {
  const capabilities = inferDeepResearchSourceCapabilities(source);
  return capabilities.includes('search') || capabilities.includes('browser');
}
