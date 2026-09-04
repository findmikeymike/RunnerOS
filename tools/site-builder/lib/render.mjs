import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { render } from './template.mjs';

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
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
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
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });
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
  };
}

/** Split shows into upcoming and past relative to `today` (YYYY-MM-DD). */
function partitionShows(shows, today) {
  const upcoming = shows.filter(show => show.date >= today);
  const past = shows.filter(show => show.date < today).reverse();
  return { upcoming, past };
}

export function buildSite({ content, theme, templatesDir, assetsDir, outDir, today }) {
  const { templates, partials } = loadTemplates(templatesDir);
  if (!templates.home) throw new Error(`No home.html template found in ${templatesDir}`);

  const day = today ?? new Date().toISOString().slice(0, 10);
  const { upcoming, past } = partitionShows(content.shows, day);
  const featuredRelease = content.releases.find(r => r.featured) ?? content.releases[0];
  const indexablePages = content.pages.filter(page => !page.noindex);

  const site = {
    artist: content.artist,
    seo: content.seo,
    links: content.links,
    socialLinks: content.links.filter(l => l.kind === 'social'),
    storeLinks: content.links.filter(l => l.kind === 'store'),
    signup: content.signup,
    primarySignup: content.signup.enabled ? content.signup.forms[0] : undefined,
    year: new Date(`${day}T00:00:00Z`).getUTCFullYear(),
    themeCss: themeCss(theme),
    jsonLd: jsonLd(content, content.seo.canonicalBase),
    hasPressPage: content.press.length > 0 || Boolean(content.artist.press?.email),
    pages: indexablePages.map(page => ({ slug: page.slug, title: page.title })),
  };

  const documents = [];

  documents.push({
    path: 'index.html',
    template: 'home',
    data: {
      site,
      meta: pageMeta(content, { path: '/', title: content.seo.siteName, description: content.seo.defaultDescription }),
      featuredRelease,
      releases: content.releases,
      upcomingShows: upcoming,
      pastShows: past.slice(0, 12),
      videos: content.videos,
      featuredVideo: content.videos.find(v => v.featured) ?? content.videos[0],
      journal: content.journal.slice(0, 3),
    },
  });

  if (site.hasPressPage && templates.press) {
    documents.push({
      path: join('press', 'index.html'),
      template: 'press',
      data: {
        site,
        meta: pageMeta(content, {
          path: '/press/',
          title: `Press · ${content.seo.siteName}`,
          description: `Press kit, quotes, and booking contact for ${content.artist.name}.`,
        }),
        press: content.press,
        releases: content.releases.slice(0, 6),
      },
    });
  }

  for (const page of content.pages) {
    if (!templates.page) break;
    documents.push({
      path: join(page.slug, 'index.html'),
      template: 'page',
      data: {
        site,
        meta: pageMeta(content, {
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
        meta: pageMeta(content, { path: '/404.html', title: 'Not found', description: 'That page does not exist.', noindex: true }),
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

  const canonicalBase = content.seo.canonicalBase;
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

  // Copy referenced assets.
  const copied = [];
  if (assetsDir && existsSync(assetsDir)) {
    for (const file of walk(assetsDir)) {
      const rel = join('assets', relative(assetsDir, file));
      copied.push({ from: file, path: rel.replaceAll('\\', '/') });
    }
  }

  if (secrets.length > 0) {
    const detail = secrets.map(s => `${s.file}:${s.line} ${s.kind}`).join('\n  ');
    throw new Error(`Refusing to build: credential-shaped values found.\n  ${detail}`);
  }

  // Write dist.
  rmSync(outDir, { recursive: true, force: true });
  const hash = createHash('sha256');
  const files = [];

  for (const file of [...emitted].sort((a, b) => a.path.localeCompare(b.path))) {
    const target = join(outDir, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.contents, 'utf8');
    hash.update(`${file.path} ${createHash('sha256').update(file.contents).digest('hex')}\n`);
    files.push({ path: file.path, bytes: Buffer.byteLength(file.contents) });
  }
  for (const asset of copied.sort((a, b) => a.path.localeCompare(b.path))) {
    const target = join(outDir, asset.path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(asset.from, target);
    const bytes = statSync(target).size;
    hash.update(`${asset.path} ${createHash('sha256').update(readFileSync(target)).digest('hex')}\n`);
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
