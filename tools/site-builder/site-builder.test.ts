import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { auditDist } from './lib/audit.mjs';
import { render } from './lib/template.mjs';
import { markdownish, scanForSecrets } from './lib/render.mjs';

const CLI = join(import.meta.dir, 'bin', 'site.mjs');

function run(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('node', [CLI, ...args], { encoding: 'utf8' });
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function seededWorkspace(mutate: (content: Record<string, unknown>) => void = () => {}): string {
  const root = mkdtempSync(join(tmpdir(), 'site-builder-'));
  run(['init', root, '--name', 'Vera Lane']);
  const contentPath = join(root, 'website', 'content', 'site.json');
  const content = JSON.parse(readFileSync(contentPath, 'utf8'));
  content.seo.canonicalBase = 'https://veralane.com';
  mutate(content);
  writeFileSync(contentPath, JSON.stringify(content, null, 2));
  return root;
}

function writeFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, 'utf8');
}

describe('template engine', () => {
  test('escapes interpolation and honors triple-brace raw output', () => {
    expect(render('{{a}}|{{{a}}}', { a: '<b>&' })).toBe('&lt;b&gt;&amp;|<b>&');
  });

  test('if/else picks the right branch for empty arrays and falsy values', () => {
    const tpl = '{{#if items}}HAS{{else}}NONE{{/if}}';
    expect(render(tpl, { items: [1] })).toBe('HAS');
    expect(render(tpl, { items: [] })).toBe('NONE');
    expect(render(tpl, {})).toBe('NONE');
  });

  test('each exposes this, fields, and @index', () => {
    expect(render('{{#each rows}}[{{@index}}:{{this.v}}]{{/each}}', { rows: [{ v: 'a' }, { v: 'b' }] }))
      .toBe('[0:a][1:b]');
  });

  test('nested blocks and partials resolve from the outer scope', () => {
    const out = render(
      '{{#each rows}}{{#if ok}}<{{v}}:{{> tag}}>{{else}}-{{/if}}{{/each}}',
      { rows: [{ ok: true, v: 1 }, { ok: false, v: 2 }], site: 'S' },
      { tag: '{{site}}' },
    );
    expect(out).toBe('<1:S>-');
  });

  test('unclosed blocks and unknown partials fail loudly', () => {
    expect(() => render('{{#if a}}x', {})).toThrow(/Unclosed/);
    expect(() => render('{{> nope}}', {})).toThrow(/Missing partial/);
  });
});

describe('secret scanning', () => {
  test('detects credential shapes with a line number', () => {
    const findings = scanForSecrets('ok\nkey re_AbCdEf0123456789XyZq here', 'index.html');
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(2);
    expect(findings[0].kind).toBe('Resend API key');
  });

  test('leaves ordinary copy alone', () => {
    expect(scanForSecrets('Pre-save the record at ffm.to/coldroom', 'index.html')).toHaveLength(0);
  });
});

describe('markdownish', () => {
  test('renders headings, emphasis, lists, and escapes raw html', () => {
    const html = markdownish('## Verse\n\nI **left** the *window*\n\n- one\n- two\n\n<script>x</script>');
    expect(html).toContain('<h3>Verse</h3>');
    expect(html).toContain('<strong>left</strong>');
    expect(html).toContain('<em>window</em>');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(html).not.toContain('<script>');
  });
});

describe('build', () => {
  test('renders a full site with SEO scaffolding and a clean audit', () => {
    const root = seededWorkspace((content: any) => {
      content.artist.tagline = 'Songs from a cold room.';
      content.artist.bio = { short: 'Quiet songs, loudly.', long: 'A songwriter from Duluth.' };
      content.releases = [{ id: 'r1', title: 'Cold Room', type: 'album', date: '2026-08-01', featured: true, links: { spotify: 'https://open.spotify.com/album/x' } }];
      content.shows = [
        { id: 's1', date: '2999-11-14', city: 'Minneapolis, MN', venue: '7th St Entry', ticketUrl: 'https://tickets.example.com/1' },
        { id: 's0', date: '2000-01-09', city: 'Duluth, MN', venue: 'Sacred Heart' },
      ];
      content.press = [{ id: 'p1', outlet: 'Pitchfork', quote: 'Refuses to raise its voice.', url: 'https://pitchfork.com/x' }];
      content.pages = [{ id: 'pg1', slug: 'lyrics-cold-room', title: 'Cold Room', kind: 'lyrics', body: '## Verse\n\nOpen **window**' }];
    });
    try {
      const built = run(['build', root, '--json']);
      expect(built.status).toBe(0);
      const receipt = JSON.parse(built.stdout);
      expect(receipt.ok).toBe(true);
      expect(receipt.auditScore).toBe(100);
      expect(receipt.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(receipt.pages).toContain('/');
      expect(receipt.pages).toContain('/press/');
      expect(receipt.pages).toContain('/lyrics-cold-room/');

      const dist = join(root, 'website', 'dist');
      const home = readFileSync(join(dist, 'index.html'), 'utf8');
      expect(home).toContain('<h1>Vera Lane</h1>');
      expect(home).toContain('application/ld+json');
      expect(home).toContain('"@type":"MusicAlbum"');
      expect(home).toContain('"@type":"Event"');
      expect(home).toContain('rel="canonical"');
      expect(home).toContain('og:title');
      // Upcoming shows render with tickets; past shows fall into the archive.
      expect(home).toContain('7th St Entry');
      expect(home).toContain('Past shows');

      const sitemap = readFileSync(join(dist, 'sitemap.xml'), 'utf8');
      expect(sitemap).toContain('https://veralane.com/');
      expect(sitemap).not.toContain('404');
      expect(readFileSync(join(dist, 'robots.txt'), 'utf8')).toContain('Sitemap:');
      expect(existsSync(join(dist, '404.html'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('the same content builds to the same hash, and a change moves it', () => {
    const root = seededWorkspace();
    try {
      const first = JSON.parse(run(['build', root, '--json']).stdout);
      const second = JSON.parse(run(['build', root, '--json']).stdout);
      expect(second.hash).toBe(first.hash);

      const contentPath = join(root, 'website', 'content', 'site.json');
      const content = JSON.parse(readFileSync(contentPath, 'utf8'));
      content.artist.tagline = 'New tagline';
      writeFileSync(contentPath, JSON.stringify(content, null, 2));

      expect(JSON.parse(run(['build', root, '--json']).stdout).hash).not.toBe(first.hash);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('refuses to build when a credential reaches a rendered page', () => {
    const root = seededWorkspace((content: any) => {
      content.artist.bio = { short: '', long: 'Booking key re_AbCdEf0123456789XyZq' };
    });
    try {
      const result = run(['build', root, '--json']);
      expect(result.status).toBe(1);
      const receipt = JSON.parse(result.stdout);
      expect(receipt.ok).toBe(false);
      expect(receipt.error).toContain('Resend API key');
      expect(receipt.error).toContain('index.html');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('init refuses to clobber an existing site without --force', () => {
    const root = seededWorkspace();
    try {
      const again = run(['init', root, '--name', 'Someone Else']);
      expect(again.status).toBe(1);
      expect(again.stderr).toContain('already exists');
      // The original content survives.
      expect(JSON.parse(readFileSync(join(root, 'website', 'content', 'site.json'), 'utf8')).artist.name)
        .toBe('Vera Lane');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('audit', () => {
  test('flags duplicate h1, missing alt text, and broken internal links', () => {
    const dist = mkdtempSync(join(tmpdir(), 'site-audit-'));
    try {
      writeFile(join(dist, 'index.html'), [
        '<html><head><title>T</title><meta name="description" content="d">',
        '<link rel="canonical" href="https://x.com/"><meta property="og:title" content="T"></head>',
        '<body><h1>A</h1><h1>B</h1><img src="/logo.png"><img src="/ok.png" alt="fine">',
        '<a href="/missing/">gone</a><a href="/sub/">here</a><a href="https://ext.com">ext</a>',
        '<script type="application/ld+json">{}</script></body></html>',
      ].join('\n'));
      writeFile(join(dist, 'sub', 'index.html'), [
        '<html><head><title>S</title><meta name="description" content="d">',
        '<link rel="canonical" href="https://x.com/sub/"><meta property="og:title" content="S"></head>',
        '<body><h1>S</h1></body></html>',
      ].join('\n'));

      const result = auditDist(dist);
      const rules = result.findings.map((finding: { rule: string }) => finding.rule);
      expect(rules).toContain('h1-duplicate');
      expect(rules).toContain('img-alt-missing');
      expect(rules).toContain('link-broken');
      // External links, valid directory links, and images with alt are not flagged.
      expect(result.findings.filter((f: { rule: string }) => f.rule === 'link-broken')).toHaveLength(1);
      expect(result.findings.filter((f: { rule: string }) => f.rule === 'img-alt-missing')).toHaveLength(1);
      expect(result.score).toBeLessThan(100);
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });

  test('reports a missing build instead of throwing', () => {
    const result = auditDist(join(tmpdir(), 'definitely-not-a-dist-dir'));
    expect(result.score).toBe(0);
    expect(result.findings[0].rule).toBe('no-build');
  });

  test('flags a home page with no structured data', () => {
    const dist = mkdtempSync(join(tmpdir(), 'site-audit-'));
    try {
      writeFile(join(dist, 'index.html'), '<html><head><title>T</title><meta name="description" content="d"><link rel="canonical" href="https://x.com/"><meta property="og:title" content="T"></head><body><h1>A</h1></body></html>');
      expect(auditDist(dist).findings.map((f: { rule: string }) => f.rule)).toContain('structured-data-missing');
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });
});
