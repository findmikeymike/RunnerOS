---
status: partially-implemented
owner: agent
last_verified: 2026-09-03
source_of_truth: true
related: ./todo/38-community-email-engine-spec.md, ./33-automations-input-aware-setup-spec.md, ./24-session-task-list-spec.md, ./23-release-kit-architecture-spec.md, ./11-outputs-finals-asset-promotion-spec.md, ./09-hq-state-of-play-proactive-routing.md
---

# Artist Website: Managed Site, Website Agent, And Site Builder

## Implementation Status

**Slice 1 is built** (`codex/artist-website-engine`). Everything below Slice 1
in the slice list remains unbuilt.

Shipped:

- `website/` HQ object with manifest, content contract, theme tokens, and
  structured content operations (`packages/shared/src/website/`).
- Bundled builder CLI at `tools/site-builder`: `init`, `build`, `audit`,
  `serve`, `pack`, `doctor`. Tiny mustache-style template engine, SEO
  scaffolding (sitemap, robots, Open Graph, schema.org `MusicGroup` /
  `MusicAlbum` / `MusicRecording` / `Event`), and a credential scan that
  refuses to emit a build containing a key-shaped value.
- One starter template (`minimal`) rendering home, press kit, custom pages,
  and 404.
- `WebsiteService` (`packages/server-core/src/website/`) running the builder
  and serving previews from an in-process static server bound to loopback.
- Six session tools: `website_get_manifest`, `website_create`,
  `website_set_content`, `website_build`, `website_preview`,
  `website_seo_audit`. All resolve the Artist HQ workspace, so a campaign
  session edits the same site.
- `site-builder` starter agent with routing hints, plus the
  `artist-website-builder` and `artist-website-playbook` skills.
- 35 tests across the builder, storage, and service.

Deviation from the spec below: **`website_create` was added as a session
tool.** The spec routed site creation through the UI setup flow in Slice 2,
which would have left Slice 1 with no way to create a site at all. It creates
local files only and connects no account.

Slice 1 safety behavior: signup is disabled and omitted while capture backend
is `none`; capture and Community sync remain Slice 4 work. Referenced Vault or
Release Kit assets are staged only when approved, converted to metadata-free
WebP when they are images, recorded by hash, and verified again by the builder.

Not built: every deploy adapter, publishing, domains, capture doors, external
site modes, the Website Agent, routines, and the Website page. `website_preview`
serves locally; nothing in the tree can reach an external host.

## Decision

Every Artist HQ can own and operate a website the same way it owns a fan
list: as a first-class object with an agent responsible for it.

- **The website is an HQ object.** It lives at `website/` inside the HQ
  workspace with a manifest, structured content, a theme, templates, and a
  rendered `dist/`. Multiple HQs mean multiple sites.
- **Two agents, one owner.** The **Website Agent** operates: talks to the
  artist, plans, publishes, rolls back, audits, runs routines. The **Site
  Builder** codes: edits templates and content, renders, previews. Creative
  direction is a handoff to the Branding Agent and Art Director that already
  exist.
- **The host is plumbing.** A deploy adapter interface hides Cloudflare,
  Netlify, GitHub, and zip export. The artist sees Website, Live, Healthy,
  Updated two days ago, with Edit, Preview, Publish, History.
- **Cloudflare Workers static assets is the default for a new site.** Static
  requests are free and unlimited, deploys go through the API with no git and
  no CLI, and the free plan covers an artist site with room to spare.
  Netlify is the second adapter. Vercel is not offered as a default because
  its free plan is non-commercial.
- **Existing sites are met where they are.** Inspect first. WordPress gets a
  REST adapter, a static repo gets connected, closed builders get "operate,
  don't rebuild" plus Artist OS sidecar pages for capture and SEO.
- **Capture is spec 38's door.** The site's signup function writes to Resend
  contacts when a key exists, otherwise to Cloudflare KV, and a fifteen-minute
  drain lands every signup in the fan list with full consent evidence.
- **Approvals follow the house rule.** Connecting a host and the first publish
  to a real domain is one approval of the target. After that a cue in a
  session is the approval, routines follow a publish policy the artist set,
  and rollback is always one click.

## The Product Judgement

An artist site is the one surface the artist fully owns. It is where the
email door lives, where search sends people who heard a song, where a booker
checks if you are real, and where the fan who found you on a platform becomes
a fan you can reach without the platform. Most artists either have no site,
or one that was built once and never touched again.

The system already has the raw material: profile, branding, voice, Release
Kit assets, calendar with shows, a fan list with consent, State of Play, and
an automation system with a Needs You list. What it lacks is a place for the
site to live, a way to render and ship it without a toolchain on the artist's
machine, and an agent whose job is keeping it alive.

The design principle is the same as spec 38: put one human confirm where the
blast radius is real (a host connection and a live domain), and nowhere else.
A preview deploy is free and harmless. A content update is the whole point.

## Current State

Verified in tree on 2026-09-03.

**Reusable today**

- Agents have `Read`, `Write`, `Edit`, and `Bash` backend tools with
  permission-mode gating (`packages/shared/src/agent/mode-manager.ts:1976-2055`).
- `browser_tool` gives agents a CLI-like browser inside the app, allowed in
  safe mode (`packages/session-tools-core/src/tool-defs.ts:1900`).
- `create_output` supports a `web` preview mode rendered in an iframe
  (`packages/shared/src/outputs/types.ts:88`,
  `apps/electron/src/renderer/components/outputs/OutputWebPreview.tsx`).
- Open Slide is the precedent for a code project inside the workspace: decks
  under `<workspace>/decks/`, a bundled exporter, publish to canvas, and the
  hard rule "Do not deploy/publish to external hosts (Vercel, Netlify, etc.)
  without explicit user approval of the target"
  (`packages/shared/src/sources/builtin-sources.ts:1850`).
- Bundled tools under `tools/` (`tools/lottie`, `tools/printing-press-social`)
  show how a Node CLI ships with the app and is invoked from sessions.
- The source model supports `api` sources with generic OAuth
  (`packages/shared/src/sources/types.ts:383-413`), which is enough to model a
  Netlify connection, and `source_credential_prompt` lets an agent ask the
  user to paste a token without seeing it typed.
- Release Kit, Vault, calendar, and artist context are readable through
  existing session tools. The Printing Press Social source exposes a channel
  catalog that Weekly Spotify Snapshot already uses.
- Spec 33 automations, the Needs You list, and spec 24 delegation return
  paths.
- Spec 38 defines the signup-door consent evidence and the Community sync
  that consumes it.

**Absent**

- No website agent, skill, source, or folder convention. `website` does not
  appear in starter agents, skills, or built-in sources.
- No hosting connection of any kind. Cloudflare appears only in the browser
  pane's challenge detection and in licensing infrastructure. Netlify and
  Vercel appear only in a hard rule and a model-provider label.
- No deploy adapter, no site manifest, no builder.
- No capture endpoint on any surface the artist owns.

## Core Laws

1. **Content is data.** Bio, releases, shows, links, press, video, and signup
   configuration live in `website/content/` as structured JSON. Templates
   render it. An automation that adds a show writes one JSON entry and never
   touches HTML.
2. **`dist/` is disposable.** It is rendered by the builder from content,
   theme, templates, and assets. Nothing edits it by hand and nothing depends
   on it surviving.
3. **Assets come from the Vault and Release Kit.** The site references
   approved assets by id and copies them at build time with hash
   verification. It never links to a file outside the workspace and never
   scrapes a social platform for media.
4. **Preview is free, production is owned.** Any build can be previewed in the
   canvas or on a preview deploy at no cost and with no prompt. Production
   publishes follow the publish policy in the manifest.
5. **One approval per target.** Connecting a host, and the first publish to a
   custom domain, each require one explicit approval. No per-deploy prompts
   after that.
6. **Never claim a deploy.** A publish is done when the adapter returns a
   deploy id and a URL that answers with the expected build hash. The tool
   reports exactly that or reports failure.
7. **Rollback always works.** Every production publish records the previous
   deploy id. Rollback is one call to the adapter and one click in the UI.
8. **Existing sites are not rebuilt without being asked.** Inspect mode is
   read-only. The agent proposes, the artist picks the mode.
9. **Secrets never enter the site.** The builder refuses to render any value
   matching a secret pattern, and the deploy adapter refuses a `dist/` that
   contains one. API keys for capture live in host environment variables.
10. **The Website Agent never edits files.** It reads the manifest and
    content through tools and delegates edits to the Site Builder. That keeps
    the operator's context clean and the coding worker's permissions scoped.

## Architecture

```
  Artist HQ workspace
  └── website/
      ├── site.json              manifest: adapter, ids, domain, policy, history
      ├── content/               bio.json releases.json shows.json links.json
      │                          press.json video.json signup.json pages/*.md
      ├── theme/tokens.json      colors, type, spacing from branding + artwork
      ├── site/                  templates (*.html with {{ }}), css, js, partials
      ├── assets/                copied from Vault / Release Kit at build, by hash
      ├── functions/             signup.js (capture door), optional extras
      └── dist/                  rendered output, disposable

  tools/site-builder/            bundled Node CLI: build, audit, serve, pack
  server-core/website/           WebsiteService, adapters, capture drain
  session-tools-core             website_* tools
  agents                         website-agent (operator), site-builder (worker)
  skills                         artist-website-playbook, site-builder,
                                 site-growth, artist-seo

  Deploy adapters: cloudflare-workers | netlify | github | zip
  External modes:  wordpress | static-repo | closed-builder (browser + sidecar)
```

### The builder

`tools/site-builder` is a dependency-light Node CLI shipped with the app,
like `tools/lottie`. Commands:

- `build` renders `site/` templates with `content/` and `theme/`, copies
  referenced assets from the Vault and Release Kit with hash verification,
  optimizes images to web sizes, and emits `dist/` plus `sitemap.xml`,
  `robots.txt`, Open Graph and Twitter tags on every page, and JSON-LD for
  `MusicGroup`, `MusicAlbum`, `MusicRecording`, and `Event`.
- `audit` lints `dist/`: missing titles or descriptions, duplicate H1s,
  images over budget, broken internal links, missing alt text, missing
  structured data, pages without a canonical, and the secret-pattern scan.
  Emits JSON with a score and fixes.
- `serve` runs a local preview on a free port for the browser pane.
- `pack` produces a zip of `dist/` for the zip adapter or manual upload.

Templates use a small mustache-style syntax with loops and partials. No
JavaScript framework, no bundler, no `npm install` on the artist's machine.
The Site Builder agent can write any HTML, CSS, and vanilla JS it wants; the
builder only supplies data, assets, and the SEO scaffolding.

### Deploy adapters

```ts
interface SiteDeployAdapter {
  id: 'cloudflare-workers' | 'netlify' | 'github' | 'zip';
  connect(): Promise<ConnectionState>;                 // token or OAuth, once
  createSite(input: { name: string }): Promise<{ siteId: string; defaultUrl: string }>;
  deploy(input: { distDir: string; target: 'preview' | 'production'; buildHash: string })
    : Promise<{ deployId: string; url: string }>;
  listDeploys(limit: number): Promise<DeployRecord[]>;
  rollback(deployId: string): Promise<{ deployId: string; url: string }>;
  setDomain(domain: string): Promise<DomainState>;    // returns exact DNS steps if not verified
  status(): Promise<{ live: boolean; url: string; lastDeployAt?: string; domain?: DomainState }>;
  capabilities: { previewDeploys: boolean; functions: boolean; kv: boolean; externalDns: boolean };
}
```

**Cloudflare Workers static assets** (default for new sites). Connection is a
scoped API token: Workers Scripts Edit on the account, plus Zone DNS Edit
only when the artist's domain is on Cloudflare. Deploy is the documented
three-step upload session: register a manifest of file hashes, upload
missing files in batches, then deploy the script with the completion token
and a static-asset configuration. Preview deploys use a second script named
`<site>-preview` on its `workers.dev` subdomain. The capture function is a
tiny Worker route on the same script that writes to Resend contacts or KV.
Custom domains require the zone on Cloudflare; the adapter reports this
plainly and the Website Agent guides a nameserver move in the browser pane.

**Netlify** (second adapter, and the right pick when the artist already uses
it). Connection is OAuth through the generic OAuth config on an `api` source.
Deploy is a single zip upload that creates or updates the site; draft deploys
are previews. Custom domains accept a CNAME from any registrar. Capture uses
a Netlify function. The free plan is credit-capped; the adapter surfaces the
plan state from the API so the artist is never surprised.

**GitHub** (for technical artists and existing static sites). Connection is
the existing GitHub source. The adapter pushes `dist/` (managed mode) or the
edited source (static-repo mode) to a branch and reports the commit. Hosting
stays whatever their repo already deploys to.

**Zip** (always available). Packs `dist/` as an Output the artist can upload
anywhere. This is the fallback when no host is connected and the honest
answer when a closed builder cannot take a deploy.

### External site modes

`website_inspect_external` runs before anything is built for an artist who
already has a site. It fetches the URL, reads headers and markup, and reports:
platform guess (WordPress, Squarespace, Wix, Bandzoogle, Linktree, static on
Netlify, Vercel, Cloudflare, GitHub Pages, unknown), page inventory, an SEO
audit using the same rules as the builder, capture-form presence, social
links, and whether an EPK exists. The agent presents the result and offers:

- **WordPress**: connect with an application password. The adapter exposes
  posts, pages, and media through the REST API. Routines write posts and
  update pages; the site keeps its theme.
- **Static repo**: connect GitHub. The Site Builder edits their code with the
  same skills, and the builder's `audit` still runs on the rendered output
  when a local build command exists.
- **Closed builder**: the Website Agent operates content changes the artist
  cues through `browser_tool` in the app's browser pane, and Artist OS hosts
  **sidecar pages** on a managed subdomain: the signup gate and sneak-peek
  door, lyric pages, a show-alert signup, secret pages for QR codes, and a
  press kit. Sidecar pages carry the artist's theme and link back. The artist
  keeps their site and gains every door.
- **Rebuild on Artist OS**: only when the artist chooses it. Inspect output
  seeds `content/` so nothing is retyped.

## Data Model

### Manifest `website/site.json`

```ts
interface WebsiteManifest {
  version: 1;
  mode: 'managed' | 'wordpress' | 'static-repo' | 'closed-builder' | 'none';
  adapter?: SiteDeployAdapter['id'];
  provider?: {
    accountId?: string;        // Cloudflare account, Netlify team, GitHub owner
    siteId?: string;           // script name, Netlify site id, repo
    previewSiteId?: string;
    kvNamespaceId?: string;
    sourceSlug: string;        // the source holding the credential
  };
  urls: { preview?: string; production?: string; sidecar?: string };
  domain?: {
    name: string;
    state: 'unverified' | 'pending-dns' | 'active' | 'error';
    steps?: string[];          // exact DNS instructions from the adapter
    checkedAt?: string;
  };
  external?: { url: string; platform: string; inspectedAt: string; inventory: string[] };
  publishPolicy: {
    contentOnly: 'auto' | 'needs-you';     // shows, releases, links, journal
    design: 'needs-you';                   // templates, theme; never auto
    routines: Record<string, 'auto' | 'needs-you'>;
  };
  targetApproval?: { approvedAt: string; approvedBy: 'user'; target: string };
  history: DeployRecord[];    // newest first, capped at 50
  lastBuild?: { at: string; hash: string; auditScore: number; warnings: number };
  capture: {
    backend: 'resend' | 'kv' | 'none';
    formIds: string[];                     // 'newsletter', 'sneak-peek', 'show-alerts'
    lastDrainAt?: string; drainCursor?: string;
  };
}

interface DeployRecord {
  id: string; target: 'preview' | 'production'; at: string;
  url: string; buildHash: string; previousDeployId?: string;
  origin: { kind: 'user' | 'agent' | 'automation'; sessionId?: string; automationId?: string };
  status: 'live' | 'superseded' | 'rolled-back' | 'failed'; error?: string;
}
```

### Content contract `website/content/*`

```ts
interface SiteContent {
  artist: { name: string; tagline?: string; bio: { short: string; long: string }; location?: string;
            booking?: { email?: string; agent?: string }; press?: { email?: string } };
  releases: Array<{ id: string; title: string; type: 'single' | 'ep' | 'album'; date: string;
            artworkAssetId: string; links: { spotify?: string; apple?: string; youtube?: string; bandcamp?: string; presave?: string; smart?: string };
            featured?: boolean; lyricsPageIds?: string[] }>;
  shows: Array<{ id: string; date: string; city: string; venue: string; ticketUrl?: string; soldOut?: boolean; calendarEventId?: string }>;
  videos: Array<{ id: string; title: string; youtubeId?: string; assetId?: string; featured?: boolean }>;
  links: Array<{ label: string; url: string; kind: 'social' | 'store' | 'other' }>;
  press: Array<{ id: string; outlet: string; quote?: string; url?: string; date?: string }>;
  journal: Array<{ id: string; date: string; title: string; body: string; embedUrl?: string; assetId?: string }>;
  pages: Array<{ slug: string; title: string; markdownPath: string; kind: 'lyrics' | 'epk' | 'secret' | 'custom'; noindex?: boolean }>;
  signup: { enabled: boolean; forms: Array<{ id: string; headline: string; reward?: { kind: 'download' | 'stream' | 'none'; assetId?: string; url?: string } }> };
  seo: { siteName: string; defaultDescription: string; ogImageAssetId?: string; canonicalBase?: string };
}
```

Structured operations on this contract are what `website_set_content`
accepts, so an automation adding a show never has to know the schema beyond
one entry.

### Capture records

Signups do not get a new record type. They arrive in Community through spec
38's sync when the backend is Resend, or through `website_capture_sync` when
the backend is KV. Either way the contact carries
`source: 'signup-form'`, `consentEvidence { source: 'website', formId, capturedAt, ipHash }`,
and a tag for the form. A `sneak-peek` signup also gets the tag
`sneak-peek-<releaseId>` so the Community Agent can follow up.

## Connections And Signup Guidance

The Website Agent guides the artist through host signup in the app's browser
pane using `browser_tool`. Rules it carries:

- It opens the signup or token page and narrates each step. It never types a
  password, payment detail, or personal identifier and never completes a
  CAPTCHA. The artist does those.
- For Cloudflare it lands the artist on the API token creation page,
  explains the exact permission set, and collects the token through
  `source_credential_prompt`, which stores it in the source's encrypted
  credential without the agent seeing it typed.
- For Netlify it triggers the OAuth flow through the source and waits for the
  callback.
- For domains it reads the adapter's DNS steps and walks the artist through
  their registrar in the pane. It verifies with `website_domain_check` and
  never claims a domain is live until the adapter reports `active`.
- It explains cost plainly: Cloudflare free covers static sites without a
  ceiling on asset requests; Netlify free is credit-capped; a custom domain
  costs whatever the registrar charges.

If Cloudflare's public OAuth for third-party apps is confirmed available
during implementation, the adapter adds it as the first choice and keeps the
token path as the fallback.

## The Agents

### Website Agent (operator)

```ts
{
  slug: 'website-agent',
  metadata: {
    name: 'Website Agent',
    description: 'Runs the artist\'s website: builds one if there is none, works with the one they have, keeps it current, keeps the email door open, and keeps it findable.',
    avatar: '🌐',
    permissionMode: 'ask',
    thinkingLevel: 'medium',
    greeting: 'Do you have a site already, or are we building one? Either way, give me the URL or the vibe.',
    inputs: 'A URL to inspect, or a goal: build, update, add a release or show, add a signup door, fix SEO, or an idea to try.',
    outputs: 'A live or previewed site change with a URL, a health or SEO readout, or a concrete plan the Site Builder can execute.',
    tags: ['website', 'site', 'seo', 'signup', 'hosting', 'growth'],
    skills: ['artist-website-playbook', 'site-growth', 'artist-seo'],
    sources: [],
    optionalSources: ['cloudflare', 'netlify', 'github', 'printing-press-social'],
    trustedWorkerTools: [
      'website_get_manifest', 'website_inspect_external', 'website_set_content',
      'website_build', 'website_preview', 'website_deploy', 'website_rollback',
      'website_domain_set', 'website_domain_check', 'website_status',
      'website_seo_audit', 'website_capture_sync', 'website_history',
    ],
    routing: {
      bestFor: [
        'building a first artist site from HQ context and approved assets',
        'inspecting and improving an existing site without rebuilding it',
        'adding releases, shows, links, journal entries, and signup doors to the site',
        'publishing, rolling back, connecting a domain, and checking site health and SEO',
      ],
      notFor: [
        'artwork or brand direction (art-director, branding-agent)',
        'fan email content or list management (community-agent)',
        'social posts (social-publisher)',
        'writing or changing site code directly (site-builder, which it delegates to)',
      ],
      handsOffTo: ['site-builder', 'branding-agent', 'art-director', 'community-agent', 'social-publisher'],
    },
  },
}
```

System prompt laws: never edit files, delegate to `@site-builder` with a
bounded brief and wait for the return path; preview before any production
publish; publish on the user's cue in a session and per policy in routines;
read artist context for profile, branding, and voice before proposing
anything; treat every site as the artist's, not the agent's; when an
existing site is closed, operate it and offer sidecar pages rather than a
rebuild; report deploy URLs and hashes, never "should be live."

### Site Builder (worker)

```ts
{
  slug: 'site-builder',
  metadata: {
    name: 'Site Builder',
    description: 'Writes and renders the artist site under website/: templates, theme, content, functions. Builds, audits, and previews. Never publishes.',
    avatar: '🧱',
    permissionMode: 'allow-all',          // scoped to website/ by the runtime
    thinkingLevel: 'high',
    greeting: 'Give me the brief and I will build and preview it.',
    inputs: 'A bounded brief from the Website Agent or the user: a page, a section, a theme change, a content edit, or a bug.',
    outputs: 'Edited files under website/, a passing build, an audit score, and a preview Output in the canvas.',
    tags: ['website', 'html', 'css', 'build', 'preview'],
    skills: ['site-builder', 'artist-website-playbook', 'artist-seo'],
    trustedWorkerTools: ['website_get_manifest', 'website_set_content', 'website_build', 'website_preview', 'website_seo_audit'],
    routing: {
      bestFor: ['implementing site changes end to end and proving them with a preview'],
      notFor: ['deciding what to publish or when (website-agent)', 'talking to hosts or domains (website-agent)'],
      handsOffTo: ['website-agent'],
    },
  },
}
```

The runtime scopes this agent's `Write`, `Edit`, and `Bash` to
`<workspace>/website/` and `tools/site-builder`. It cannot call
`website_deploy`. Its brief comes through `message_agent` and its result
returns through the spec 24 return path with the preview Output id, the
build hash, and the audit score.

### Creative handoffs

Theme tokens are derived from `get_artist_context topic:'branding'` and the
primary artwork in the Release Kit. When the artist wants a look that does not
exist yet, the Website Agent hands to `@branding-agent` for direction or
`@art-director` for a hero image, then feeds the result back into the brief.
No third website agent.

## Skills

- **artist-website-playbook**: what every artist site needs and why. Hero
  with the current focus; music with smart links and presave; shows with
  tickets and a past-shows archive; video; about with short and long bio;
  press kit page with downloadable assets, quotes, and contact; newsletter
  door above the fold and at the end of every page; merch link; socials;
  booking contact; a 404 that still has the door. Accessibility baseline.
  Performance budget: hero under 200 KB, total page under 1 MB, no
  render-blocking fonts.
- **site-builder**: the content contract, template syntax, theme tokens, the
  build and audit loop, how to publish a preview Output with `showInCanvas`,
  the secret-pattern rule, "never claim a build succeeded until `dist/`
  exists and the audit ran."
- **site-growth**: the idea bank with copy. Sneak-peek gate for the next
  release, release countdown, lyric pages (one per song, the highest-intent
  search traffic an artist gets), city-based show alerts, setlist voting,
  fan wall from replies, secret pages for QR codes at shows and on merch,
  journal entries built from recent posts, "text JOIN" and email doors
  everywhere, early-access pages for core fans. Each idea names the routine
  or door that makes it real.
- **artist-seo**: titles and descriptions per page type, canonical rules,
  structured data for group, album, recording, and event, image weight and
  alt text, internal linking between lyric pages and releases, sitemap
  hygiene, what to check monthly, and what not to bother with.

## Session Tools

All `executionMode: 'registry'` with handlers delegating to `WebsiteService`
callbacks on `SessionToolContext`, the same pattern as `get_artist_context`.

| Tool | Safe mode | Read-only | Notes |
| --- | --- | --- | --- |
| `website_get_manifest` | allow | yes | manifest minus secrets; mode, urls, policy, last build, domain state |
| `website_inspect_external` | allow | yes | fetch and analyze a URL; platform guess, inventory, SEO audit, capture presence; bounded to 40 pages |
| `website_status` | allow | yes | adapter status plus a live fetch of production and preview URLs with hash check |
| `website_history` | allow | yes | last 50 deploys |
| `website_seo_audit` | allow | yes | runs builder `audit` on `dist/` or on an external URL; JSON with score and fixes |
| `website_preview` | allow | yes | serves `dist/` locally and publishes a web Output with `showInCanvas` |
| `website_set_content` | block | no | structured ops: upsert release, show, video, link, press, journal, page, signup form, seo; validates against the contract |
| `website_build` | block | no | runs builder `build` then `audit`; returns hash, score, warnings; refuses on secret-pattern hit |
| `website_deploy` | block | no | `target: 'preview'` always allowed; `target: 'production'` requires target approval on file, then sends when cued by a human turn or when the routine policy is `auto` for the change class |
| `website_rollback` | block | no | to previous or a named deploy id |
| `website_domain_set` | block | no | returns exact DNS steps; never claims active |
| `website_domain_check` | allow | yes | re-verifies and updates state |
| `website_capture_sync` | block | no | drains KV signups into Community with consent evidence; no-op on Resend backend |
| `website_connect_host` | block | no | starts the adapter connection flow; records target approval when the user confirms in the UI |

"Cued by a human turn" is the same signal spec 33 and spec 38 use.

## Change Classes And The Publish Policy

Every build diff is classified before production:

- **content-only**: changes confined to `content/` and `assets/`. New show,
  new release, new journal entry, link update, bio edit.
- **design**: any change under `site/`, `theme/`, or `functions/`.

Policy defaults: content-only `needs-you` for the first thirty days, then the
Website Agent offers to switch to `auto` once three publishes have gone out
without a rollback. Design is always `needs-you`. Routines each carry their
own setting and inherit the default.

A `needs-you` publish creates a Needs You entry: title, change summary,
preview URL, audit score, and two buttons, Publish and Skip. Publish calls
`website_deploy` with the recorded build hash.

## Routines (spec 33 automations, opt-in)

| Routine | Schedule | Agent | What it does |
| --- | --- | --- | --- |
| Weekly Site Update | Mon 11:00 local, staggered after Snapshot and Signal Scan | website-agent, safe for reads, delegates build | pulls new Release Kit items, calendar shows in the next 90 days, and recent posts from the social catalog; writes content; builds; previews; publishes per policy |
| Signup Drain | 15 min | service | KV backend only; drains into Community |
| Site Health | daily 08:00 | service | production fetch, hash match, SSL expiry, domain state, broken links; Needs You on failure with the fix |
| SEO Pulse | first Monday monthly | website-agent | audit plus three concrete improvements as a brief for the Site Builder |
| Release Mode | on each release date 00:05 local | website-agent | featured release swap, presave to listen links, sneak-peek gate closes, journal entry; publishes per policy |
| Show Mode | 7 days before each show | website-agent | show pinned to hero, city show-alert door on, ticket link check |
| Sidecar Sync | with Weekly Site Update | website-agent | closed-builder mode only; refreshes sidecar pages |

Runs land in the one list with the `website` tag and deep-link to the
preview.

## UI

An HQ page **Website**, reachable from the home Workers list and the
sidebar:

1. **Status card**: mode, production URL, domain state, Live or Down, last
   publish, audit score. Buttons: Edit with Agent, Preview, Publish, History.
2. **Setup flow** when mode is `none`: "Do you already have a website?" Yes
   asks for the URL and runs inspect; No starts Create with host choice
   defaulting to Cloudflare and a plain cost line for each.
3. **Inspect result** for existing sites: platform, what is good, what is
   missing, and the three mode buttons with what each means.
4. **Preview pane**: the canvas web Output of the last build, with the
   change summary and audit findings alongside.
5. **History**: deploys with target, origin, hash, and a Rollback button.
6. **Doors**: signup forms, their counts from Community, and the sneak-peek
   reward.
7. **Routines**: the table above with on, off, and policy per routine.
8. **Connections** inline: host and domain state with the guided flows.

HQ home Needs You gains "Publish: <summary> to <domain>" and "Site is down:
<reason>". State of Play gains: no site after thirty days of activity, site
not updated in sixty days, no signup door, release in fourteen days with no
sneak-peek door, and SEO score under 60.

## Compliance And Safety

- The agent never enters credentials, payment details, or identifiers and
  never completes bot checks. It guides.
- Tokens are stored in encrypted source credentials, never in `website/`.
- Capture forms show what the fan is signing up for and link to a privacy
  note page the builder generates. Every signup carries consent evidence.
- Sidecar pages and managed sites include an unsubscribe path through spec
  38 and a contact address.
- Third-party embeds load only from allow-listed providers (YouTube, Spotify,
  Bandcamp, Instagram, TikTok oEmbed) and never inject tracking beyond what
  the artist enables.
- The builder strips EXIF from uploaded photos.

## Migration And Compatibility

- No existing users of this feature; no migration.
- `website/` joins the shared-storage manifest so team mode syncs it like
  `records/` and `decks/`.
- `dist/` and any local preview cache are excluded from sync and from the
  Vault.

## Implementation Slices

### Slice 1 — Folder, manifest, builder, preview
`website/` convention, manifest read and write, `tools/site-builder` with
build, audit, serve, pack, three starter templates (minimal, editorial,
bold), theme derivation from branding, `website_get_manifest`,
`website_set_content`, `website_build`, `website_preview`,
`website_seo_audit`. Site Builder agent and the site-builder and
artist-website-playbook skills. An artist can build and preview a site in
the canvas with no host.

### Slice 2 — Cloudflare adapter and publish
Cloudflare source with token connection and guided browser flow,
`cloudflare-workers` adapter with upload session deploy, preview and
production scripts, `website_connect_host`, `website_deploy`,
`website_rollback`, `website_history`, `website_status`, target approval,
Website page status and history. Change classes and publish policy.

### Slice 3 — Website Agent, routines, Needs You
Website Agent starter with routing hints, the site-growth and artist-seo
skills, Artist Manager routing line, Weekly Site Update, Site Health,
Release Mode, Show Mode, Needs You entries, State of Play rules.

### Slice 4 — Capture doors
Signup function for Cloudflare with Resend or KV backend, sneak-peek reward
flow, `website_capture_sync`, Doors section, tags into Community.

### Slice 5 — Domains
`website_domain_set` and `website_domain_check`, guided registrar flow,
nameserver move guidance for Cloudflare.

### Slice 6 — Existing sites
`website_inspect_external`, WordPress adapter, static-repo mode through the
GitHub source, closed-builder mode with browser operation and sidecar pages
on the managed subdomain, Sidecar Sync.

### Slice 7 — Netlify and GitHub adapters, zip export
Netlify OAuth source and adapter with zip deploys and draft previews, GitHub
push adapter, zip Output.

Slice 1 alone is useful. Slice 2 makes it real. Slice 4 is where it pays
back into Community.

## Required Tests

### Builder
- `build` renders every content type, copies only referenced assets with
  matching hashes, and fails on a hash mismatch.
- Structured data validates for group, album, recording, and event.
- `audit` flags a missing description, an oversized hero, a broken internal
  link, and a page without canonical; score math is deterministic.
- A template containing a value matching the secret pattern fails the build
  with the file and line.

### Adapters
- Cloudflare deploy uploads only files missing from the manifest response,
  deploys with the completion token, and returns a URL whose fetched hash
  matches; a failed upload leaves the previous deploy live and records
  `failed`.
- Rollback restores the previous deploy id and the fetched hash matches it.
- Netlify zip deploy creates the site on first run and updates it on the
  second; draft deploys never touch production.
- `setDomain` returns steps and state `pending-dns` without claiming active;
  `domain_check` flips to `active` only when the adapter reports it.

### Policy and approval
- `website_deploy production` without target approval fails with the exact
  message; with approval and a human turn it deploys; in an automation with
  policy `needs-you` it creates a Needs You entry and does not deploy; with
  policy `auto` and a content-only diff it deploys; with `auto` and a design
  diff it creates a Needs You entry.
- The Site Builder cannot call `website_deploy` and cannot write outside
  `website/`.

### Existing sites
- Inspect identifies WordPress, Squarespace, and a static Netlify site from
  fixtures, inventories pages within the bound, and reports missing capture.
- Closed-builder mode publishes sidecar pages and never attempts a deploy to
  the external platform.

### Capture
- A signup through the function with the Resend backend appears in Community
  after sync with `signup-form` source, form id, and hashed IP; with the KV
  backend it appears after `website_capture_sync`; a sneak-peek signup gets
  the release tag and the reward URL.

### Routines
- Weekly Site Update with a new calendar show produces one content entry,
  one build, one preview, and either a deploy or a Needs You entry per
  policy, and never both.
- Site Health on a hash mismatch raises Needs You with the last good deploy
  id offered for rollback.

## Launch Criteria

- An artist with no site connects Cloudflare in one guided session, gets a
  site built from their HQ context and approved artwork, previews it in the
  canvas, approves the target once, and has a live URL, all inside one
  conversation with the Website Agent.
- A signup on that site is in the fan list within fifteen minutes with
  consent evidence.
- A show added to the HQ calendar appears on the site after the next Weekly
  Site Update with no prompt when the policy is `auto`.
- A bad publish is rolled back in one click and the health check confirms
  the previous hash.
- An artist with a Squarespace site gets an inspect report, keeps their site,
  and has a sneak-peek door live on a sidecar page the same day.
- No test can make the Site Builder write outside `website/` or publish.

## Open Verifications During Implementation

1. Whether Cloudflare offers public OAuth apps to third parties. Fallback is
   the scoped token flow, which is the plan of record.
2. The exact token permission names required for the assets upload session
   and script deploy, and whether Workers custom domains can be attached by
   API with the zone on Cloudflare.
3. Netlify free plan credit reset cadence and pause behavior, so the cost
   line the agent reads is true.
4. Whether Cloudflare Pages should be offered as an alternative adapter for
   artists who already use it, or whether the migration guide makes Workers
   the only path.
5. oEmbed availability and rate limits for Instagram and TikTok journal
   embeds; fallback is caption plus Vault asset.

## V2

- Analytics: Cloudflare Web Analytics or a privacy-light script, surfaced in
  State of Play as site traffic and door conversion.
- Merch: Shopify Buy Button and product sync from the Shopify agent.
- Multi-language pages.
- Team edits with the spec 26 V2 team model.
- A Site Builder pass that generates a full theme from a single reference
  image with the Art Director in the loop.

## Product North Star

An artist tells the Website Agent "I don't have a site." Twenty minutes
later they have one that looks like their record, reads in their voice, has
their shows and links, and a door that says "get the next single a week
early." They approve Cloudflare once and their domain the next day. From
then on, every show they add to the calendar and every release they finish
shows up on the site by Monday, every signup lands in Community, and once a
month the agent tells them the three things that would make more people find
them. They never learn what a deploy is.
