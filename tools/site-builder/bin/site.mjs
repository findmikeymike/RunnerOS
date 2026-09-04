#!/usr/bin/env node
import { createServer } from 'node:http';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildSite } from '../lib/render.mjs';
import { auditDist } from '../lib/audit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const toolRoot = resolve(here, '..');
const args = process.argv.slice(2);
const command = args.shift() ?? 'help';
const SAFE_TEMPLATE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function usage() {
  console.log(`runner-site

Commands:
  init <workspaceRoot> --name "Artist Name" [--template minimal]
  build <workspaceRoot> [--json]
  audit <workspaceRoot> [--json]
  serve <workspaceRoot> [--port 4321]
  pack  <workspaceRoot> [--out <file.zip>]

The website lives at <workspaceRoot>/website. Content is data in
content/site.json; dist/ is rendered output and is safe to delete.`);
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function flag(name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : true;
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

function workspaceRoot() {
  const raw = args.find(arg => !arg.startsWith('--'));
  if (!raw) fail('Missing <workspaceRoot>.');
  const root = isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
  if (!existsSync(root)) fail(`Workspace not found: ${root}`);
  return root;
}

const paths = (root) => ({
  website: join(root, 'website'),
  manifest: join(root, 'website', 'site.json'),
  content: join(root, 'website', 'content', 'site.json'),
  theme: join(root, 'website', 'theme', 'tokens.json'),
  templates: join(root, 'website', 'site'),
  assets: join(root, 'website', 'assets'),
  dist: join(root, 'website', 'dist'),
});

function readJson(path, label) {
  if (!existsSync(path)) fail(`${label} not found at ${path}. Run "init" first.`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function isInside(root, candidate) {
  const base = resolve(root);
  const target = resolve(candidate);
  return target === base || target.startsWith(`${base}${sep}`);
}

function assertManagedWebsite(root, website) {
  if (!isInside(root, website)) fail('Website path escapes the workspace.');
  if (existsSync(website) && lstatSync(website).isSymbolicLink()) {
    fail('website/ cannot be a symbolic link.');
  }
  if (existsSync(website) && !isInside(realpathSync(root), realpathSync(website))) {
    fail('website/ escapes the workspace.');
  }
}

function assertSafeManagedPath(root, path, label) {
  if (!isInside(root, path)) fail(`${label} escapes website/.`);
  let current = resolve(root);
  const parts = resolve(path).slice(current.length).split(sep).filter(Boolean);
  for (const part of parts) {
    current = join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) fail(`${label} cannot contain a symbolic link.`);
  }
  if (existsSync(path) && !isInside(realpathSync(root), realpathSync(path))) fail(`${label} escapes website/.`);
}

function assertNoSymlinks(dir, label) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const info = lstatSync(path);
    if (info.isSymbolicLink()) fail(`${label} contains a symbolic link.`);
    if (info.isDirectory()) assertNoSymlinks(path, label);
  }
}

// ---------------------------------------------------------------------------

function cmdInit() {
  const root = workspaceRoot();
  const name = flag('name');
  if (typeof name !== 'string') fail('Missing --name "Artist Name".');
  const templateName = typeof flag('template') === 'string' ? flag('template') : 'minimal';
  if (!SAFE_TEMPLATE_NAME.test(templateName)) fail(`Unknown template: ${templateName}`);
  const templatesRoot = realpathSync(join(toolRoot, 'templates'));
  const templateSource = resolve(templatesRoot, templateName);
  if (!isInside(templatesRoot, templateSource) || !existsSync(templateSource)) fail(`Unknown template: ${templateName}`);
  if (lstatSync(templateSource).isSymbolicLink() || !lstatSync(templateSource).isDirectory()) {
    fail(`Invalid template: ${templateName}`);
  }
  assertNoSymlinks(templateSource, `Template ${templateName}`);

  const p = paths(root);
  assertManagedWebsite(root, p.website);
  for (const [path, label] of [
    [p.manifest, 'website/site.json'],
    [p.content, 'website/content/site.json'],
    [p.theme, 'website/theme/tokens.json'],
    [p.templates, 'website/site'],
    [p.assets, 'website/assets'],
  ]) assertSafeManagedPath(p.website, path, label);
  if (existsSync(p.manifest) && !hasFlag('force')) {
    fail('A website already exists here. Pass --force to re-scaffold templates.');
  }
  if (existsSync(p.templates) && lstatSync(p.templates).isSymbolicLink()) {
    fail('website/site cannot be a symbolic link.');
  }

  mkdirSync(p.assets, { recursive: true });
  cpSync(templateSource, p.templates, { recursive: true });

  const at = new Date().toISOString();
  if (!existsSync(p.manifest)) {
    writeJson(p.manifest, {
      version: 1,
      mode: 'managed',
      urls: {},
      publishPolicy: { contentOnly: 'needs-you', design: 'needs-you', routines: {} },
      history: [],
      capture: { backend: 'none', formIds: ['newsletter'] },
      assets: [],
      createdAt: at,
      updatedAt: at,
    });
  }
  if (!existsSync(p.content)) {
    writeJson(p.content, {
      version: 1,
      artist: { name, bio: { short: '', long: '' } },
      releases: [], shows: [], videos: [], links: [], press: [], journal: [], pages: [],
      signup: {
        enabled: false,
        forms: [{
          id: 'newsletter',
          headline: 'Get the next one first',
          blurb: 'New music, shows, and the occasional something else. No spam.',
        }],
      },
      seo: { siteName: name, defaultDescription: `Official site of ${name}. Music, shows, and news.` },
    });
  }
  if (!existsSync(p.theme)) {
    writeJson(p.theme, {
      version: 1,
      colors: {
        background: '#0b0b0c', surface: '#141416', text: '#f4f4f5', muted: '#a1a1aa',
        accent: '#e4e4e7', accentText: '#0b0b0c', border: 'rgba(255,255,255,0.10)',
      },
      type: {
        displayFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
        bodyFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
        displayWeight: 700, scale: 1,
      },
      radius: 10, maxWidth: 960,
    });
  }

  console.log(JSON.stringify({ ok: true, website: p.website, template: templateName }, null, 2));
}

function runBuild(root) {
  const p = paths(root);
  assertManagedWebsite(root, p.website);
  for (const [path, label] of [
    [p.manifest, 'website/site.json'],
    [p.content, 'website/content/site.json'],
    [p.theme, 'website/theme/tokens.json'],
    [p.templates, 'website/site'],
    [p.assets, 'website/assets'],
    [p.dist, 'website/dist'],
  ]) assertSafeManagedPath(p.website, path, label);
  const manifest = readJson(p.manifest, 'site.json');
  const content = readJson(p.content, 'content/site.json');
  const theme = readJson(p.theme, 'theme/tokens.json');
  if (!existsSync(p.templates)) fail(`No templates at ${p.templates}. Run "init" first.`);
  return buildSite({
    content,
    manifest,
    theme,
    templatesDir: p.templates,
    assetsDir: p.assets,
    outDir: p.dist,
  });
}

function cmdBuild() {
  const root = workspaceRoot();
  let result;
  try {
    result = runBuild(root);
  } catch (error) {
    if (hasFlag('json')) {
      console.log(JSON.stringify({ ok: false, error: error.message }, null, 2));
      process.exit(1);
    }
    fail(error.message);
  }
  const audit = auditDist(paths(root).dist);
  const receipt = {
    ok: true,
    hash: result.hash,
    fileCount: result.fileCount,
    bytes: result.bytes,
    pages: result.pages,
    auditScore: audit.score,
    warnings: audit.warnings,
    dist: paths(root).dist,
  };
  if (hasFlag('json')) {
    console.log(JSON.stringify(receipt, null, 2));
    return;
  }
  console.log(`Built ${result.fileCount} files (${(result.bytes / 1024).toFixed(1)} KB)`);
  console.log(`Pages: ${result.pages.join(', ')}`);
  console.log(`Hash: ${result.hash.slice(0, 12)}  Audit: ${audit.score}/100 (${audit.warnings} to fix)`);
  console.log(`Output: ${receipt.dist}`);
}

function cmdAudit() {
  const root = workspaceRoot();
  const p = paths(root);
  if (existsSync(p.dist)) assertSafeManagedPath(p.website, p.dist, 'website/dist');
  const result = auditDist(p.dist);
  if (hasFlag('json')) {
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }
  console.log(`Audit: ${result.score}/100 across ${result.pages} pages`);
  for (const finding of result.findings) {
    console.log(`  [${finding.severity}] ${finding.page} ${finding.rule}: ${finding.message}`);
    console.log(`      fix: ${finding.fix}`);
  }
  if (result.findings.length === 0) console.log('  No findings.');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
};

function cmdServe() {
  const root = workspaceRoot();
  const dist = paths(root).dist;
  if (!existsSync(dist)) fail('No dist/. Run "build" first.');
  assertSafeManagedPath(paths(root).website, dist, 'website/dist');
  const distRoot = realpathSync(dist);
  const port = Number(flag('port', 4321)) || 4321;

  const server = createServer((req, res) => {
    let url;
    try {
      url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }
    // Contain every request inside dist/.
    const candidate = resolve(distRoot, `.${url}`);
    if (candidate !== distRoot && !candidate.startsWith(`${distRoot}${sep}`)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    let target = candidate;
    if (existsSync(target) && statSync(target).isDirectory()) target = join(target, 'index.html');
    if (!existsSync(target)) {
      const notFound = join(dist, '404.html');
      if (existsSync(notFound)) {
        res.writeHead(404, { 'content-type': MIME['.html'] }).end(readFileSync(notFound));
        return;
      }
      res.writeHead(404).end('Not found');
      return;
    }
    if (lstatSync(target).isSymbolicLink() || !realpathSync(target).startsWith(`${distRoot}${sep}`)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' });
    res.end(readFileSync(target));
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(JSON.stringify({ ok: true, url: `http://127.0.0.1:${port}/`, dist }, null, 2));
  });
}

function cmdPack() {
  const root = workspaceRoot();
  const dist = paths(root).dist;
  if (!existsSync(dist)) fail('No dist/. Run "build" first.');
  assertSafeManagedPath(paths(root).website, dist, 'website/dist');
  assertNoSymlinks(dist, 'website/dist');
  const out = typeof flag('out') === 'string'
    ? resolve(process.cwd(), flag('out'))
    : join(paths(root).website, 'site.zip');
  mkdirSync(dirname(out), { recursive: true });
  const result = spawnSync('zip', ['-r', '-q', out, '.'], { cwd: dist, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    fail('zip failed. Install zip or copy dist/ manually.');
  }
  console.log(JSON.stringify({ ok: true, zip: out, bytes: statSync(out).size }, null, 2));
}

function cmdDoctor() {
  const checks = [
    { name: 'node', ok: true, detail: process.version },
    { name: 'templates', ok: existsSync(join(toolRoot, 'templates', 'minimal')), detail: join(toolRoot, 'templates') },
    { name: 'zip (pack only)', ok: spawnSync('zip', ['-v'], { stdio: 'ignore' }).status === 0, detail: 'optional' },
  ];
  console.log(JSON.stringify({ ok: checks.every(c => c.name.includes('optional') || c.ok), checks }, null, 2));
}

switch (command) {
  case 'init': cmdInit(); break;
  case 'build': cmdBuild(); break;
  case 'audit': cmdAudit(); break;
  case 'serve': cmdServe(); break;
  case 'pack': cmdPack(); break;
  case 'doctor': cmdDoctor(); break;
  case 'help':
  case '--help':
  case '-h': usage(); break;
  default:
    usage();
    fail(`Unknown command: ${command}`);
}
