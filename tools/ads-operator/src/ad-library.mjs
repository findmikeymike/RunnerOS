import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MUSIC_FORMAT_RULES = [
  ['performance-video', ['performance', 'live', 'stage', 'concert', 'session', 'singing', 'guitar', 'piano']],
  ['music-video-clip', ['video', 'official video', 'visualizer', 'clip', 'watch now']],
  ['lyric-or-song-moment', ['lyrics', 'lyric', 'verse', 'chorus', 'hook', 'sound', 'song']],
  ['playlist-or-streaming-push', ['playlist', 'spotify', 'apple music', 'stream', 'pre-save', 'save this']],
  ['tour-or-event', ['tour', 'show', 'tickets', 'tonight', 'live in']],
  ['merch-or-offer', ['merch', 'shop', 'drop', 'limited', 'bundle']],
  ['ugc', ['ugc', 'reaction', 'selfie', 'phone camera', 'creator', 'testimonial']],
];

const ANGLE_RULES = [
  ['identity', ['for fans of', 'if you like', 'made for', 'anthem', 'outsider', 'heartbreak', 'late night']],
  ['social-proof', ['viral', 'million', 'streams', 'sold out', 'featured', 'as seen', 'everyone']],
  ['new-release', ['out now', 'new single', 'new album', 'new song', 'just dropped']],
  ['direct-response', ['listen now', 'watch now', 'get tickets', 'pre-save', 'shop now', 'learn more']],
  ['story', ['wrote this', 'behind the song', 'about the time', 'this song is for']],
];

export function createAdLibraryPlan({ artist, competitors, keywords, countries, maxAds }) {
  const competitorList = parseList(competitors);
  const keywordList = parseList(keywords);
  const vehicleSeedTerms = [
    'indie artist new song',
    'unsigned artist',
    'viral song',
    'listen now music',
    'music video out now',
    'save this song',
    'playlist new music',
    'local show music',
    'for fans of',
  ];
  const countryList = parseList(countries || 'US');
  const missingInputs = [];
  if (!artist && competitorList.length === 0 && keywordList.length === 0) {
    missingInputs.push('artist, competitors, or keywords');
  }

  const searchTerms = unique([
    ...vehicleSeedTerms,
    ...competitorList,
    ...keywordList,
    artist,
  ].filter(Boolean));

  return {
    ok: true,
    schema: 'runneros.ads.ad_library_plan.v1',
    platform: 'meta',
    route: 'browser-tiktok-discovery-meta-validation',
    readOnly: true,
    loginRequired: false,
    actionable: missingInputs.length === 0,
    missingInputs,
    maxAds: Number(maxAds) || 30,
    searchTerms,
    countries: countryList,
    startUrl: 'https://www.facebook.com/ads/library',
    discoveryUrls: [
      'https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en',
      'https://ads.tiktok.com/business/creativecenter/inspiration/popular/music/pc/en',
      'https://www.facebook.com/ads/library',
    ],
    browserSteps: [
      'Do not treat Meta Ad Library as a popularity-ranked search engine. Normal US commercial music ads do not expose CTR, CPA, ROAS, exact reach, or exact spend.',
      'Do not start with generic web search or DuckDuckGo. Open the discoveryUrls directly first; search engines can trigger automation challenges and stall the run.',
      'Start in TikTok Creative Center / Top Ads / trend pages in the browser. Search music, entertainment, creator, concert, streaming, playlist, app, and ecommerce examples for transferable hook/format mechanics.',
      'Capture visible hooks, formats, CTAs, engagement/performance-style signals shown by the page, landing pages, and why the vehicle could transfer to an artist campaign.',
      'Use public blogs, YouTube breakdowns, and case studies only when they show actual creative examples or specific formats.',
      'Then open Meta Ad Library in a normal browser context.',
      'Set ad category to All ads.',
      'Set country filter for each target country.',
      'Search the pages, artists, hooks, vehicles, and music-ad terms found during discovery, plus indie/emerging artist, playlist, local show, release, and fan-identity terms.',
      'Use similar artists only as secondary references. Skip huge artists quickly when they have no active ads or only big-budget/fame-dependent creative.',
      'Prefer active, repeatable, modest-budget-looking ads over celebrity-scale campaigns. The goal is hook/format/vehicle intel, not soundalike validation.',
      'Rank candidates strong/maybe/skip using proxies: public viral proof, active paid usage, longevity, repeatability, pattern repetition, and direct-response clarity.',
      'Prefer active ads and capture ad text, Page name, platforms, media type, CTA, destination URL, start date, and screenshot/video thumbnail when visible.',
      'Use longevity only as a weak proxy. Meta does not expose commercial ad performance in the public library.',
      'If TikTok, Meta, or a search engine blocks automation or shows a human challenge, stop that branch quickly. Return a partial packet with the block noted, or ask the user for screenshots/captured examples.',
      'Save captured examples to JSON, then run ad-library-analyze.',
    ],
    captureSchema: {
      ads: [{
        sourcePlatform: '<tiktok|meta|web|youtube>',
        pageName: '<advertiser or artist page>',
        searchTerm: '<term used>',
        adText: '<visible primary text>',
        headline: '<visible headline>',
        description: '<visible description>',
        cta: '<button text>',
        mediaType: '<video|image|carousel|unknown>',
        platforms: ['facebook', 'instagram'],
        startDate: '<visible start date if present>',
        destinationUrl: '<visible or copied destination URL>',
        screenshotPath: '<optional local screenshot path>',
        sourceUrl: '<optional Meta Ad Library URL>',
      }],
    },
    output: 'Ad Library Intel Packet',
    writeExecuted: false,
  };
}

export function analyzeAdLibraryFile(filePath, options = {}) {
  const absolute = resolve(process.cwd(), filePath);
  const parsed = JSON.parse(readFileSync(absolute, 'utf8'));
  const ads = normalizeAds(Array.isArray(parsed) ? parsed : parsed.ads);
  if (!ads.length) return { ok: false, error: 'Ad library input must contain an ads array.' };
  return analyzeAdLibraryAds(ads, { ...options, source: filePath });
}

export function analyzeAdLibraryAds(ads, { artist, source = null } = {}) {
  const normalizedAds = normalizeAds(ads);
  if (!normalizedAds.length) return { ok: false, error: 'No ad examples to analyze.' };

  const enriched = normalizedAds.map(enrichAd);
  const formats = countBy(enriched, 'format');
  const angles = countBy(enriched.flatMap((ad) => ad.angles));
  const ctas = countBy(enriched.map((ad) => ad.cta).filter(Boolean));
  const hooks = enriched
    .map((ad) => ad.hook)
    .filter(Boolean)
    .slice(0, 12);

  return {
    ok: true,
    schema: 'runneros.ads.ad_library_intel.v1',
    platform: 'meta',
    artist: artist || null,
    source,
    rowCount: enriched.length,
    confidence: {
      performanceData: 'none',
      workingSignal: 'weak longevity/recency proxy only',
      note: 'Public Meta Ad Library does not expose commercial ad CTR, CPA, ROAS, or spend for normal artist ads.',
    },
    patterns: {
      formats,
      angles,
      ctas,
      hooks,
    },
    competitiveGap: buildCompetitiveGap({ formats, angles, rowCount: enriched.length }),
    examples: enriched,
    recommendations: buildRecommendations({ formats, angles, hooks }),
    writeExecuted: false,
  };
}

function enrichAd(ad) {
  const text = [ad.adText, ad.headline, ad.description, ad.cta].filter(Boolean).join(' ');
  const lower = text.toLowerCase();
  const format = detectFormat(ad, lower);
  const angles = ANGLE_RULES
    .filter(([, tokens]) => tokens.some((token) => lower.includes(token)))
    .map(([name]) => name);
  const hook = firstSentence(ad.adText || ad.headline || ad.description || '');
  return {
    ...ad,
    hook,
    format,
    angles: angles.length ? angles : ['unclear'],
    creativeRead: creativeRead({ format, angles, text }),
  };
}

function detectFormat(ad, lower) {
  const mediaType = String(ad.mediaType || '').toLowerCase();
  if (mediaType.includes('carousel')) return 'carousel';
  for (const [format, tokens] of MUSIC_FORMAT_RULES) {
    if (tokens.some((token) => lower.includes(token))) return format;
  }
  if (mediaType.includes('video')) return 'video';
  if (mediaType.includes('image')) return 'static-image';
  return 'unknown';
}

function creativeRead({ format, angles, text }) {
  const length = text.length;
  const density = length <= 120 ? 'short' : length <= 300 ? 'medium' : 'long';
  return `${format}; ${angles.join(', ')} angle; ${density} copy.`;
}

function buildRecommendations({ formats, angles, hooks }) {
  const topFormat = Object.keys(formats)[0] || 'video';
  const topAngle = Object.keys(angles)[0] || 'identity';
  return [
    `Build at least one ${topFormat} variant because it appears most often in the captured set.`,
    `Test a ${topAngle} angle, but make the artist-specific twist original.`,
    hooks.length ? `Use the hook bank for pattern inspiration, not direct copying.` : 'Capture more ad text before final creative decisions.',
    'Pair this packet with artist context before Ads Agent drafts any campaign.',
  ];
}

function buildCompetitiveGap({ formats, angles, rowCount }) {
  const formatKeys = Object.keys(formats);
  const angleKeys = Object.keys(angles).filter((angle) => angle !== 'unclear');
  const crowdedFormats = formatKeys.filter((format) => formats[format] >= Math.max(2, Math.ceil(rowCount * 0.35)));
  const underusedFormats = ['ugc', 'performance-video', 'music-video-clip', 'lyric-or-song-moment', 'playlist-or-streaming-push', 'tour-or-event']
    .filter((format) => !formats[format]);
  const underusedAngles = ['identity', 'social-proof', 'new-release', 'direct-response', 'story']
    .filter((angle) => !angles[angle]);
  const diversityScore = Math.min(100, Math.round(((formatKeys.length + angleKeys.length) / Math.max(rowCount, 1)) * 50));

  return {
    diversityScore,
    diversityRead: diversityScore >= 70 ? 'wide' : diversityScore >= 40 ? 'moderate' : 'narrow',
    provenFormats: crowdedFormats,
    underusedFormats: underusedFormats.slice(0, 3),
    underusedAngles: underusedAngles.slice(0, 3),
    strategicRead: crowdedFormats.length
      ? 'Do not ignore repeated formats. Treat them as proven lanes, then make the artist-specific hook, visual world, and offer feel unmistakably original.'
      : 'No dominant repeated format appeared in the capture. Test several formats before committing budget.',
    optionalWhiteSpace: underusedFormats.length || underusedAngles.length
      ? 'Underused formats or angles are optional test lanes, not replacements for proven winners.'
      : 'The obvious whitespace is not format-based; differentiation should come from voice, visual world, targeting, or offer.',
  };
}

function normalizeAds(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter(Boolean)
    .map((ad) => ({
      sourcePlatform: text(ad.sourcePlatform || ad.platform || ad.source),
      pageName: text(ad.pageName),
      searchTerm: text(ad.searchTerm),
      adText: text(ad.adText || ad.primaryText || ad.body),
      headline: text(ad.headline || ad.title),
      description: text(ad.description),
      cta: text(ad.cta || ad.callToAction),
      mediaType: text(ad.mediaType || ad.format),
      platforms: Array.isArray(ad.platforms) ? ad.platforms.map(text).filter(Boolean) : [],
      startDate: text(ad.startDate || ad.startedRunning),
      destinationUrl: text(ad.destinationUrl || ad.url),
      screenshotPath: text(ad.screenshotPath),
      sourceUrl: text(ad.sourceUrl),
    }));
}

function countBy(values, key = null) {
  const counts = new Map();
  for (const value of values) {
    const item = key ? value?.[key] : value;
    if (!item) continue;
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function firstSentence(value) {
  return text(value).split(/(?<=[.!?])\s+/)[0]?.slice(0, 180) || '';
}

function parseList(value = '') {
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function unique(values) {
  return Array.from(new Set(values));
}

function text(value) {
  return value == null ? '' : String(value).trim();
}
