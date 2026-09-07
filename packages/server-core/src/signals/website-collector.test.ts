import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { collectSignalWebsite, SIGNAL_WEBSITE_LIMITS, SIGNAL_WEBSITE_SOURCES } from './website-collector.ts';

const now = '2026-09-07T12:00:00Z';
const fresh = '2026-09-06T09:00:00Z';
const old = '2026-08-20T09:00:00Z';
const rssUrl = SIGNAL_WEBSITE_SOURCES[4];
const htmlUrl = SIGNAL_WEBSITE_SOURCES[0];
function item(date: string, index = 1, body = '<p>A dated creator-tool update &amp; evidence.</p>') {
  return `<item><title>Update ${index}</title><link>https://www.musicbusinessworldwide.com/update-${index}/</link><pubDate>${date}</pubDate><description><![CDATA[${body}]]></description></item>`;
}
const rss = (items: string, extra = '') => `<?xml version="1.0"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>Music news</title><link>https://www.musicbusinessworldwide.com/</link><lastBuildDate>${now}</lastBuildDate>${extra}${items}</channel></rss>`;
function card(publishedAt: string, index = 1, body = 'A useful creator update.') {
  return `<article><h2><a href="/blog/update-${index}?utm_source=test">Update ${index}</a></h2><time datetime="${publishedAt}">${publishedAt}</time><p>${body}</p><script>stealSecrets()</script></article>`;
}
function transport(body: string, contentType = 'text/html', status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  return { calls, fetch: async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(body, { status, headers: { 'content-type': contentType } }); } };
}

describe('production Signal website collector with deterministic transport fixtures', () => {
  test('RSS quiet checked window can prove no-change, without fetching item links', async () => {
    const mock = transport(rss(item(old)), 'application/rss+xml');
    const packet = await collectSignalWebsite({ url: rssUrl, sinceDays: 7, now }, mock);
    expect(packet.status).toBe('checked');
    expect(packet.items).toEqual([]);
    expect(packet.windowStart).toBe('2026-08-31T12:00:00.000Z');
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.init.redirect).toBe('error');
  });
  test('fresh RSS item retains original article URL/date and parsed readable content', async () => {
    const fixture = rss(item(fresh) + item(old, 2));
    const packet = await collectSignalWebsite({ url: rssUrl, sinceDays: 7, now }, transport(fixture, 'application/rss+xml'));
    expect(packet.status).toBe('checked');
    expect(packet.items).toHaveLength(1);
    expect(packet.items[0]).toMatchObject({ url: 'https://www.musicbusinessworldwide.com/update-1/', publishedAt: '2026-09-06T09:00:00.000Z', text: 'A dated creator-tool update & evidence.', textKind: 'feed-content' });
    const rerun = await collectSignalWebsite({ url: rssUrl, sinceDays: 7, now }, transport(fixture, 'application/rss+xml'));
    expect(rerun.items[0]?.id).toBe(packet.items[0]?.id);
    expect(packet.items[0]?.id).toMatch(/^website-item:[a-f0-9]{24}$/);
  });
  test('Atom uses published date and alternate URL, never root update date', async () => {
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>News</title><updated>${now}</updated>
      <entry><title>Fresh</title><link rel="alternate" href="https://www.musicbusinessworldwide.com/fresh"/><published>${fresh}</published><updated>${now}</updated><summary type="html">&lt;p&gt;Readable &amp;amp; dated.&lt;/p&gt;</summary></entry>
      <entry><title>Old</title><link href="https://www.musicbusinessworldwide.com/old"/><published>${old}</published><summary>Old item.</summary></entry></feed>`;
    const packet = await collectSignalWebsite({ url: rssUrl, sinceDays: 7, now }, transport(atom, 'application/atom+xml'));
    expect(packet.status).toBe('checked');
    expect(packet.items[0]?.publishedAt).toBe('2026-09-06T09:00:00.000Z');
    expect(packet.items[0]?.text).toBe('Readable & dated.');
    const unknown = await collectSignalWebsite({ url: rssUrl, sinceDays: 7, now }, transport(atom.replace(`<published>${fresh}</published>`, ''), 'application/atom+xml'));
    expect(unknown.status).toBe('incomplete');
    expect(unknown.items).toHaveLength(0);
  });
  test('actual HTML article cards strip active markup and keep original dated item URLs', async () => {
    const mock = transport('<!doctype html><main>' + card(fresh) + card(old, 2) + '</main>');
    const packet = await collectSignalWebsite({ url: htmlUrl, sinceDays: 7, now }, mock);
    expect(packet.status).toBe('checked');
    expect(packet.items[0]?.url).toBe('https://artists.spotify.com/blog/update-1');
    expect(packet.items[0]?.text).toContain('A useful creator update.');
    expect(packet.items[0]?.text).not.toContain('stealSecrets');
    expect(packet.items[0]?.text).not.toContain('<');
    expect(mock.calls).toHaveLength(1);
  });
  test('HTML time-based cards and schema.org item arrays retain source publication dates', async () => {
    const list = '<ul>' + card(fresh).replaceAll('article', 'li') + card(old, 2).replaceAll('article', 'li') + '</ul>';
    expect((await collectSignalWebsite({ url: htmlUrl, sinceDays: 7, now }, transport(list))).status).toBe('checked');
    const graph = [fresh, old].map((datePublished, index) => ({ '@type': 'NewsArticle', headline: `Update ${index}`, url: `/news/${index}`, datePublished, description: '<p>Evidence from this article.</p>' }));
    const packet = await collectSignalWebsite({ url: htmlUrl, sinceDays: 7, now }, transport(`<script type="application/ld+json">${JSON.stringify(graph)}</script>`));
    expect(packet.status).toBe('checked');
    expect(packet.items).toHaveLength(1);
    expect(packet.items[0]?.url).toBe('https://artists.spotify.com/news/0');
  });
  test('ordinary HTML source origins use the readable dated-card adapter', async () => {
    for (const url of SIGNAL_WEBSITE_SOURCES.filter(url => !url.endsWith('/feed/') && url !== SIGNAL_WEBSITE_SOURCES[1])) {
      const packet = await collectSignalWebsite({ url, sinceDays: 7, now }, transport(card(fresh) + card(old, 2)));
      expect(packet.status).toBe('checked');
      expect(new URL(packet.items[0]!.url).origin).toBe(new URL(url).origin);
    }
  });
  test('production-shaped YouTube Help sections survive a large head without invented dates', async () => {
    const fixture = readFileSync(new URL('./fixtures/youtube-creator-updates.html', import.meta.url), 'utf8');
    const padded = fixture.replace('</head>', `<script>${' '.repeat(600_000)}</script></head>`);
    const mock = transport(padded);
    const packet = await collectSignalWebsite({ url: SIGNAL_WEBSITE_SOURCES[1], sinceDays: 7, now }, mock);
    expect(packet.status).toBe('incomplete');
    expect(packet.items).toHaveLength(2);
    expect(packet.truncated).toBe(false);
    expect(packet.items.map(item => item.title)).toEqual(['Test comment search:', 'Test practice session:']);
    expect(new Set(packet.items.map(item => item.id)).size).toBe(2);
    for (const item of packet.items) {
      expect(item.url).toBe(SIGNAL_WEBSITE_SOURCES[1]);
      expect(item.publishedAt).toBeUndefined();
      expect(item.publicationLabel).toContain('past 4 weeks');
      expect(item.text).toContain('exact publication date unavailable');
    }
    expect(mock.calls).toHaveLength(1);
    const plain = await collectSignalWebsite({ url: SIGNAL_WEBSITE_SOURCES[1], sinceDays: 7, now }, transport(fixture));
    expect(plain.items.map(item => item.id)).toEqual(packet.items.map(item => item.id));
    const classless = await collectSignalWebsite({ url: SIGNAL_WEBSITE_SOURCES[1], sinceDays: 7, now }, transport(fixture.replace('class="article-container"', '').replace('class="article-content-container"', '')));
    expect(classless.items).toEqual(plain.items);
    expect(classless.status).toBe('incomplete');
    const march = await collectSignalWebsite({ url: SIGNAL_WEBSITE_SOURCES[1], sinceDays: 7, now: '2026-03-15T12:00:00Z' }, transport(fixture));
    expect(march.items).toHaveLength(3);
    expect(march.items[2]?.publicationLabel).toContain('March 2026');
    expect(march.items[2]?.publishedAt).toBeUndefined();
    expect(march.status).toBe('incomplete');
  });
  test('YouTube Help missing dates, unknown layout and item/text/node bounds fail conservatively', async () => {
    const fixture = readFileSync(new URL('./fixtures/youtube-creator-updates.html', import.meta.url), 'utf8');
    const collect = (body: string) => collectSignalWebsite({ url: SIGNAL_WEBSITE_SOURCES[1], sinceDays: 7, now }, transport(body));
    expect((await collect(fixture.replace('Updates from the past 4 weeks', 'No date supplied'))).items[0]?.publicationLabel).not.toContain('past 4 weeks');
    expect((await collect(fixture.replace('Creator updates</h1>', 'Other help</h1>'))).status).toBe('unavailable');
    expect((await collect(fixture.replaceAll('<li>', '<div>').replaceAll('</li>', '</div>'))).status).toBe('incomplete');
    const many = fixture.replace('Test comment search:</strong>', 'Test comment search:</strong>' + 'x'.repeat(15_000));
    expect((await collect(many)).truncated).toBe(true);
    const overflow = fixture.replace('</head>', '<meta>'.repeat(SIGNAL_WEBSITE_LIMITS.nodes + 1) + '</head>');
    expect((await collect(overflow)).status).toBe('unavailable');
  });
  test('freshness boundary is inclusive and future/undated/unsorted listings stay incomplete', async () => {
    const atBoundary = item('2026-08-31T12:00:00Z') + item(old, 2);
    expect((await collectSignalWebsite({ url: rssUrl, sinceDays: 7, now }, transport(rss(atBoundary), 'application/rss+xml'))).items).toHaveLength(1);
    for (const fixture of [card('') + card(old, 2), card(old) + card(fresh, 2), card('2026-10-01') + card(old, 2), card('2026-02-31T00:00:00Z')]) {
      expect((await collectSignalWebsite({ url: htmlUrl, sinceDays: 7, now }, transport(fixture))).status).toBe('incomplete');
    }
  });
  test('unknown/inaccessible pages, invalid XML, declarations and non-public roots never prove quiet', async () => {
    for (const fixture of ['<html><h1>Verify you are human</h1></html>', '<html><footer><time datetime="2020-01-01">Copyright</time></footer></html>']) {
      expect((await collectSignalWebsite({ url: htmlUrl, sinceDays: 7, now }, transport(fixture))).status).toBe('unavailable');
    }
    for (const xml of ['<rss><channel></rss>', '<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss/>']) {
      expect((await collectSignalWebsite({ url: rssUrl, sinceDays: 7, now }, transport(xml, 'application/rss+xml'))).status).toBe('unavailable');
    }
    for (const url of ['http://127.0.0.1/feed/', 'https://localhost/', 'https://artists.spotify.com.evil/blog', 'https://artists.spotify.com/blog?extra=true']) {
      const mock = transport(rss(''));
      await expect(collectSignalWebsite({ url, sinceDays: 7, now }, mock)).rejects.toThrow();
      expect(mock.calls).toHaveLength(0);
    }
    const privateDns = await collectSignalWebsite({ url: htmlUrl, sinceDays: 7, now }, { resolve: async () => [{ address: '127.0.0.1', family: 4 }] });
    expect(privateDns.status).toBe('unavailable');
    expect(privateDns.message).toContain('non-public');
  });
  test('redirects, byte limits and body-stream limits fail closed', async () => {
    for (const status of [302, 403, 429, 500]) expect((await collectSignalWebsite({ url: htmlUrl, sinceDays: 7, now }, transport('', 'text/html', status))).status).toBe('unavailable');
    const huge = await collectSignalWebsite({ url: htmlUrl, sinceDays: 7, now }, transport('x'.repeat(SIGNAL_WEBSITE_LIMITS.bytes + 1)));
    expect(huge.status).toBe('unavailable');
    expect(huge.message).toContain('byte limit');
    const encoding = await collectSignalWebsite({ url: htmlUrl, sinceDays: 7, now }, transport('{}', 'application/json'));
    expect(encoding.status).toBe('unavailable');
  });
  test('item/text bounds retain only bounded evidence and never full coverage', async () => {
    const many = rss(Array.from({ length: 9 }, (_, index) => item(fresh, index)).join('') + item(old, 20));
    const packet = await collectSignalWebsite({ url: rssUrl, sinceDays: 7, now }, transport(many, 'application/rss+xml'));
    expect(packet.status).toBe('incomplete');
    expect(packet.truncated).toBe(true);
    expect(packet.items).toHaveLength(8);
    const long = await collectSignalWebsite({ url: rssUrl, sinceDays: 7, now }, transport(rss(item(fresh, 1, 'x'.repeat(15_000)) + item(old, 2)), 'application/rss+xml'));
    expect(long.status).toBe('incomplete');
    expect(long.items[0]?.text).toHaveLength(SIGNAL_WEBSITE_LIMITS.itemText);
  });
  test('empty dated feed is checked; continuation or missing freshness proof stays incomplete', async () => {
    expect((await collectSignalWebsite({ url: rssUrl, sinceDays: 7, now }, transport(rss(''), 'application/rss+xml'))).status).toBe('checked');
    for (const body of [rss('', '<atom:link rel="next" href="/feed/page/2"/>'), rss('').replace(`<lastBuildDate>${now}</lastBuildDate>`, ''), rss(item(fresh))]) {
      expect((await collectSignalWebsite({ url: rssUrl, sinceDays: 7, now }, transport(body, 'application/rss+xml'))).status).toBe('incomplete');
    }
  });
  test('collector deadline works even for stalled transport; cancellation remains explicit', async () => {
    const deadline = await collectSignalWebsite({ url: htmlUrl, sinceDays: 7, now }, { timeoutMs: 5, fetch: async () => new Promise<Response>(() => {}) });
    expect(deadline.status).toBe('unavailable');
    const abort = new AbortController();
    abort.abort(new Error('User cancelled'));
    await expect(collectSignalWebsite({ url: htmlUrl, sinceDays: 7, now, signal: abort.signal }, transport(card(fresh)))).rejects.toThrow('User cancelled');
  });
});
