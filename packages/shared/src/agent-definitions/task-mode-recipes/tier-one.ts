import type { AgentTaskModeDefinition } from '../types.ts'

// Presentation belongs to the saved recipe; the renderer only supplies the icon glyph.
const PRESENTATION: Record<string, Pick<AgentTaskModeDefinition, 'icon' | 'helpText'>> = {
  'artist-counsel': { icon: 'compass' },
  'steve-jobs': { icon: 'lightbulb' },
  'mrbeast': { icon: 'video' },
  'tom-ford': { icon: 'palette' },
  'full-panel': { icon: 'users' },
  'create-video': { icon: 'video' },
  'spotify-canvas': { icon: 'repeat', helpText: 'A short, silent vertical loop that returns seamlessly to its first frame.' },
  'full-visual-campaign': { icon: 'layers' },
  'cover-art': { icon: 'image' },
  'merch-posters': { icon: 'shirt' },
  'visual-system': { icon: 'palette', helpText: 'Useful when covers, photos, posters, and merch need to feel like the same artist.' },
  'ad-artwork': { icon: 'megaphone' },
  'full-art-direction': { icon: 'layers' },
  'story-world': { icon: 'book-open' },
  'fan-experience': { icon: 'orbit' },
  'campaign-rollout': { icon: 'calendar' },
  'full-world': { icon: 'globe' },
  'delivery-metadata': { icon: 'package' },
  'rights-credits': { icon: 'shield-check' },
  'dsp-pitch': { icon: 'mic' },
  'final-release-check': { icon: 'file-check' },
  'full-release-readiness': { icon: 'clipboard-list' },
  'audience-market': { icon: 'users' },
  'budget-channels': { icon: 'coins' },
  'streaming-conversion': { icon: 'mouse-pointer-click' },
  'full-ad-strategy': { icon: 'target' },
  'ad-research': { icon: 'search' },
  'hooks-concepts': { icon: 'lightbulb' },
  'creative-package': { icon: 'megaphone' },
  'full-creative-system': { icon: 'layers' },
  'meta-ads': { icon: 'megaphone' },
  'google-ads': { icon: 'search' },
  'spotify-ads': { icon: 'audio-lines' },
  'reporting-audit': { icon: 'chart-no-axes-combined' },
  'cross-platform': { icon: 'globe' },
  'video-channel-research': { icon: 'search' },
  'viral-ideas': { icon: 'lightbulb' },
  'research-to-ideas': { icon: 'video' },
  'weekly-intelligence': { icon: 'calendar' },
  'video-deep-dive': { icon: 'scan-text' },
  'audience-research': { icon: 'users' },
  'content-strategy': { icon: 'map' },
  'full-intelligence': { icon: 'book-open' },
  'product-plan': { icon: 'shirt' },
  'artwork-placement': { icon: 'image' },
  'listing-copy': { icon: 'pencil-line' },
  'product-draft': { icon: 'package' },
  'full-product-launch': { icon: 'layers' },
  'edit-video': { icon: 'scissors' },
  'social-versions': { icon: 'repeat' },
  'edit-direction': { icon: 'sliders-horizontal', helpText: 'Useful when you want to agree on the edit before making cuts.' },
  'growth-review': { icon: 'chart-no-axes-combined' },
  'fresh-snapshot': { icon: 'refresh-cw', helpText: 'Uses your connected Spotify for Artists account.' },
  'check-changes': { icon: 'activity', helpText: 'Uses saved snapshots without fetching fresh Spotify data.' },
}

// Recipes narrow delivered context and active adapters; they never change access or approvals.
const identity = ['artist-profile', 'artist-voice', 'artist-branding']
const campaign = [...identity, 'mission-brief']
const release = ['artist-profile', 'mission-brief', 'campaign-worker-context']

type RecipeOptions = Pick<AgentTaskModeDefinition,
  'requiredSourceSlugs' | 'optionalSourceSlugs' | 'fullMode'> & {
  retrieve?: string[]
}

function mode(
  id: string, label: string, description: string, primarySkillSlugs: string[],
  preloadTopics: string[], options: RecipeOptions = {},
): AgentTaskModeDefinition {
  const { retrieve = [], ...rest } = options
  return {
    id, label, description,
    ...PRESENTATION[id],
    kind: primarySkillSlugs.length > 1 ? 'bundle' : 'focus',
    primarySkillSlugs,
    context: {
      preloadTopics: [...preloadTopics],
      ...(retrieve.length ? { retrieveOnDemandTopics: retrieve } : {}),
      maxPreloadChars: options.fullMode ? 12_000 : 8_000,
    },
    ...rest,
  }
}

/** Give every declared adjacent discipline a real activation boundary, never an eager read. */
function withAdjacency(
  modes: AgentTaskModeDefinition[], triggers: Record<string, string>,
): AgentTaskModeDefinition[] {
  return modes.map(recipe => {
    const adjacentSkills = Object.entries(triggers)
      .filter(([slug]) => !recipe.primarySkillSlugs.includes(slug))
      .map(([slug, when]) => ({ slug, when, expansion: 'same-session' as const }))
    return { ...recipe, ...(adjacentSkills.length ? { adjacentSkills } : {}) }
  })
}

const marketplace = {
  monid: 'Load only when the current task actually needs a fitting marketplace tool; inspect current schema, price, and availability before execution.',
  zero: 'Load only for an explicit Zero choice or a confirmed missing Monid capability. Connection, balance, budget, outage, failed calls, and uncertain paid submissions do not justify switching.',
}
const artSkills = ['artist-art-direction', 'artist-typography-taste', 'artist-visual-world-director', 'ad-creative']
const worldSkills = ['world-immersion', 'artist-narrative-universe', 'artist-campaign-angle-builder']
const releaseSkills = ['artist-os-release-operations', 'artist-os-rights-and-credits', 'artist-os-dsp-editorial-pitch', 'artist-os-release-package-qa']
const strategySkills = ['artist-ad-dna', 'ad-library-intel', 'ads-strategy', 'music-ad-conversion-protocol']
const creativeSkills = ['artist-ad-dna', 'ad-library-intel', 'music-ad-visual-hooks', 'ads-creative-development', 'ad-creative', 'artist-campaign-angle-builder']
const intelligenceSkills = ['youtube-intelligence', 'youtube-research', 'customer-research', 'content-strategy']
const printSkills = ['printify-commerce', 'print-product-assets', 'pod-product-strategy', 'pod-pricing-margin', 'pod-listing-copy']

export const TIER_ONE_TASK_MODES: Record<string, AgentTaskModeDefinition[]> = {
  'persona-agent': withAdjacency([
    mode('artist-counsel', 'Artist Counsel', 'Pressure-test identity, ambition, and creative choices through artist perspectives.', ['creative-oracle'], identity,
      { retrieve: ['Selected creative decision or artifact; the requested Cobain, Bowie, or Kanye reference'] }),
    mode('steve-jobs', 'Steve Jobs', 'Find the clearest idea and strongest priorities.', ['steve-jobs-perspective'], ['artist-profile'],
      { retrieve: ['Selected product, experience, launch, or decision and its actual constraints'] }),
    mode('mrbeast', 'MrBeast', 'Strengthen the concept, hook, and audience payoff.', ['mrbeast-perspective'], ['artist-profile', 'mission-brief'],
      { retrieve: ['Selected video, title, thumbnail, retention evidence, and intended audience'] }),
    mode('tom-ford', 'Tom Ford', 'Sharpen taste, restraint, polish, and execution.', ['tom-ford'], ['artist-profile', 'artist-branding'],
      { retrieve: ['Selected visual or experience and the relevant audience and quality standard'] }),
    mode('full-panel', 'Full Panel', 'Compare all four perspectives and resolve their disagreements in one deeper review.',
      ['creative-oracle', 'steve-jobs-perspective', 'mrbeast-perspective', 'tom-ford'], campaign, { fullMode: true }),
  ], {
    'creative-oracle': 'Use when authenticity, reinvention, or artistic ambition becomes the deciding question.',
    'steve-jobs-perspective': 'Use when product focus, simplicity, or launch priorities need a second lens.',
    'mrbeast-perspective': 'Use when the decision turns on video packaging, audience payoff, or retention.',
    'tom-ford': 'Use when restraint, visual taste, or execution standards need a second lens.',
  }),
  'video-director': withAdjacency([
    mode('create-video', 'Create a Video', 'Turn a video idea into a storyboard and production plan.', ['squad'], campaign,
      { requiredSourceSlugs: ['squad'], optionalSourceSlugs: ['media-generation', 'video-studio'], retrieve: ['Selected assets, platform, audience, runtime, and approved production budget; existing-footage editing belongs to Raw Video Editor'] }),
    mode('spotify-canvas', 'Spotify Canvas', 'Design a seamless visual loop for your track.', ['spotify-canvas-video'], ['artist-profile', 'artist-branding', 'mission-brief'],
      { optionalSourceSlugs: ['media-generation', 'video-studio', 'hypermotion'], retrieve: ['Exact track, visual references, and selected footage; hand designed motion to Hypermotion and footage cuts to Raw Video Editor'] }),
    mode('full-visual-campaign', 'Full Visual Campaign', 'Connect the main video, short promos, and Canvas in one complete visual plan.', ['squad', 'spotify-canvas-video'], campaign,
      { fullMode: true, requiredSourceSlugs: ['squad'], optionalSourceSlugs: ['media-generation', 'video-studio', 'hypermotion'], retrieve: ['Approved campaign assets, delivery formats, production timing, and budget'] }),
  ], {
    squad: 'Use when the selected Canvas needs storyboard-first generated footage or broader production.',
    'spotify-canvas-video': 'Use only when the requested video package also includes a Spotify Canvas loop.',
  }),
  'art-director': withAdjacency([
    mode('cover-art', 'Cover Art', 'Create a release cover with artwork, typography, and a coherent visual world.', artSkills.slice(0, 3), campaign,
      { optionalSourceSlugs: ['media-generation'], retrieve: ['Exact release title, lyrics, approved cover references, and Vault face reference if likeness is requested'] }),
    mode('merch-posters', 'Merch & Posters', 'Design print-ready graphics and poster layouts.', artSkills.slice(0, 2), ['artist-profile', 'artist-branding'],
      { optionalSourceSlugs: ['media-generation'], retrieve: ['Selected artwork, placement, dimensions, garment colors, and print constraints; product fulfillment belongs to Print Agent'] }),
    mode('visual-system', 'Visual System', 'Define a recognizable look across your artwork and formats.', ['artist-visual-world-director', 'artist-typography-taste'], identity,
      { retrieve: ['Approved moodboards, covers, styling, symbols, and relevant Vault references'] }),
    mode('ad-artwork', 'Ad Artwork', 'Turn an approved ad idea into artwork and supporting copy.', ['artist-art-direction', 'ad-creative'], campaign,
      { optionalSourceSlugs: ['media-generation'], retrieve: ['Approved ad concept, platform dimensions, destination, claims, and existing assets; broad ad concepts belong to Ad Creative'] }),
    mode('full-art-direction', 'Full Art Direction', 'Build a complete, coordinated set of release visuals.', artSkills, campaign,
      { fullMode: true, optionalSourceSlugs: ['media-generation'], retrieve: ['Selected release assets, reference images, deliverable formats, and existing typography'] }),
  ], {
    'artist-art-direction': 'Use when established visual rules need a concrete artwork concept or production brief.',
    'artist-typography-taste': 'Use when the selected artwork needs a type or deterministic layout pass.',
    'artist-visual-world-director': 'Use when inconsistencies require broader visual-world rules.',
    'ad-creative': 'Use when the chosen artwork also needs ad copy or platform-specific creative variants.',
    ...marketplace,
  }),
  'world-builder': withAdjacency([
    mode('story-world', 'Story World', 'Define the world and rules behind the music.', ['artist-narrative-universe'], campaign,
      { retrieve: ['Selected lyrics, demos, themes, and references'] }),
    mode('fan-experience', 'Fan Experience', 'Build one memorable experience fans can enter.', ['world-immersion'], campaign,
      { retrieve: ['Selected song world, audience size, artist willingness, budget, and release timing'] }),
    mode('campaign-rollout', 'Campaign Rollout', 'Turn your established world into release moments.', ['artist-campaign-angle-builder'], [...campaign, 'artist-release-horizon'],
      { retrieve: ['Established world summary, approved assets, channels, and release milestones; delegate content production and release logistics'] }),
    mode('full-world', 'Full World', 'Connect the story, fan experience, and rollout in one complete release world.', worldSkills, [...campaign, 'artist-release-horizon'], { fullMode: true }),
  ], {
    'artist-narrative-universe': 'Use when the song mythology or world rules are undefined.',
    'world-immersion': 'Use when the world needs one concrete experience fans can enter.',
    'artist-campaign-angle-builder': 'Use when the established world needs rollout touchpoints.',
  }),
  'artist-os-release-manager': withAdjacency([
    mode('delivery-metadata', 'Delivery & Metadata', 'Prepare distributor details, files, and pre-save handoffs.', [releaseSkills[0]!], release,
      { optionalSourceSlugs: ['google-drive', 'printing-press-social'], retrieve: ['Exact Release Kit delivery items, master, artwork, metadata, and relevant provider status'] }),
    mode('rights-credits', 'Rights & Credits', 'Organize contributors, ownership, splits, and clearances.', [releaseSkills[1]!], ['artist-profile', 'mission-brief'],
      { optionalSourceSlugs: ['google-drive'], retrieve: ['Exact contributors, composition and master ownership, samples, agreements, and clearance evidence; legal uncertainty belongs to Legal & Deals'] }),
    mode('dsp-pitch', 'DSP Pitch', 'Draft a factual editorial pitch for your release.', [releaseSkills[2]!], [...campaign, 'artist-release-horizon'],
      { retrieve: ['Approved song story, credits, release date, relevant audience evidence, and DSP form requirements'] }),
    mode('final-release-check', 'Final Release Check', 'Find the blockers before submission.', [releaseSkills[3]!], release,
      { optionalSourceSlugs: ['google-drive', 'printing-press-social'], retrieve: ['Current Release Kit, exact asset files, provider receipts, missing facts, and conflicting versions'] }),
    mode('full-release-readiness', 'Full Release Readiness', 'Review the whole release and prioritize what needs fixing.', releaseSkills, [...release, 'artist-release-horizon'],
      { fullMode: true, optionalSourceSlugs: ['google-drive', 'printing-press-social'], retrieve: ['Release Kit, Campaign Assets and Outputs, contributors, approved pitch, and provider receipts'] }),
  ], {
    'artist-os-release-operations': 'Use when the selected job needs distributor metadata, delivery preparation, or a pre-save handoff.',
    'artist-os-rights-and-credits': 'Use when contributors, ownership, splits, or clearance evidence block the current job.',
    'artist-os-dsp-editorial-pitch': 'Use when verified release facts need an editorial pitch.',
    'artist-os-release-package-qa': 'Use when a prepared package needs a final readiness check.',
  }),
  'ads-strategist': withAdjacency([
    mode('audience-market', 'Audience & Market', 'Find who this release fits and what comparable ads reveal.', strategySkills.slice(0, 2), [...campaign, 'artist-community'],
      { retrieve: ['Comparable artists, current public ad examples, and audience evidence'] }),
    mode('budget-channels', 'Budget & Channels', 'Choose channels, territories, budget, and tests.', ['ads-strategy'], release,
      { retrieve: ['Approved audience and creative summaries, actual budget, territories, timing, and previous campaign results'] }),
    mode('streaming-conversion', 'Streaming Conversion', 'Check the path from an ad click to meaningful listening.', ['music-ad-conversion-protocol'], ['artist-profile', 'mission-brief', 'artist-spotify-snapshot'],
      { retrieve: ['Exact smart link, pixel events, placements, territories, and dated streaming-quality evidence'] }),
    mode('full-ad-strategy', 'Full Ad Strategy', 'Build a complete paid campaign plan from audience through conversion.', strategySkills, [...campaign, 'artist-community', 'artist-spotify-snapshot'],
      { fullMode: true, retrieve: ['Actual budget, current public research, approved assets, and conversion evidence; creative belongs to Ad Creative and execution to Ad Runner'] }),
  ], {
    'artist-ad-dna': 'Use when audience psychology, proof assets, or artist boundaries remain undefined.',
    'ad-library-intel': 'Use when the decision needs current comparable-ad or format evidence.',
    'ads-strategy': 'Use when research findings need channel, budget, and testing decisions.',
    'music-ad-conversion-protocol': 'Use for Meta streaming campaigns when the conversion path or listening quality needs review.',
  }),
  'ad-creative-agent': withAdjacency([
    mode('ad-research', 'Ad Research', 'Find useful ad formats and evidence from comparable artists.', ['ad-library-intel'], ['artist-profile', 'mission-brief'],
      { retrieve: ['Comparable artists, platform, campaign goal, and current public ad examples'] }),
    mode('hooks-concepts', 'Hooks & Concepts', 'Develop song-native hooks and campaign concepts.', ['artist-ad-dna', 'music-ad-visual-hooks', 'artist-campaign-angle-builder'], campaign,
      { retrieve: ['Selected lyrics, sonic world, proof assets, voice, and audience response'] }),
    mode('creative-package', 'Creative Package', 'Build copy, formats, and distinct test variants ready for review.', ['ads-creative-development', 'ad-creative'], ['artist-profile', 'artist-voice', 'mission-brief'],
      { retrieve: ['Approved angles, actual assets, platform limits, claims, and performance evidence'] }),
    mode('full-creative-system', 'Full Creative System', 'Connect research, concepts, and a complete ad creative package.', creativeSkills, [...campaign, 'artist-community'],
      { fullMode: true, retrieve: ['Approved strategy, public research, selected assets, and test evidence; delegate production and account execution to their specialists'] }),
  ], {
    'artist-ad-dna': 'Use when the creative needs clearer audience psychology, artist voice, or brand boundaries.',
    'ad-library-intel': 'Use when a hook or format needs current comparable-ad evidence.',
    'music-ad-visual-hooks': 'Use when the visual opening needs to match the song mood, tempo, and use case.',
    'ads-creative-development': 'Use when approved concepts need a complete format and testing packet.',
    'ad-creative': 'Use when selected concepts need platform-ready copy or performance-led variations.',
    'artist-campaign-angle-builder': 'Use when ad concepts need a stronger connection to the release world.',
  }),
  'ads-agent': withAdjacency([
    mode('meta-ads', 'Meta Ads', 'Inspect, draft, and review Meta campaigns.', ['meta-ads', 'paid-ads-browser-operator'], ['artist-profile', 'mission-brief'],
      { requiredSourceSlugs: ['ads-operator'], optionalSourceSlugs: ['meta-ads'], retrieve: ['Exact saved Meta account, date range, approved strategy and creative, or supplied export'] }),
    mode('google-ads', 'Google Ads', 'Inspect, draft, and review Google campaigns.', ['google-ads', 'paid-ads-browser-operator'], ['artist-profile', 'mission-brief'],
      { requiredSourceSlugs: ['ads-operator'], optionalSourceSlugs: ['google-ads'], retrieve: ['Exact saved Google account, date range, approved strategy and creative, or supplied export'] }),
    mode('spotify-ads', 'Spotify Ads', 'Inspect, draft, and review Spotify campaigns.', ['spotify-ads-manager', 'paid-ads-browser-operator'], ['artist-profile', 'mission-brief', 'artist-spotify-snapshot'],
      { requiredSourceSlugs: ['ads-operator', 'printing-press-social'], retrieve: ['Exact saved Spotify account, reporting window, approved strategy, audio assets, and ad-set export'] }),
    mode('reporting-audit', 'Reporting & Audit', 'Audit campaign exports and identify useful next actions.', ['paid-ads-browser-operator'], ['artist-profile', 'mission-brief'],
      { requiredSourceSlugs: ['ads-operator'], retrieve: ['Exact supplied export, platform, account, date range, and goal; load the matching platform only for new account retrieval'] }),
    mode('cross-platform', 'Cross-Platform', 'Coordinate a complete review or approved campaign plan across ad platforms.', ['meta-ads', 'google-ads', 'spotify-ads-manager', 'paid-ads-browser-operator'], release,
      { fullMode: true, requiredSourceSlugs: ['ads-operator'], optionalSourceSlugs: ['meta-ads', 'google-ads', 'printing-press-social'], retrieve: ['Only the selected platforms and exact accounts, compatible reporting windows, approved strategy and creative'] }),
  ], {
    'meta-ads': 'Use only when the current work needs the Meta platform.',
    'google-ads': 'Use only when the current work needs the Google Ads platform.',
    'spotify-ads-manager': 'Use only when the current work needs Spotify Ads Manager.',
    'paid-ads-browser-operator': 'Use when the chosen account needs browser/export operation or an approval packet.',
    'music-ad-conversion-protocol': 'Use for a Meta streaming campaign conversion-path or listening-quality review.',
  }),
  'youtube-research-agent': withAdjacency([
    mode('video-channel-research', 'Video & Channel Research', 'Find videos, inspect channels, and examine transcripts or comments.', ['youtube-research'], ['artist-profile', 'mission-brief'],
      { optionalSourceSlugs: ['youtube-research'], retrieve: ['Exact query, channel, or video; relevant transcript and comment evidence only'] }),
    mode('viral-ideas', 'Viral Ideas', 'Turn existing evidence into stronger hooks and video ideas.', ['create-viral-content'], ['artist-profile', 'artist-voice', 'mission-brief'],
      { retrieve: ['Selected research findings, intended audience, and platform; retrieve new videos only if evidence is missing'] }),
    mode('research-to-ideas', 'Research to Ideas', 'Research the topic and develop a complete set of evidence-backed ideas.', ['youtube-research', 'create-viral-content'], campaign,
      { fullMode: true, optionalSourceSlugs: ['youtube-research'], retrieve: ['Bounded search scope and selected video evidence; production belongs to Content Genius and publishing to Social Publisher'] }),
  ], {
    'youtube-research': 'Use when an idea needs missing video, channel, transcript, or comment evidence.',
    'create-viral-content': 'Use when verified research needs original hooks or video ideas.',
    ...marketplace,
  }),
  'youtube-intelligence-agent': withAdjacency([
    mode('weekly-intelligence', 'Weekly Intelligence', 'Extract useful new lessons from your trusted channels.', ['youtube-intelligence'], ['artist-profile', 'artist-intel-config', 'artist-intel-state'],
      { requiredSourceSlugs: ['youtube-intelligence'], optionalSourceSlugs: ['youtube-research'], retrieve: ['Respect host-managed Signals selections; otherwise use the saved watchlist and newest-upload deduplication rules'] }),
    mode('video-deep-dive', 'Video Deep Dive', 'Turn one video into timestamped, reusable findings.', ['youtube-intelligence', 'youtube-research'], ['artist-profile', 'mission-brief'],
      { requiredSourceSlugs: ['youtube-intelligence'], optionalSourceSlugs: ['youtube-research'], retrieve: ['One selected video, transcript, and research question; do not scan the weekly watchlist'] }),
    mode('audience-research', 'Audience Research', 'Understand viewers’ language, questions, and motivations.', ['customer-research'], ['artist-profile', 'artist-community', 'mission-brief'],
      { retrieve: ['Selected comments, interviews, transcript excerpts, and provenance; request new retrieval only when evidence is missing'] }),
    mode('content-strategy', 'Content Strategy', 'Turn established evidence into content priorities.', ['content-strategy'], ['artist-profile', 'artist-voice', 'mission-brief', 'artist-intel-report'],
      { retrieve: ['Selected audience findings, prior content results, constraints, and available production capacity'] }),
    mode('full-intelligence', 'Full Intelligence', 'Connect source findings, audience insight, and a complete content plan.', intelligenceSkills, [...campaign, 'artist-community', 'artist-intel-report'],
      { fullMode: true, requiredSourceSlugs: ['youtube-intelligence'], optionalSourceSlugs: ['youtube-research'], retrieve: ['Selected sources and research scope; watchlist state only for an explicitly requested scan'] }),
  ], {
    'youtube-intelligence': 'Use when selected source material needs timestamped intelligence extraction.',
    'youtube-research': 'Use when missing metadata, comments, channels, or transcripts require retrieval.',
    'customer-research': 'Use when source findings need an audience-language or motivation analysis.',
    'content-strategy': 'Use when verified findings need a prioritized content plan.',
    ...marketplace,
  }),
  'print-agent': withAdjacency([
    mode('product-plan', 'Product Plan', 'Choose a viable product, variants, and price.', ['pod-product-strategy', 'pod-pricing-margin'], ['artist-profile', 'artist-branding', 'artist-community'],
      { retrieve: ['Selected artwork or product idea, real costs when known, shipping and fee assumptions, and audience'] }),
    // print-product-assets itself declares Printify as required; do not promise offline completeness.
    mode('artwork-placement', 'Artwork & Placement', 'Check artwork files and define print placement for your product.', ['print-product-assets'], ['artist-profile', 'artist-branding'],
      { requiredSourceSlugs: ['printify'], retrieve: ['Exact artwork files, product specification, dimensions, colorways, and placement'] }),
    mode('listing-copy', 'Listing Copy', 'Write accurate titles and product descriptions.', ['pod-listing-copy'], ['artist-profile', 'artist-voice'],
      { retrieve: ['Verified product details, material, price, placement, fulfillment facts, and current listing when updating'] }),
    mode('product-draft', 'Product Draft', 'Prepare artwork and create an unpublished product draft.', ['printify-commerce', 'print-product-assets'], ['artist-profile', 'artist-branding'],
      { requiredSourceSlugs: ['printify'], optionalSourceSlugs: ['shopify'], retrieve: ['Exact shop, accepted artwork, provider, product, variants, placement, and price; Shopify handoff only after its connection validates'] }),
    mode('full-product-launch', 'Full Product Launch', 'Build the complete product, artwork, pricing, and listing package.', printSkills, [...identity, 'artist-community', 'mission-brief'],
      { fullMode: true, requiredSourceSlugs: ['printify'], optionalSourceSlugs: ['shopify'], retrieve: ['Exact artwork and product selections, current costs, shop state, and destination; artwork repair belongs to Art Director'] }),
  ], {
    'printify-commerce': 'Use when the approved product plan needs catalog verification, uploads, or an unpublished Printify draft.',
    'print-product-assets': 'Use when exact artwork needs print-file or placement verification.',
    'pod-product-strategy': 'Use when the product, audience, or variant choices need a viable offer.',
    'pod-pricing-margin': 'Use when actual cost, shipping, or fee changes need a new margin calculation.',
    'pod-listing-copy': 'Use when verified product facts need listing copy.',
  }),
  'raw-video-editor': withAdjacency([
    mode('edit-video', 'Edit a Video', 'Shape existing footage into a finished video.', ['raw-video-edit-direction', 'raw-video-editor'], ['artist-profile', 'mission-brief'],
      { requiredSourceSlugs: ['raw-video-editor'], optionalSourceSlugs: ['video-studio'], retrieve: ['Exact selected footage, transcript, runtime, and edit goal; clean song master only for performance synchronization'] }),
    mode('social-versions', 'Social Versions', 'Create meaningfully different cuts for selected accounts.', ['social-video-repurposing'], campaign,
      { requiredSourceSlugs: ['raw-video-editor'], optionalSourceSlugs: ['video-studio'], retrieve: ['Exact selected source, rights and hash lineage, intended accounts, or saved Social Variant Set; publishing belongs to Social Publisher'] }),
    mode('edit-direction', 'Edit Direction', 'Choose the structure, pacing, moments, and audio treatment.', ['raw-video-edit-direction'], ['artist-profile', 'mission-brief'],
      { retrieve: ['Only selected footage or transcript, target runtime, must-keep moments, and audio requirements; do not render just to advise'] }),
  ], {
    'raw-video-editor': 'Use when the chosen editorial plan needs media inspection, master sync, technical planning, or rendering.',
    'raw-video-edit-direction': 'Use when a source requires a fresh editorial approach before cuts or audio decisions.',
    'social-video-repurposing': 'Use only when the user wants meaningfully different account-native versions of an approved source.',
  }),
  'spotify-analyst': withAdjacency([
    mode('growth-review', 'Growth Review', 'Interpret existing Spotify evidence and choose the next move.', ['spotify-growth-intake'], ['artist-profile', 'artist-spotify-snapshot', 'mission-brief'],
      { retrieve: ['Dated existing snapshots, briefs, alerts, release goals, and reporting windows; delegate playlist creation or campaign execution'] }),
    mode('fresh-snapshot', 'Fresh Snapshot', 'Capture fresh Spotify for Artists metrics.', ['spotify-analytics-snapshot'], ['artist-profile', 'artist-spotify-snapshot'],
      { requiredSourceSlugs: ['printing-press-social'], retrieve: ['Exact saved Spotify profile and live account identity, requested reporting window, and prior compatible snapshot'] }),
    mode('check-changes', 'Check Changes', 'Check saved snapshots for significant movement.', ['spotify-anomaly-watch'], ['artist-profile', 'artist-spotify-snapshot'],
      { retrieve: ['Existing dated snapshot files with compatible source and reporting windows; this mode does not scrape or require a live Spotify connection'] }),
  ], {
    'spotify-growth-intake': 'Use when observed changes need a growth decision or specialist handoff.',
    'spotify-analytics-snapshot': 'Use only when missing or stale evidence requires a fresh verified Spotify for Artists read.',
    'spotify-anomaly-watch': 'Use when saved compatible snapshots need a change or anomaly check; never scrape through this skill.',
  }),
}
