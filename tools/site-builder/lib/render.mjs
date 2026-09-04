import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { render } from './template.mjs';

const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Emitted beside the static files, not treated as one. The deploy adapter
 * uploads this as the Worker module and keeps it out of the asset manifest.
 */
export const CAPTURE_WORKER_FILE = '_worker.js';
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_ASSET_BYTES = 100 * 1024 * 1024;
const ASSET_EXTENSIONS = {
  image: new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']),
  video: new Set(['.mp4', '.webm']),
  audio: new Set(['.mp3', '.m4a', '.wav']),
  download: new Set(['.pdf', '.zip', '.mp3', '.m4a', '.wav', '.mp4', '.webm']),
};

/**
 * Credential shapes that must never reach a published site. Matched against
 * every rendered file and every file copied into dist.
 */
const SECRET_PATTERNS = [
  { name: 'Resend API key', re: /\bre_[A-Za-z0-9]{16,}\b/ },
  { name: 'OpenAI-style key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'Anthropic key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'Bearer token literal', re: /\bBearer\s+[A-Za-z0-9._-]{24,}\b/ },
];

export function scanForSecrets(text, label) {
  const findings = [];
  for (const { name, re } of SECRET_PATTERNS) {
    const match = re.exec(text);
    if (!match) continue;
    const line = text.slice(0, match.index).split('\n').length;
    findings.push({ file: label, line, kind: name });
  }
  return findings;
}

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const info = lstatSync(full);
    if (info.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${full}`);
    if (info.isDirectory()) out.push(...walk(full));
    else if (info.isFile()) out.push(full);
  }
  return out;
}

function isInside(root, candidate) {
  const base = resolve(root);
  const target = resolve(candidate);
  return target === base || target.startsWith(`${base}${sep}`);
}

function safeRelativePath(value, label) {
  if (typeof value !== 'string' || !value || value.includes('\0') || isAbsolute(value)) {
    throw new Error(`${label} must be a relative path.`);
  }
  const normalized = value.replaceAll('\\', '/');
  if (normalized.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`${label} contains an unsafe path segment.`);
  }
  return normalized;
}

function outputPath(outDir, relativePath) {
  const safe = safeRelativePath(relativePath, 'Generated output path');
  const target = resolve(outDir, safe);
  if (!isInside(outDir, target)) throw new Error(`Generated output escapes dist/: ${relativePath}`);
  return target;
}

function httpUrl(value, label) {
  if (value === undefined || value === null || value === '') return undefined;
  let parsed;
  try {
    parsed = new URL(String(value));
  } catch {
    throw new Error(`${label} must be a valid http(s) URL.`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`${label} must use http or https and cannot contain credentials.`);
  }
  return parsed.toString();
}

function validateTheme(theme) {
  if (!theme || typeof theme !== 'object') throw new Error('Theme tokens are missing.');
  const cssValue = /^[^;{}<>\r\n]+$/;
  for (const [name, value] of Object.entries(theme.colors ?? {})) {
    if (typeof value !== 'string' || !cssValue.test(value)) throw new Error(`Unsafe theme color: ${name}`);
  }
  for (const name of ['displayFamily', 'bodyFamily']) {
    const value = theme.type?.[name];
    if (typeof value !== 'string' || !cssValue.test(value)) throw new Error(`Unsafe theme type token: ${name}`);
  }
  for (const [name, min, max] of [['displayWeight', 100, 900], ['scale', 0.75, 2], ['radius', 0, 64], ['maxWidth', 320, 2400]]) {
    const value = name in (theme.type ?? {}) ? theme.type[name] : theme[name];
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid theme number: ${name}`);
  }
}

function validateContent(content) {
  if (!content || typeof content !== 'object' || !content.artist || !content.seo) throw new Error('Site content is invalid.');
  for (const page of content.pages ?? []) {
    if (!SAFE_SLUG.test(String(page.slug)) || String(page.slug).length > 80) throw new Error(`Invalid page slug: ${String(page.slug)}`);
  }
  const urls = [
    ['seo.canonicalBase', content.seo.canonicalBase],
    ...(content.links ?? []).map(link => [`link ${link.id ?? link.label}`, link.url]),
    ...(content.press ?? []).map(item => [`press ${item.id}`, item.url]),
    ...(content.shows ?? []).map(show => [`show ${show.id} ticketUrl`, show.ticketUrl]),
    ...(content.journal ?? []).map(entry => [`journal ${entry.id} embedUrl`, entry.embedUrl]),
    ...(content.signup?.forms ?? []).map(form => [`signup ${form.id} reward URL`, form.reward?.url]),
    ...(content.releases ?? []).flatMap(release => Object.entries(release.links ?? {}).map(([key, value]) => [`release ${release.id} ${key}`, value])),
  ];
  for (const [label, value] of urls) httpUrl(value, label);
  if (content.seo.canonicalBase) {
    const canonical = new URL(content.seo.canonicalBase);
    if (canonical.search || canonical.hash) throw new Error('seo.canonicalBase cannot contain a query string or fragment.');
  }
  for (const video of content.videos ?? []) {
    if (video.youtubeId && !/^[A-Za-z0-9_-]{1,64}$/.test(video.youtubeId)) throw new Error(`Invalid YouTube video id: ${video.id}`);
  }
}

function loadTemplates(templatesDir) {
  const templates = {};
  const partials = {};
  for (const file of walk(templatesDir)) {
    const rel = relative(templatesDir, file).replaceAll('\\', '/');
    if (extname(file) !== '.html') continue;
    const source = readFileSync(file, 'utf8');
    if (rel.startsWith('partials/')) {
      partials[rel.slice('partials/'.length).replace(/\.html$/, '')] = source;
    } else {
      templates[rel.replace(/\.html$/, '')] = source;
    }
  }
  return { templates, partials };
}

function themeCss(theme) {
  const c = theme.colors;
  return `:root{--bg:${c.background};--surface:${c.surface};--text:${c.text};--muted:${c.muted};--accent:${c.accent};--accent-text:${c.accentText};--border:${c.border};--display:${theme.type.displayFamily};--body:${theme.type.bodyFamily};--display-weight:${theme.type.displayWeight};--radius:${theme.radius}px;--max-width:${theme.maxWidth}px}`;
}

function absoluteUrl(base, path) {
  if (!base) return undefined;
  const trimmed = base.replace(/\/+$/, '');
  return path === '/' ? `${trimmed}/` : `${trimmed}${path}`;
}

function jsonLd(content, base) {
  const graph = [];
  const artistUrl = absoluteUrl(base, '/');
  graph.push({
    '@type': 'MusicGroup',
    name: content.artist.name,
    description: content.artist.bio.short || content.seo.defaultDescription,
    ...(artistUrl ? { url: artistUrl } : {}),
    ...(content.artist.location ? { foundingLocation: content.artist.location } : {}),
    ...(content.links.length ? { sameAs: content.links.filter(l => l.kind === 'social').map(l => l.url) } : {}),
  });
  for (const release of content.releases) {
    graph.push({
      '@type': release.type === 'single' ? 'MusicRecording' : 'MusicAlbum',
      name: release.title,
      datePublished: release.date,
      byArtist: { '@type': 'MusicGroup', name: content.artist.name },
      ...(release.links.spotify ? { sameAs: release.links.spotify } : {}),
    });
  }
  for (const show of content.shows) {
    graph.push({
      '@type': 'Event',
      name: `${content.artist.name} at ${show.venue}`,
      startDate: show.date,
      eventStatus: 'https://schema.org/EventScheduled',
      location: { '@type': 'Place', name: show.venue, address: show.city },
      performer: { '@type': 'MusicGroup', name: content.artist.name },
      ...(show.ticketUrl ? { offers: { '@type': 'Offer', url: show.ticketUrl } } : {}),
    });
  }
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })
    .replace(/[<>&\u2028\u2029]/g, character => ({
      '<': '\\u003c',
      '>': '\\u003e',
      '&': '\\u0026',
      '\u2028': '\\u2028',
      '\u2029': '\\u2029',
    })[character]);
}

function pageMeta(content, { path, title, description, noindex }) {
  const base = content.seo.canonicalBase;
  return {
    path,
    title,
    description: description || content.seo.defaultDescription,
    canonical: absoluteUrl(base, path),
    noindex: Boolean(noindex),
    ogTitle: title,
    ogDescription: description || content.seo.defaultDescription,
    ogUrl: absoluteUrl(base, path),
    ogImage: content.seo.ogImageUrl
      ? (base ? absoluteUrl(base, content.seo.ogImageUrl) : content.seo.ogImageUrl)
      : undefined,
  };
}

/** Split shows into upcoming and past relative to `today` (YYYY-MM-DD). */
function partitionShows(shows, today) {
  const upcoming = shows.filter(show => show.date >= today);
  const past = shows.filter(show => show.date < today).reverse();
  return { upcoming, past };
}

function referencedAssetIds(content) {
  return new Set([
    content.seo?.ogImageAssetId,
    ...(content.releases ?? []).map(item => item.artworkAssetId),
    ...(content.videos ?? []).map(item => item.assetId),
    ...(content.journal ?? []).map(item => item.assetId),
    ...(content.signup?.forms ?? []).map(item => item.reward?.assetId),
  ].filter(Boolean));
}

function expectedAssetKinds(content) {
  const expected = new Map();
  const add = (id, kind, label) => {
    if (!id) return;
    const current = expected.get(id) ?? [];
    current.push({ kind, label });
    expected.set(id, current);
  };
  add(content.seo?.ogImageAssetId, 'image', 'Open Graph image');
  for (const release of content.releases ?? []) add(release.artworkAssetId, 'image', `release ${release.id} artwork`);
  for (const video of content.videos ?? []) add(video.assetId, 'video', `video ${video.id}`);
  for (const entry of content.journal ?? []) add(entry.assetId, 'image', `journal ${entry.id} image`);
  return expected;
}

function stripImageMetadata(bytes, extension) {
  if (extension === '.jpg' || extension === '.jpeg') {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
    const parts = [bytes.subarray(0, 2)];
    let offset = 2;
    while (offset + 1 < bytes.length) {
      if (bytes[offset] !== 0xff) { parts.push(bytes.subarray(offset)); break; }
      const marker = bytes[offset + 1];
      if (marker === 0xda || marker === 0xd9) { parts.push(bytes.subarray(offset)); break; }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        parts.push(bytes.subarray(offset, offset + 2));
        offset += 2;
        continue;
      }
      if (offset + 4 > bytes.length) return bytes;
      const segmentLength = bytes.readUInt16BE(offset + 2);
      const end = offset + 2 + segmentLength;
      if (segmentLength < 2 || end > bytes.length) return bytes;
      if (![0xe1, 0xed, 0xfe].includes(marker)) parts.push(bytes.subarray(offset, end));
      offset = end;
    }
    return Buffer.concat(parts);
  }
  if (extension === '.png') {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (bytes.length < 8 || !bytes.subarray(0, 8).equals(signature)) return bytes;
    const parts = [bytes.subarray(0, 8)];
    const removed = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset);
      const end = offset + 12 + length;
      if (end > bytes.length) return bytes;
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      if (!removed.has(type)) parts.push(bytes.subarray(offset, end));
      offset = end;
      if (type === 'IEND') break;
    }
    return Buffer.concat(parts);
  }
  if (extension === '.webp' && bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const chunks = [];
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const size = bytes.readUInt32LE(offset + 4);
      const end = offset + 8 + size + (size % 2);
      if (end > bytes.length) return bytes;
      const type = bytes.toString('ascii', offset, offset + 4);
      if (type !== 'EXIF' && type !== 'XMP ') {
        const chunk = Buffer.from(bytes.subarray(offset, end));
        if (type === 'VP8X' && size > 0) chunk[8] &= ~0x0c;
        chunks.push(chunk);
      }
      offset = end;
    }
    const body = Buffer.concat(chunks);
    const header = Buffer.from(bytes.subarray(0, 12));
    header.writeUInt32LE(body.length + 4, 4);
    return Buffer.concat([header, body]);
  }
  return bytes;
}

function prepareAssets(content, manifest, assetsDir) {
  const referenced = referencedAssetIds(content);
  const expectedKinds = expectedAssetKinds(content);
  if (referenced.size === 0) return { copied: [], urls: new Map() };
  if (!assetsDir || !existsSync(assetsDir) || lstatSync(assetsDir).isSymbolicLink()) {
    throw new Error('Referenced website assets are unavailable.');
  }
  const root = realpathSync(assetsDir);
  const records = Array.isArray(manifest?.assets) ? manifest.assets : [];
  const byId = new Map();
  for (const record of records) {
    if (!record || typeof record.id !== 'string' || byId.has(record.id)) throw new Error('Website asset manifest has duplicate or invalid ids.');
    byId.set(record.id, record);
  }
  const copied = [];
  const urls = new Map();
  for (const id of [...referenced].sort()) {
    const record = byId.get(id);
    if (!record) throw new Error(`Referenced website asset is not staged: ${id}`);
    const rel = safeRelativePath(record.path, `Asset ${id} path`);
    const source = resolve(root, rel);
    if (!isInside(root, source) || !existsSync(source) || lstatSync(source).isSymbolicLink() || !statSync(source).isFile()) {
      throw new Error(`Referenced website asset is missing or unsafe: ${id}`);
    }
    if (!isInside(root, realpathSync(source))) throw new Error(`Referenced website asset escapes assets/: ${id}`);
    const extension = extname(source).toLowerCase();
    if (!ASSET_EXTENSIONS[record.kind]?.has(extension)) throw new Error(`Unsupported ${record.kind} asset type for ${id}: ${extension || '(none)'}`);
    for (const expectation of expectedKinds.get(id) ?? []) {
      if (record.kind !== expectation.kind) {
        throw new Error(`${expectation.label} requires an asset of type ${expectation.kind}, but ${id} is ${record.kind}.`);
      }
    }
    if (!SHA256.test(String(record.sha256))) throw new Error(`Invalid website asset hash: ${id}`);
    if (statSync(source).size > MAX_ASSET_BYTES) throw new Error(`Website asset exceeds the 100 MB build limit: ${id}`);
    const raw = readFileSync(source);
    const actual = createHash('sha256').update(raw).digest('hex');
    if (actual !== record.sha256) throw new Error(`Website asset hash mismatch: ${id}`);
    const secretFindings = scanForSecrets(raw.toString('utf8'), `assets/${rel}`);
    if (secretFindings.length) {
      const detail = secretFindings.map(item => `${item.file}:${item.line} ${item.kind}`).join(', ');
      throw new Error(`Refusing to build: credential-shaped values found in ${detail}`);
    }
    const contents = record.kind === 'image' ? stripImageMetadata(raw, extension) : raw;
    const path = `assets/${rel}`;
    copied.push({ path, contents });
    urls.set(id, `/${path.split('/').map(encodeURIComponent).join('/')}`);
  }
  return { copied, urls };
}

export function buildSite({ content, manifest, theme, templatesDir, assetsDir, outDir, today }) {
  validateContent(content);
  validateTheme(theme);
  if (!existsSync(templatesDir) || lstatSync(templatesDir).isSymbolicLink() || !statSync(templatesDir).isDirectory()) {
    throw new Error('Template directory is missing or unsafe.');
  }
  const { templates, partials } = loadTemplates(templatesDir);
  if (!templates.home) throw new Error(`No home.html template found in ${templatesDir}`);

  const preparedAssets = prepareAssets(content, manifest, assetsDir);
  const assetUrl = id => id ? preparedAssets.urls.get(id) : undefined;
  const renderContent = {
    ...content,
    seo: { ...content.seo, ogImageUrl: assetUrl(content.seo.ogImageAssetId) },
    releases: content.releases.map(item => ({ ...item, artworkUrl: assetUrl(item.artworkAssetId) })),
    videos: content.videos.map(item => ({ ...item, assetUrl: assetUrl(item.assetId) })),
    journal: content.journal.map(item => ({ ...item, assetUrl: assetUrl(item.assetId) })),
    signup: {
      ...content.signup,
      forms: content.signup.forms.map(item => ({
        ...item,
        reward: item.reward ? { ...item.reward, assetUrl: assetUrl(item.reward.assetId) } : undefined,
      })),
    },
  };

  const day = today ?? new Date().toISOString().slice(0, 10);
  const { upcoming, past } = partitionShows(renderContent.shows, day);
  const featuredRelease = renderContent.releases.find(r => r.featured) ?? renderContent.releases[0];
  const indexablePages = renderContent.pages.filter(page => !page.noindex);
  const captureEnabled = manifest?.capture?.backend && manifest.capture.backend !== 'none';
  const allowedFormIds = new Set(manifest?.capture?.formIds ?? []);

  const site = {
    artist: renderContent.artist,
    seo: renderContent.seo,
    links: renderContent.links,
    socialLinks: renderContent.links.filter(l => l.kind === 'social'),
    storeLinks: renderContent.links.filter(l => l.kind === 'store'),
    signup: renderContent.signup,
    primarySignup: captureEnabled && renderContent.signup.enabled
      ? renderContent.signup.forms.find(form => allowedFormIds.has(form.id))
      : undefined,
    year: new Date(`${day}T00:00:00Z`).getUTCFullYear(),
    themeCss: themeCss(theme),
    jsonLd: jsonLd(renderContent, renderContent.seo.canonicalBase),
    hasPressPage: renderContent.press.length > 0 || Boolean(renderContent.artist.press?.email),
    pages: indexablePages.map(page => ({ slug: page.slug, title: page.title })),
  };

  const documents = [];

  documents.push({
    path: 'index.html',
    template: 'home',
    data: {
      site,
      meta: pageMeta(renderContent, { path: '/', title: renderContent.seo.siteName, description: renderContent.seo.defaultDescription }),
      featuredRelease,
      releases: renderContent.releases,
      upcomingShows: upcoming,
      pastShows: past.slice(0, 12),
      videos: renderContent.videos,
      featuredVideo: renderContent.videos.find(v => v.featured) ?? renderContent.videos[0],
      journal: renderContent.journal.slice(0, 3),
    },
  });

  if (site.hasPressPage && templates.press) {
    documents.push({
      path: join('press', 'index.html'),
      template: 'press',
      data: {
        site,
        meta: pageMeta(renderContent, {
          path: '/press/',
          title: `Press · ${content.seo.siteName}`,
          description: `Press kit, quotes, and booking contact for ${content.artist.name}.`,
        }),
        press: renderContent.press,
        releases: renderContent.releases.slice(0, 6),
      },
    });
  }

  for (const page of renderContent.pages) {
    if (!templates.page) break;
    documents.push({
      path: join(page.slug, 'index.html'),
      template: 'page',
      data: {
        site,
        meta: pageMeta(renderContent, {
          path: `/${page.slug}/`,
          title: `${page.title} · ${content.seo.siteName}`,
          description: page.body.slice(0, 150).replace(/\s+/g, ' ').trim(),
          noindex: page.noindex,
        }),
        page: { ...page, bodyHtml: markdownish(page.body) },
      },
    });
  }

  if (templates.notfound) {
    documents.push({
      path: '404.html',
      template: 'notfound',
      data: {
        site,
        meta: pageMeta(renderContent, { path: '/404.html', title: 'Not found', description: 'That page does not exist.', noindex: true }),
      },
    });
  }

  // Render, scanning every emitted document for credentials.
  const emitted = [];
  const secrets = [];
  for (const doc of documents) {
    const html = render(templates[doc.template], doc.data, partials);
    secrets.push(...scanForSecrets(html, doc.path));
    emitted.push({ path: doc.path, contents: html });
  }

  const stylesheet = readIfExists(join(templatesDir, 'styles.css'));
  if (stylesheet) {
    const css = `${themeCss(theme)}\n${stylesheet}`;
    secrets.push(...scanForSecrets(css, 'styles.css'));
    emitted.push({ path: 'styles.css', contents: css });
  }

  const canonicalBase = renderContent.seo.canonicalBase;
  if (canonicalBase) {
    const urls = documents
      .filter(doc => !doc.data.meta.noindex)
      .map(doc => `  <url><loc>${absoluteUrl(canonicalBase, doc.data.meta.path)}</loc></url>`)
      .join('\n');
    emitted.push({
      path: 'sitemap.xml',
      contents: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    });
    emitted.push({
      path: 'robots.txt',
      contents: `User-agent: *\nAllow: /\nSitemap: ${absoluteUrl(canonicalBase, '/sitemap.xml')}\n`,
    });
  } else {
    emitted.push({ path: 'robots.txt', contents: 'User-agent: *\nAllow: /\n' });
  }

  // The capture door ships with the site only when a form is actually live,
  // so a site without signup deploys as pure static assets with no worker.
  if (site.primarySignup) {
    const workerSource = readIfExists(join(templatesDir, '..', 'functions', 'signup.js'))
      ?? readIfExists(join(templatesDir, 'functions', 'signup.js'));
    if (!workerSource) {
      throw new Error('Signup is enabled but the capture function template is missing.');
    }
    secrets.push(...scanForSecrets(workerSource, CAPTURE_WORKER_FILE));
    emitted.push({ path: CAPTURE_WORKER_FILE, contents: workerSource });
  }

  const copied = preparedAssets.copied;

  if (secrets.length > 0) {
    const detail = secrets.map(s => `${s.file}:${s.line} ${s.kind}`).join('\n  ');
    throw new Error(`Refusing to build: credential-shaped values found.\n  ${detail}`);
  }

  // Write dist.
  rmSync(outDir, { recursive: true, force: true });
  const hash = createHash('sha256');
  const files = [];

  for (const file of [...emitted].sort((a, b) => a.path.localeCompare(b.path))) {
    const target = outputPath(outDir, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.contents, 'utf8');
    hash.update(`${file.path}\0${createHash('sha256').update(file.contents).digest('hex')}\n`);
    files.push({ path: file.path, bytes: Buffer.byteLength(file.contents) });
  }
  for (const asset of copied.sort((a, b) => a.path.localeCompare(b.path))) {
    const target = outputPath(outDir, asset.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, asset.contents);
    const bytes = asset.contents.length;
    hash.update(`${asset.path}\0${createHash('sha256').update(asset.contents).digest('hex')}\n`);
    files.push({ path: asset.path, bytes });
  }

  return {
    hash: hash.digest('hex'),
    files,
    fileCount: files.length,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    pages: documents.map(doc => doc.data.meta.path),
  };
}

/**
 * Very small markdown subset for page bodies: headings, bold, italics, links,
 * and paragraphs. Page bodies are authored by the artist or their agent, never
 * fetched, so this stays intentionally minimal.
 */
export function markdownish(source) {
  const escape = (value) => value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  const inline = (value) => escape(value)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');

  return source
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => {
      const heading = /^(#{1,3})\s+(.*)$/.exec(block);
      if (heading) {
        const level = heading[1].length + 1;
        return `<h${level}>${inline(heading[2])}</h${level}>`;
      }
      if (/^[-*]\s+/m.test(block)) {
        const items = block.split('\n')
          .filter(line => /^[-*]\s+/.test(line))
          .map(line => `<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`)
          .join('');
        return `<ul>${items}</ul>`;
      }
      return `<p>${inline(block).replaceAll('\n', '<br>')}</p>`;
    })
    .join('\n');
}
