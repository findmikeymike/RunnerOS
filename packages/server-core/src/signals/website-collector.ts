import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import sax from 'sax';
import type { LookupFunction } from 'node:net';
import { parse, parseFragment, type DefaultTreeAdapterTypes as Html } from 'parse5';

export const SIGNAL_WEBSITE_SOURCES = [
  'https://artists.spotify.com/blog', 'https://support.google.com/youtube/answer/9072033?hl=en',
  'https://newsroom.tiktok.com/en/', 'https://about.fb.com/news/tag/creators/',
  'https://www.musicbusinessworldwide.com/feed/', 'https://www.digitalmusicnews.com/feed/', 'https://www.hypebot.com/',
] as const;
export const SIGNAL_WEBSITE_LIMITS = { bytes: 2 * 1024 * 1024, candidates: 100, items: 8, itemText: 12_000, totalText: 48_000, timeoutMs: 30_000, nodes: 30_000 } as const;
export interface SignalWebsiteItem {
  id: string; url: string; title: string; publishedAt?: string; publicationLabel?: string; text: string;
  textKind: 'feed-content' | 'listing-excerpt';
}
export interface SignalWebsitePacket {
  version: 1; sourceUrl: string; checkedAt: string; windowStart: string; windowEnd: string;
  status: 'checked' | 'incomplete' | 'unavailable'; items: SignalWebsiteItem[];
  message?: string; truncated: boolean;
}
export interface SignalWebsiteCollectorDeps {
  /** Tests replace transport, not the collector/parser. Production pins validated DNS. */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  resolve?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
  timeoutMs?: number;
}
type Candidate = Omit<SignalWebsiteItem, 'id'> & { publishedAt: string };
type Extraction = { candidates: Candidate[]; contextual?: Omit<SignalWebsiteItem, 'id'>[]; invalid: number; hasNext: boolean; emptyAsOf?: string; recognized: boolean; limited?: boolean };

function safeItemUrl(value: string, root: string): string | null {
  try {
    const url = new URL(value, root);
    if (url.protocol !== 'https:' || url.origin !== new URL(root).origin || url.username || url.password || url.port) return null;
    for (const key of [...url.searchParams.keys()]) if (key.startsWith('utm_') || ['fbclid', 'gclid'].includes(key)) url.searchParams.delete(key);
    return url.href;
  } catch { return null; }
}
function date(value: string): string | null {
  const raw = value.trim();
  if (!raw || /^\d+$/.test(raw)) return null;
  const time = Date.parse(raw);
  if (!Number.isFinite(time)) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw) && new Date(raw.slice(0, 10) + 'T00:00:00Z').toISOString().slice(0, 10) !== raw.slice(0, 10)) return null;
  return new Date(time).toISOString();
}
function children(node: Html.Node): Html.ChildNode[] { return 'childNodes' in node ? node.childNodes : []; }
function elements(root: Html.Node): Html.Element[] {
  const result: Html.Element[] = [];
  const pending: Html.Node[] = [root];
  let count = 0;
  while (pending.length) {
    if (++count > SIGNAL_WEBSITE_LIMITS.nodes) throw new Error('Website structure exceeds supported size.');
    const node = pending.pop()!;
    if ('tagName' in node) result.push(node);
    pending.push(...children(node).toReversed());
  }
  return result;
}
function attr(node: Html.Element, name: string): string { return node.attrs.find(item => item.name === name)?.value ?? ''; }
function text(root: Html.Node): string {
  const parts: string[] = [];
  const pending: Html.Node[] = [root];
  let count = 0;
  while (pending.length) {
    if (++count > SIGNAL_WEBSITE_LIMITS.nodes) throw new Error('Website text exceeds supported size.');
    const node = pending.pop()!;
    if ('tagName' in node && ['script', 'style', 'noscript', 'nav', 'footer', 'svg', 'button'].includes(node.tagName)) continue;
    if (node.nodeName === '#text') parts.push((node as Html.TextNode).value);
    pending.push(...children(node).toReversed());
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
function readable(raw: string): string { return text(parseFragment(raw)); }

function youtubeHelpItems(nodes: Html.Element[], root: string, start: number, end: number): Extraction {
  const result: Extraction = { candidates: [], contextual: [], invalid: 1, hasNext: false, recognized: false };
  const article = nodes.find(node => node.tagName === 'section'
    && children(node).some(child => 'tagName' in child && child.tagName === 'h1' && text(child) === 'Creator updates'));
  if (!article) return result;
  const content = elements(article).find(node => attr(node, 'class').split(/\s+/).includes('article-content-container'))
    ?? children(article).find((child): child is Html.Element => 'tagName' in child && child.tagName === 'div');
  if (!content) return result;
  let section: string | undefined;
  let count = 0;
  for (const node of elements(content)) {
    if (node.tagName === 'h2') {
      const heading = text(node);
      section = undefined;
      if (heading === 'Latest YouTube updates') {
        result.recognized = true;
        section = 'Latest YouTube updates; exact publication date unavailable';
      } else if (/^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/.test(heading)) {
        result.recognized = true;
        const monthStart = Date.parse(`1 ${heading} 00:00:00 GMT`);
        const nextMonth = new Date(monthStart);
        nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
        if (monthStart <= end && nextMonth.getTime() > start) section = `${heading}; exact publication date unavailable`;
      }
    }
    if (section?.startsWith('Latest YouTube updates') && node.tagName === 'em' && text(node) === 'Updates from the past 4 weeks') {
      section = 'Latest YouTube updates: updates from the past 4 weeks (source label); exact publication date unavailable';
    }
    if (!section || node.tagName !== 'li') continue;
    if (++count > SIGNAL_WEBSITE_LIMITS.candidates) { result.limited = true; break; }
    const nested = elements(node);
    const heading = nested.find(child => child.tagName === 'strong' || child.tagName === 'b');
    if (!heading || !text(heading)) continue;
    const publicationLabel = section;
    // The update is published here, not at an unread "Learn more" destination.
    result.contextual!.push({ title: text(heading), url: root, publicationLabel,
      text: `Publication: ${publicationLabel}. ${text(node)}`, textKind: 'listing-excerpt' });
  }
  // Relative/month-only labels are usable context, never proof of this scan's date window.
  return result;
}

function htmlItems(body: string, root: string, start: number, end: number): Extraction {
  const document = parse(body);
  const nodes = elements(document);
  if (root === SIGNAL_WEBSITE_SOURCES[1]) return youtubeHelpItems(nodes, root, start, end);
  const result: Extraction = { candidates: [], invalid: 0, recognized: false, hasNext: nodes.some(node => attr(node, 'rel').split(/\s+/).includes('next') || (node.tagName === 'a' && /^(next|older posts|next page|load more)$/i.test(text(node)))) };
  function add(title: string, url: string, published: string, content: string) {
    result.recognized = true;
    if (result.candidates.length >= SIGNAL_WEBSITE_LIMITS.candidates) { result.limited = true; return; }
    const normalizedUrl = safeItemUrl(url, root);
    const publishedAt = date(published);
    const body = readable(content);
    if (!title.trim() || !normalizedUrl || !publishedAt || !body || (normalizedUrl === root && !new URL(normalizedUrl).hash)) { result.invalid++; return; }
    result.candidates.push({ title: readable(title), url: normalizedUrl, publishedAt, text: body, textKind: 'listing-excerpt' });
  }
  for (const script of nodes.filter(node => node.tagName === 'script' && attr(node, 'type') === 'application/ld+json')) {
    let data: unknown;
    try { data = JSON.parse(children(script).filter(node => node.nodeName === '#text').map(node => (node as Html.TextNode).value).join('')); }
    catch { result.invalid++; continue; }
    const pending: unknown[] = [data];
    let count = 0;
    while (pending.length) {
      if (++count > SIGNAL_WEBSITE_LIMITS.nodes) throw new Error('Structured source data exceeds supported size.');
      const value = pending.pop();
      if (!value || typeof value !== 'object') continue;
      if (Array.isArray(value)) { pending.push(...value.toReversed()); continue; }
      const item = value as Record<string, unknown>;
      const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
      if (types.some(type => ['NewsArticle', 'BlogPosting', 'Article'].includes(String(type)))) {
        const page = item.mainEntityOfPage;
        const url = typeof item.url === 'string' ? item.url : typeof page === 'string' ? page : page && typeof page === 'object' ? String((page as Record<string, unknown>)['@id'] ?? '') : '';
        add(String(item.headline ?? item.name ?? ''), url, String(item.datePublished ?? ''), String(item.articleBody ?? item.description ?? ''));
      }
      pending.push(...Object.values(item).filter(value => value && typeof value === 'object').toReversed());
    }
  }
  const cards = nodes.filter(node => node.tagName === 'article' || /(?:NewsArticle|BlogPosting)$/.test(attr(node, 'itemtype')));
  if (!cards.length) {
    for (const time of nodes.filter(node => node.tagName === 'time' || attr(node, 'itemprop') === 'datePublished')) {
      let parent: Html.Node | null | undefined = time.parentNode;
      for (let depth = 0; parent && depth < 4; depth++, parent = 'parentNode' in parent ? parent.parentNode : undefined) {
        if ('tagName' in parent && ['li', 'div', 'section'].includes(parent.tagName)
          && elements(parent).some(node => /^h[1-4]$/.test(node.tagName))) { if (!cards.includes(parent)) cards.push(parent); break; }
      }
    }
  }
  if (cards.length > SIGNAL_WEBSITE_LIMITS.candidates) result.limited = true;
  for (const card of cards.slice(0, SIGNAL_WEBSITE_LIMITS.candidates)) {
    const nested = elements(card);
    const heading = nested.find(node => /^h[1-4]$/.test(node.tagName));
    const anchor = heading ? elements(heading).find(node => node.tagName === 'a' && attr(node, 'href')) : undefined;
    const link = anchor ?? nested.find(node => node.tagName === 'a' && attr(node, 'href'));
    const time = nested.find(node => node.tagName === 'time' || attr(node, 'itemprop') === 'datePublished');
    // A source's dateModified is not its publication date.
    add(heading ? text(heading) : link ? text(link) : '', link ? attr(link, 'href') : '', time ? attr(time, 'datetime') || attr(time, 'content') || text(time) : '', text(card));
  }
  return result;
}

interface XmlNode { name: string; attrs: Record<string, string>; content: Array<XmlNode | string> }

function xmlItems(body: string, root: string): Extraction {
  // Reject declarations rather than supporting entities or any external resolution.
  if (body.toUpperCase().includes('<!DOCTYPE') || body.toUpperCase().includes('<!ENTITY')) throw new Error('XML declarations are not supported.');
  const parser = sax.parser(true, { xmlns: true });
  const stack: XmlNode[] = [];
  let document: XmlNode | undefined;
  let count = 0;
  parser.onopentag = tag => {
    if (++count > SIGNAL_WEBSITE_LIMITS.nodes || stack.length >= 64) throw new Error('Feed structure exceeds supported size.');
    if (!('local' in tag)) throw new Error('Feed namespace parsing is unavailable.');
    const node: XmlNode = { name: tag.local, attrs: Object.fromEntries(Object.values(tag.attributes).map(attribute => {
      if (typeof attribute === 'string') throw new Error('Feed namespace attribute parsing is unavailable.');
      return [attribute.local, attribute.value];
    })), content: [] };
    if (stack.length) stack.at(-1)!.content.push(node); else document = node;
    stack.push(node);
  };
  parser.onclosetag = () => { stack.pop(); };
  parser.ontext = parser.oncdata = value => { stack.at(-1)?.content.push(value); };
  parser.onerror = error => { throw error; };
  parser.ondoctype = () => { throw new Error('XML declarations are not supported.'); };
  parser.write(body).close();
  const localName = document?.name;
  if (!['rss', 'feed', 'RDF'].includes(localName ?? '')) throw new Error('Source did not return a supported feed.');
  const direct = (node: XmlNode, tag: string): XmlNode[] => node.content.filter((child): child is XmlNode => typeof child !== 'string' && child.name === tag);
  const xmlText = (node: XmlNode): string => ['script', 'style'].includes(node.name) ? '' : node.content.map(child => typeof child === 'string' ? child : xmlText(child)).join(' ');
  const value = (node: XmlNode, tag: string) => { const item = direct(node, tag)[0]; return item ? xmlText(item).trim() : ''; };
  const feed = localName === 'rss' ? direct(document!, 'channel')[0] : document;
  if (!feed) throw new Error('RSS channel is missing.');
  const entries = direct(feed, localName === 'feed' ? 'entry' : 'item');
  const hasNext = direct(feed, 'link').some(link => link.attrs.rel === 'next');
  const result: Extraction = { candidates: [], invalid: 0, hasNext, recognized: true, emptyAsOf: date(value(feed, 'lastBuildDate') || value(feed, 'updated')) ?? undefined };
  if (entries.length > SIGNAL_WEBSITE_LIMITS.candidates) result.limited = true;
  for (const item of entries.slice(0, SIGNAL_WEBSITE_LIMITS.candidates)) {
    const atomLink = direct(item, 'link').find(link => !link.attrs.rel || link.attrs.rel === 'alternate');
    const rawUrl = localName === 'feed' ? atomLink?.attrs.href ?? '' : value(item, 'link');
    const url = safeItemUrl(rawUrl, root);
    const publishedAt = date(value(item, 'pubDate') || value(item, 'published') || value(item, 'date'));
    const title = readable(value(item, 'title'));
    const content = readable(value(item, 'encoded') || value(item, 'content') || value(item, 'description') || value(item, 'summary'));
    if (!rawUrl || !url || !publishedAt || !title || !content) { result.invalid++; continue; }
    result.candidates.push({ title, url, publishedAt, text: content, textKind: 'feed-content' });
  }
  return result;
}

function publicAddress(address: string): boolean {
  if (address.includes(':')) return /^[23][0-9a-f]{0,3}:/i.test(address) && !address.toLowerCase().startsWith('2001:db8:');
  const [a, b, c] = address.split('.').map(Number);
  return a !== undefined && a > 0 && a < 224 && a !== 10 && a !== 127
    && !(a === 169 && b === 254) && !(a === 172 && b! >= 16 && b! <= 31)
    && !(a === 192 && (b === 168 || b === 0 || (b === 2)))
    && !(a === 100 && b! >= 64 && b! <= 127) && !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    && !(a === 203 && b === 0 && c === 113);
}
/** Preserve the validated address while honoring Node/Bun's two lookup callback contracts. */
export function createSignalWebsiteLookup(address: { address: string; family: number }): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [{ address: address.address, family: address.family }]);
    else callback(null, address.address, address.family);
  };
}
async function pinnedFetch(url: string, signal: AbortSignal, resolve: NonNullable<SignalWebsiteCollectorDeps['resolve']>): Promise<Response> {
  const target = new URL(url);
  const addresses = await resolve(target.hostname);
  if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new Error('Source resolved to a non-public address.');
  const address = addresses[0]!;
  return new Promise((resolveResponse, reject) => {
    const request = httpsRequest(target, {
      signal, family: address.family,
      lookup: createSignalWebsiteLookup(address),
      headers: { accept: 'text/html, application/rss+xml, application/atom+xml, application/xml', 'accept-encoding': 'identity', 'user-agent': 'ArtistOS-Signals/1.0' },
    }, response => {
      try {
        const headers = new Headers();
        for (const [key, value] of Object.entries(response.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        const status = response.statusCode ?? 502;
        if ([204, 205, 304].includes(status)) {
          response.destroy();
          resolveResponse(new Response(null, { status, headers }));
        } else {
          // Bridge Node's stream types to the host's DOM stream without a cross-library cast.
          const reader = Readable.toWeb(response).getReader();
          const body = new ReadableStream<Uint8Array>({
            async pull(controller) {
              try {
                const next = await reader.read();
                if (next.done) { controller.close(); reader.releaseLock(); }
                else if (next.value instanceof Uint8Array) controller.enqueue(next.value);
                else throw new Error('Source returned a non-byte stream chunk.');
              } catch (error) {
                controller.error(error);
                await reader.cancel(error).catch(() => {});
                reader.releaseLock();
              }
            },
            async cancel(reason) {
              try { await reader.cancel(reason); } finally { reader.releaseLock(); }
            },
          });
          resolveResponse(new Response(body, { status, headers }));
        }
      } catch (error) { response.destroy(); reject(error); }
    });
    request.on('error', reject);
    request.end();
  });
}
async function boundedBody(response: Response, signal: AbortSignal): Promise<string> {
  if (!response.ok || !response.body) { await response.body?.cancel().catch(() => {}); throw new Error('Source unavailable or redirected.'); }
  if (Number(response.headers.get('content-length')) > SIGNAL_WEBSITE_LIMITS.bytes) { await response.body.cancel().catch(() => {}); throw new Error('Source exceeds byte limit.'); }
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  const parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.length;
      if (bytes > SIGNAL_WEBSITE_LIMITS.bytes) throw new Error('Source exceeds byte limit.');
      parts.push(next.value);
    }
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); }
  return Buffer.concat(parts).toString('utf8');
}

/** Collect only a configured listing/feed; linked pages are never fetched. */
export async function collectSignalWebsite(input: { url: string; sinceDays: number; now: string; signal?: AbortSignal }, deps: SignalWebsiteCollectorDeps = {}): Promise<SignalWebsitePacket> {
  const end = Date.parse(input.now);
  if (!SIGNAL_WEBSITE_SOURCES.some(url => url === input.url)) throw new Error('Website is not a configured Signals source.');
  if (!Number.isFinite(end) || !Number.isInteger(input.sinceDays) || input.sinceDays < 1 || input.sinceDays > 14) throw new Error('Invalid website discovery window.');
  const start = end - input.sinceDays * 86_400_000;
  const packet: SignalWebsitePacket = { version: 1, sourceUrl: input.url, checkedAt: new Date().toISOString(), windowStart: new Date(start).toISOString(), windowEnd: new Date(end).toISOString(), status: 'unavailable', items: [], truncated: false };
  const timeout = AbortSignal.timeout(Math.min(deps.timeoutMs ?? SIGNAL_WEBSITE_LIMITS.timeoutMs, SIGNAL_WEBSITE_LIMITS.timeoutMs));
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
  try {
    signal.throwIfAborted();
    const operation = async () => {
      const response = deps.fetch ? await deps.fetch(input.url, { signal, redirect: 'error' }) : await pinnedFetch(input.url, signal, deps.resolve ?? (hostname => lookup(hostname, { all: true })));
      if (response.url && response.url !== input.url) { await response.body?.cancel().catch(() => {}); throw new Error('Source redirect refused.'); }
      const body = await boundedBody(response, signal);
      const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
      if (!body.trim()) throw new Error('Source returned no readable content.');
      const xml = ['application/rss+xml', 'application/atom+xml', 'application/xml', 'text/xml'].includes(contentType) || input.url.endsWith('/feed/');
      if (!xml && contentType && !['text/html', 'application/xhtml+xml'].includes(contentType)) throw new Error('Unsupported website content type.');
      const extracted = xml ? xmlItems(body, input.url) : htmlItems(body, input.url, start, end);
      if (!extracted.recognized) throw new Error('No dated article listing was recognized; access may be unavailable.');
      const unique = new Map<string, Candidate>();
      for (const item of extracted.candidates) {
        const previous = unique.get(item.url);
        if (previous && previous.publishedAt !== item.publishedAt) extracted.invalid++;
        if (!previous || item.text.length > previous.text.length) unique.set(item.url, item);
      }
      const all = [...unique.values()];
      const chronological = all.every((item, index) => index === 0 || Date.parse(all[index - 1]!.publishedAt) >= Date.parse(item.publishedAt));
      const pastBoundary = all.some(item => Date.parse(item.publishedAt) < start);
      const validEmpty = all.length === 0 && !extracted.hasNext && extracted.emptyAsOf && Date.parse(extracted.emptyAsOf) >= start && Date.parse(extracted.emptyAsOf) <= end;
      const future = all.some(item => Date.parse(item.publishedAt) > end);
      const recent: Omit<SignalWebsiteItem, 'id'>[] = all.filter(item => Date.parse(item.publishedAt) >= start && Date.parse(item.publishedAt) <= end).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.url.localeCompare(b.url));
      recent.push(...(extracted.contextual ?? []));
      let total = 0;
      packet.truncated = !!extracted.limited || all.length > SIGNAL_WEBSITE_LIMITS.candidates || recent.length > SIGNAL_WEBSITE_LIMITS.items;
      for (const item of recent.slice(0, SIGNAL_WEBSITE_LIMITS.items)) {
        const length = Math.min(item.text.length, SIGNAL_WEBSITE_LIMITS.itemText, SIGNAL_WEBSITE_LIMITS.totalText - total);
        if (length < item.text.length) packet.truncated = true;
        if (length <= 0) break;
        total += length;
        packet.items.push({ ...item, text: item.text.slice(0, length), id: 'website-item:' + createHash('sha256').update(JSON.stringify(item.publishedAt ? [input.url, item.url, item.publishedAt] : [input.url, item.url, item.title, item.publicationLabel])).digest('hex').slice(0, 24) });
      }
      packet.status = !packet.truncated && !extracted.invalid && !future && ((chronological && pastBoundary) || validEmpty) ? 'checked' : 'incomplete';
      if (packet.status !== 'checked') packet.message = extracted.contextual?.length
        ? 'Section updates retained as context; exact publication dates and complete scan-window coverage are unavailable.'
        : 'Readable listing evidence retained, but the complete date window is not proven (dates, ordering, continuation, or bounds).';
      return packet;
    };
    let abort: (() => void) | undefined;
    try {
      return await Promise.race([operation(), new Promise<never>((_resolve, reject) => { abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); })]);
    } finally { if (abort) signal.removeEventListener('abort', abort); }
  } catch (error) {
    if (input.signal?.aborted) throw input.signal.reason;
    packet.message = error instanceof Error ? error.message : 'Source collection timed out or failed.';
    return packet;
  }
}
