import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, posix } from 'node:path';
import { scanForSecrets } from './render.mjs';

const WEIGHTS = { error: 12, warning: 5, notice: 2 };
const PAGE_BYTE_BUDGET = 1_000_000;
const IMAGE_BYTE_BUDGET = 1_000_000;
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);

function walk(dir, symlinks = []) {
  if (!existsSync(dir)) return { files: [], symlinks };
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const info = lstatSync(full);
    if (info.isSymbolicLink()) symlinks.push(full);
    else if (info.isDirectory()) files.push(...walk(full, symlinks).files);
    else if (info.isFile()) files.push(full);
  }
  return { files, symlinks };
}

function attr(tag, name) {
  const match = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3]) : null;
}

function findings(html, pagePath, distFiles) {
  const out = [];
  const add = (severity, rule, message, fix) => out.push({ severity, rule, page: pagePath, message, fix });

  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  if (!title) add('error', 'title-missing', 'No <title>.', 'Give the page a title in its meta model.');
  else if (title.length > 60) add('notice', 'title-long', `Title is ${title.length} chars.`, 'Keep titles at or under 60 characters.');

  const descTag = /<meta[^>]+name\s*=\s*"description"[^>]*>/i.exec(html)?.[0];
  const description = descTag ? attr(descTag, 'content') : null;
  if (!description) add('error', 'description-missing', 'No meta description.', 'Set a description on the page meta.');
  else if (description.length > 160) add('notice', 'description-long', `Description is ${description.length} chars.`, 'Trim to 160 characters or fewer.');

  const h1s = html.match(/<h1[\s>]/gi) ?? [];
  if (h1s.length === 0) add('warning', 'h1-missing', 'No <h1>.', 'Every page needs exactly one h1.');
  if (h1s.length > 1) add('warning', 'h1-duplicate', `${h1s.length} <h1> elements.`, 'Keep exactly one h1 per page.');

  const noindex = /<meta[^>]+name\s*=\s*"robots"[^>]*content\s*=\s*"[^"]*noindex/i.test(html);
  if (!noindex && !/<link[^>]+rel\s*=\s*"canonical"/i.test(html)) {
    add('warning', 'canonical-missing', 'No canonical link.', 'Set seo.canonicalBase so canonical URLs can be emitted.');
  }
  if (!noindex && !/<meta[^>]+property\s*=\s*"og:title"/i.test(html)) {
    add('warning', 'og-missing', 'No Open Graph tags.', 'Include the head partial that emits og: tags.');
  }

  for (const tag of html.match(/<img[^>]*>/gi) ?? []) {
    const src = attr(tag, 'src');
    if (attr(tag, 'alt') === null) add('warning', 'img-alt-missing', `Image without alt: ${src ?? '(no src)'}`, 'Add descriptive alt text.');
    if (!src || /^(https?:|data:)/i.test(src)) continue;
    const clean = src.split(/[?#]/)[0].replace(/^\//, '');
    if (!clean || clean.split('/').some(part => part === '..') || !distFiles.has(clean)) {
      add('error', 'img-missing', `Image has no built file: ${src}`, 'Use a referenced asset id that resolves during build.');
    }
  }

  for (const tag of html.match(/<a\b[^>]*>/gi) ?? []) {
    const href = attr(tag, 'href');
    if (!href) continue;
    if (/^(javascript:|data:|vbscript:)/i.test(href)) {
      add('error', 'link-unsafe', `Unsafe link scheme: ${href.split(':')[0]}:`, 'Use an http or https URL.');
      continue;
    }
    if (/^(https?:|mailto:|tel:|#)/i.test(href)) continue;
    const clean = href.split(/[?#]/)[0];
    const target = clean.endsWith('/') ? posix.join(clean, 'index.html') : clean;
    const normalized = target.replace(/^\//, '');
    if (normalized && !distFiles.has(normalized)) {
      add('error', 'link-broken', `Internal link has no target: ${href}`, 'Fix the href or add the page.');
    }
  }

  const bytes = Buffer.byteLength(html);
  if (bytes > PAGE_BYTE_BUDGET) {
    add('warning', 'page-heavy', `Page HTML is ${(bytes / 1024).toFixed(0)} KB.`, 'Move large inline content into assets.');
  }

  return out;
}

export function auditDist(distDir) {
  if (!existsSync(distDir)) {
    return { score: 0, findings: [{ severity: 'error', rule: 'no-build', page: '', message: 'No dist/ directory. Run build first.', fix: 'Run site-builder build.' }], pages: 0 };
  }

  if (lstatSync(distDir).isSymbolicLink()) {
    return { score: 0, findings: [{ severity: 'error', rule: 'symlink-found', page: '', message: 'dist/ is a symbolic link.', fix: 'Rebuild into a real local dist/ directory.' }], pages: 0, warnings: 1 };
  }

  const walked = walk(distDir);
  const files = walked.files;
  const distFiles = new Set(files.map(file => relative(distDir, file).replaceAll('\\', '/')));
  const htmlFiles = files.filter(file => file.endsWith('.html'));

  const all = [];
  for (const file of walked.symlinks) {
    const rel = relative(distDir, file).replaceAll('\\', '/');
    all.push({
      severity: 'error',
      rule: 'symlink-found',
      page: rel,
      message: 'Symbolic links are not valid website output.',
      fix: 'Remove the symbolic link and rebuild from referenced assets.',
    });
  }
  for (const file of htmlFiles) {
    const pagePath = relative(distDir, file).replaceAll('\\', '/');
    all.push(...findings(readFileSync(file, 'utf8'), pagePath, distFiles));
  }

  if (!distFiles.has('index.html')) {
    all.push({
      severity: 'error',
      rule: 'home-missing',
      page: '',
      message: 'The build has no index.html home page.',
      fix: 'Rebuild the site and restore the home template.',
    });
  }

  for (const file of files) {
    const rel = relative(distDir, file).replaceAll('\\', '/');
    const extension = extname(file).toLowerCase();
    if (IMAGE_EXTENSIONS.has(extension) && statSync(file).size > IMAGE_BYTE_BUDGET) {
      all.push({
        severity: 'warning',
        rule: 'image-heavy',
        page: rel,
        message: `Image is ${(statSync(file).size / 1024).toFixed(0)} KB.`,
        fix: 'Use a web-ready image under 1 MB.',
      });
    }
    const secrets = scanForSecrets(readFileSync(file).toString('utf8'), rel);
    for (const secret of secrets) {
      all.push({
        severity: 'error',
        rule: 'secret-found',
        page: rel,
        message: `Credential-shaped value found at line ${secret.line}: ${secret.kind}.`,
        fix: 'Remove the credential and rebuild before preview or publish.',
      });
    }
  }

  const home = join(distDir, 'index.html');
  if (existsSync(home) && !/application\/ld\+json/i.test(readFileSync(home, 'utf8'))) {
    all.push({
      severity: 'error',
      rule: 'structured-data-missing',
      page: 'index.html',
      message: 'No JSON-LD structured data on the home page.',
      fix: 'Include the head partial that emits the schema.org graph.',
    });
  }

  const penalty = all.reduce((sum, finding) => sum + (WEIGHTS[finding.severity] ?? 0), 0);
  return {
    score: Math.max(0, 100 - penalty),
    findings: all,
    pages: htmlFiles.length,
    warnings: all.filter(f => f.severity !== 'notice').length,
  };
}
