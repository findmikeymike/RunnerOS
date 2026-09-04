import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  MAX_DEPLOY_HISTORY,
  WEBSITE_DIR,
  WEBSITE_MANIFEST_FILE,
  type ApplyContentResult,
  type ChangeClass,
  type DeployRecord,
  type SiteContent,
  type SiteContentOperation,
  type SiteThemeTokens,
  type WebsiteManifest,
} from './types.ts';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function websiteRoot(workspaceRootPath: string): string {
  return join(workspaceRootPath, WEBSITE_DIR);
}

export function websiteManifestPath(workspaceRootPath: string): string {
  return join(websiteRoot(workspaceRootPath), WEBSITE_MANIFEST_FILE);
}

export function websiteContentPath(workspaceRootPath: string): string {
  return join(websiteRoot(workspaceRootPath), 'content', 'site.json');
}

export function websiteThemePath(workspaceRootPath: string): string {
  return join(websiteRoot(workspaceRootPath), 'theme', 'tokens.json');
}

export function websiteTemplatesDir(workspaceRootPath: string): string {
  return join(websiteRoot(workspaceRootPath), 'site');
}

export function websiteAssetsDir(workspaceRootPath: string): string {
  return join(websiteRoot(workspaceRootPath), 'assets');
}

export function websiteDistDir(workspaceRootPath: string): string {
  return join(websiteRoot(workspaceRootPath), 'dist');
}

export function websiteExists(workspaceRootPath: string): boolean {
  return existsSync(websiteManifestPath(workspaceRootPath));
}

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function loadWebsiteManifest(workspaceRootPath: string): WebsiteManifest | null {
  return readJson<WebsiteManifest>(websiteManifestPath(workspaceRootPath));
}

export function saveWebsiteManifest(workspaceRootPath: string, manifest: WebsiteManifest): WebsiteManifest {
  const next: WebsiteManifest = {
    ...manifest,
    history: manifest.history.slice(0, MAX_DEPLOY_HISTORY),
    updatedAt: nowIso(),
  };
  writeJson(websiteManifestPath(workspaceRootPath), next);
  return next;
}

export function loadSiteContent(workspaceRootPath: string): SiteContent | null {
  return readJson<SiteContent>(websiteContentPath(workspaceRootPath));
}

export function saveSiteContent(workspaceRootPath: string, content: SiteContent): void {
  writeJson(websiteContentPath(workspaceRootPath), content);
}

export function loadSiteTheme(workspaceRootPath: string): SiteThemeTokens | null {
  return readJson<SiteThemeTokens>(websiteThemePath(workspaceRootPath));
}

export function saveSiteTheme(workspaceRootPath: string, theme: SiteThemeTokens): void {
  writeJson(websiteThemePath(workspaceRootPath), theme);
}

/** Record a deploy, superseding the previous live deploy for that target. */
export function recordDeploy(
  workspaceRootPath: string,
  manifest: WebsiteManifest,
  record: DeployRecord,
): WebsiteManifest {
  const history = manifest.history.map(entry =>
    entry.target === record.target && entry.status === 'live'
      ? { ...entry, status: 'superseded' as const }
      : entry,
  );
  return saveWebsiteManifest(workspaceRootPath, {
    ...manifest,
    history: [record, ...history],
    urls: record.status === 'live'
      ? { ...manifest.urls, [record.target]: record.url }
      : manifest.urls,
  });
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export function defaultWebsiteManifest(): WebsiteManifest {
  const at = nowIso();
  return {
    version: 1,
    mode: 'managed',
    urls: {},
    publishPolicy: { contentOnly: 'needs-you', design: 'needs-you', routines: {} },
    history: [],
    capture: { backend: 'none', formIds: [] },
    createdAt: at,
    updatedAt: at,
  };
}

export function defaultSiteTheme(): SiteThemeTokens {
  return {
    version: 1,
    colors: {
      background: '#0b0b0c',
      surface: '#141416',
      text: '#f4f4f5',
      muted: '#a1a1aa',
      accent: '#e4e4e7',
      accentText: '#0b0b0c',
      border: 'rgba(255,255,255,0.10)',
    },
    type: {
      displayFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
      bodyFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
      displayWeight: 700,
      scale: 1,
    },
    radius: 10,
    maxWidth: 960,
  };
}

export function defaultSiteContent(artistName: string): SiteContent {
  return {
    version: 1,
    artist: {
      name: artistName,
      bio: { short: '', long: '' },
    },
    releases: [],
    shows: [],
    videos: [],
    links: [],
    press: [],
    journal: [],
    pages: [],
    signup: {
      enabled: true,
      forms: [{
        id: 'newsletter',
        headline: 'Get the next one first',
        blurb: 'New music, shows, and the occasional something else. No spam.',
      }],
    },
    seo: {
      siteName: artistName,
      defaultDescription: `Official site of ${artistName}. Music, shows, and news.`,
    },
  };
}

// ---------------------------------------------------------------------------
// Structured content operations (pure)
// ---------------------------------------------------------------------------

interface Identified { id: string }

function upsertById<T extends Identified>(list: T[], value: T): { list: T[]; created: boolean } {
  const index = list.findIndex(entry => entry.id === value.id);
  if (index === -1) return { list: [...list, value], created: true };
  const next = [...list];
  next[index] = { ...next[index]!, ...value };
  return { list: next, created: false };
}

function describe(op: SiteContentOperation, created: boolean): string {
  const verb = created ? 'Added' : 'Updated';
  switch (op.op) {
    case 'set-artist': return 'Updated artist details';
    case 'set-seo': return 'Updated SEO defaults';
    case 'upsert-release': return `${verb} release "${op.value.title}"`;
    case 'upsert-show': return `${verb} show ${op.value.date} ${op.value.city}`;
    case 'upsert-video': return `${verb} video "${op.value.title}"`;
    case 'upsert-link': return `${verb} link "${op.value.label}"`;
    case 'upsert-press': return `${verb} press item from ${op.value.outlet}`;
    case 'upsert-journal': return `${verb} journal entry "${op.value.title}"`;
    case 'upsert-page': return `${verb} page /${op.value.slug}`;
    case 'upsert-signup-form': return `${verb} signup form "${op.value.id}"`;
    case 'set-signup-enabled': return `Signup ${op.value ? 'enabled' : 'disabled'}`;
    case 'remove': return `Removed ${op.id} from ${op.collection}`;
  }
}

const REMOVE_TARGETS = {
  releases: 'releases',
  shows: 'shows',
  videos: 'videos',
  links: 'links',
  press: 'press',
  journal: 'journal',
  pages: 'pages',
} as const;

/**
 * Apply structured operations to the content contract.
 *
 * Pure: takes content in, returns new content. Every operation here touches
 * only `content/`, so the change class is always `content-only`. Design
 * changes come from template and theme edits, which the builder classifies
 * separately at build time.
 */
export function applySiteContentOperations(
  content: SiteContent,
  operations: SiteContentOperation[],
): ApplyContentResult {
  let next: SiteContent = structuredClone(content);
  const changes: string[] = [];

  for (const op of operations) {
    let created = false;
    switch (op.op) {
      case 'set-artist':
        next.artist = { ...next.artist, ...op.value };
        break;
      case 'set-seo':
        next.seo = { ...next.seo, ...op.value };
        break;
      case 'upsert-release': {
        const result = upsertById(next.releases, op.value);
        next.releases = result.list.sort((a, b) => b.date.localeCompare(a.date));
        created = result.created;
        break;
      }
      case 'upsert-show': {
        const result = upsertById(next.shows, op.value);
        next.shows = result.list.sort((a, b) => a.date.localeCompare(b.date));
        created = result.created;
        break;
      }
      case 'upsert-video': {
        const result = upsertById(next.videos, op.value);
        next.videos = result.list;
        created = result.created;
        break;
      }
      case 'upsert-link': {
        const result = upsertById(next.links, op.value);
        next.links = result.list;
        created = result.created;
        break;
      }
      case 'upsert-press': {
        const result = upsertById(next.press, op.value);
        next.press = result.list;
        created = result.created;
        break;
      }
      case 'upsert-journal': {
        const result = upsertById(next.journal, op.value);
        next.journal = result.list.sort((a, b) => b.date.localeCompare(a.date));
        created = result.created;
        break;
      }
      case 'upsert-page': {
        const result = upsertById(next.pages, op.value);
        next.pages = result.list;
        created = result.created;
        break;
      }
      case 'upsert-signup-form': {
        const result = upsertById(next.signup.forms, op.value);
        next.signup = { ...next.signup, forms: result.list };
        created = result.created;
        break;
      }
      case 'set-signup-enabled':
        next.signup = { ...next.signup, enabled: op.value };
        break;
      case 'remove': {
        if (op.collection === 'signupForms') {
          next.signup = {
            ...next.signup,
            forms: next.signup.forms.filter(form => form.id !== op.id),
          };
        } else {
          const key = REMOVE_TARGETS[op.collection];
          next = { ...next, [key]: (next[key] as Identified[]).filter(entry => entry.id !== op.id) };
        }
        break;
      }
    }
    changes.push(describe(op, created));
  }

  const changeClass: ChangeClass = 'content-only';
  return { content: next, applied: operations.length, changes, changeClass };
}
