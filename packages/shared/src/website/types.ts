/**
 * Artist website: the `website/` HQ object.
 *
 * Spec: docs/creator-command-center/todo/39-artist-website-agent-spec.md
 *
 * Content is data. `dist/` is rendered from `content/` + `theme/` + `site/`
 * and is disposable. Nothing here reaches an external host — deploy adapters
 * land in a later slice and read this manifest.
 */

export const WEBSITE_DIR = 'website';
export const WEBSITE_MANIFEST_FILE = 'site.json';

export type WebsiteMode = 'none' | 'managed' | 'wordpress' | 'static-repo' | 'closed-builder';
export type DeployAdapterId = 'cloudflare-workers' | 'netlify' | 'github' | 'zip';
export type DeployTarget = 'preview' | 'production';
export type ChangeClass = 'content-only' | 'design';
export type PublishPolicy = 'auto' | 'needs-you';

export interface DeployRecord {
  id: string;
  target: DeployTarget;
  at: string;
  url: string;
  buildHash: string;
  /** Design inputs at the moment this deploy shipped. Drives change class. */
  designHash?: string;
  previousDeployId?: string;
  origin: { kind: 'user' | 'agent' | 'automation'; sessionId?: string; automationId?: string };
  status: 'live' | 'superseded' | 'rolled-back' | 'failed';
  error?: string;
}

export interface WebsiteDomainState {
  name: string;
  state: 'unverified' | 'pending-dns' | 'active' | 'error';
  steps?: string[];
  checkedAt?: string;
}

export interface WebsiteBuildSummary {
  at: string;
  /** sha256 over every emitted dist file, order-independent. */
  hash: string;
  /**
   * sha256 over the design inputs only (templates and theme tokens).
   *
   * Change class is derived from this rather than trusted from the caller:
   * trusted mode must never auto-publish a design change, and a caller that
   * mislabels one would otherwise walk straight past that law.
   */
  designHash?: string;
  auditScore: number;
  warnings: number;
  fileCount: number;
  bytes: number;
}

export type WebsiteAssetKind = 'image' | 'video' | 'audio' | 'download';

/**
 * Immutable, web-ready snapshot of one approved Vault or Release Kit asset.
 * `path` is relative to `website/assets/`; the builder verifies `sha256`
 * before copying it into disposable `dist/`.
 */
export interface WebsiteAssetRecord {
  id: string;
  path: string;
  sha256: string;
  kind: WebsiteAssetKind;
  mimeType?: string;
  source: {
    kind: 'vault' | 'release-kit';
    id: string;
    sha256: string;
  };
}

export interface WebsiteManifest {
  version: 1;
  mode: WebsiteMode;
  adapter?: DeployAdapterId;
  provider?: {
    accountId?: string;
    siteId?: string;
    previewSiteId?: string;
    kvNamespaceId?: string;
    sourceSlug?: string;
  };
  urls: { preview?: string; production?: string; sidecar?: string };
  domain?: WebsiteDomainState;
  external?: { url: string; platform: string; inspectedAt: string; inventory: string[] };
  publishPolicy: {
    /**
     * `needs-you` is the one-click tier: the artist approves a bound build
     * hash. `auto` is trusted mode, which only ever applies to content-only
     * changes and is earned, scoped, and revocable (spec 41 Core Law 3).
     */
    contentOnly: PublishPolicy;
    design: 'needs-you';
    routines: Record<string, PublishPolicy>;
    /** Set once the clean-publish streak reaches the threshold. */
    trustedEligibleAt?: string;
    /** Set when the artist turns trusted mode on from the Website page. */
    trustedGrantedAt?: string;
    /** Set by any rollback. Clears `contentOnly` back to `needs-you`. */
    trustedRevokedAt?: string;
    /** Consecutive approved publishes with no rollback since the last reset. */
    cleanPublishStreak?: number;
  };
  targetApproval?: { approvedAt: string; approvedBy: 'user'; target: string };
  /**
   * The artist's approval of one specific build, written by the UI when they
   * press Publish and consumed by the next production publish.
   *
   * Agents cannot write this. It is what keeps "one click" a human decision
   * rather than something a session can grant itself.
   */
  pendingApproval?: { boundTo: string; approvedAt: string; expiresAt?: string };
  history: DeployRecord[];
  lastBuild?: WebsiteBuildSummary;
  capture: {
    backend: 'resend' | 'kv' | 'none';
    formIds: string[];
    lastDrainAt?: string;
    drainCursor?: string;
  };
  assets: WebsiteAssetRecord[];
  /**
   * How often the site routine runs. Manual until the artist chooses,
   * because an unasked-for weekly card is noise for an artist who releases
   * once a year.
   */
  routine?: import('./routine.ts').WebsiteRoutineConfig;
  /** The brief waiting on the artist, if a run produced one. */
  pendingBrief?: import('./routine.ts').WebsiteBrief;
  createdAt: string;
  updatedAt: string;
}

/**
 * Deploy history is capped so the manifest stays small and diffable.
 * Production and preview have separate budgets — see `trimDeployHistory`.
 */
export const MAX_DEPLOY_HISTORY = 50;
export const MAX_PREVIEW_HISTORY = 5;

// ---------------------------------------------------------------------------
// Content contract
// ---------------------------------------------------------------------------

export type ReleaseType = 'single' | 'ep' | 'album';
export type LinkKind = 'social' | 'store' | 'other';
export type SitePageKind = 'lyrics' | 'epk' | 'secret' | 'custom';

export interface SiteArtist {
  name: string;
  tagline?: string;
  bio: { short: string; long: string };
  location?: string;
  booking?: { email?: string; agent?: string };
  press?: { email?: string };
}

export interface SiteRelease {
  id: string;
  title: string;
  type: ReleaseType;
  date: string;
  artworkAssetId?: string;
  links: {
    spotify?: string;
    apple?: string;
    youtube?: string;
    bandcamp?: string;
    presave?: string;
    smart?: string;
  };
  featured?: boolean;
  lyricsPageIds?: string[];
}

export interface SiteShow {
  id: string;
  date: string;
  city: string;
  venue: string;
  ticketUrl?: string;
  soldOut?: boolean;
  calendarEventId?: string;
}

export interface SiteVideo {
  id: string;
  title: string;
  youtubeId?: string;
  assetId?: string;
  featured?: boolean;
}

export interface SiteLink {
  id: string;
  label: string;
  url: string;
  kind: LinkKind;
}

export interface SitePressItem {
  id: string;
  outlet: string;
  quote?: string;
  url?: string;
  date?: string;
}

export interface SiteJournalEntry {
  id: string;
  date: string;
  title: string;
  body: string;
  embedUrl?: string;
  assetId?: string;
}

export interface SitePage {
  id: string;
  slug: string;
  title: string;
  kind: SitePageKind;
  body: string;
  noindex?: boolean;
}

export interface SiteSignupForm {
  id: string;
  headline: string;
  blurb?: string;
  reward?: { kind: 'download' | 'stream' | 'none'; assetId?: string; url?: string };
}

export interface SiteSeo {
  siteName: string;
  defaultDescription: string;
  ogImageAssetId?: string;
  canonicalBase?: string;
}

export interface SiteContent {
  version: 1;
  artist: SiteArtist;
  releases: SiteRelease[];
  shows: SiteShow[];
  videos: SiteVideo[];
  links: SiteLink[];
  press: SitePressItem[];
  journal: SiteJournalEntry[];
  pages: SitePage[];
  signup: { enabled: boolean; forms: SiteSignupForm[] };
  seo: SiteSeo;
}

export interface SiteThemeTokens {
  version: 1;
  colors: {
    background: string;
    surface: string;
    text: string;
    muted: string;
    accent: string;
    accentText: string;
    border: string;
  };
  type: {
    displayFamily: string;
    bodyFamily: string;
    displayWeight: number;
    scale: number;
  };
  radius: number;
  maxWidth: number;
}

// ---------------------------------------------------------------------------
// Structured content operations
// ---------------------------------------------------------------------------

/**
 * One structured edit to the content contract. An automation adding a show
 * writes a single operation and never has to know the whole schema.
 */
export type SiteContentOperation =
  | { op: 'set-artist'; value: Partial<SiteArtist> }
  | { op: 'set-seo'; value: Partial<SiteSeo> }
  | { op: 'upsert-release'; value: SiteRelease }
  | { op: 'upsert-show'; value: SiteShow }
  | { op: 'upsert-video'; value: SiteVideo }
  | { op: 'upsert-link'; value: SiteLink }
  | { op: 'upsert-press'; value: SitePressItem }
  | { op: 'upsert-journal'; value: SiteJournalEntry }
  | { op: 'upsert-page'; value: SitePage }
  | { op: 'upsert-signup-form'; value: SiteSignupForm }
  | { op: 'set-signup-enabled'; value: boolean }
  | {
    op: 'remove';
    collection: 'releases' | 'shows' | 'videos' | 'links' | 'press' | 'journal' | 'pages' | 'signupForms';
    id: string;
  };

export interface ApplyContentResult {
  content: SiteContent;
  applied: number;
  /** Human-readable summary lines, one per operation, for the change log. */
  changes: string[];
  changeClass: ChangeClass;
}
