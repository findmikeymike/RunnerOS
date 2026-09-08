import type { AgentTaskModeDefinition } from '../types.ts'

type Recipe = Omit<AgentTaskModeDefinition, 'kind'> & { kind?: AgentTaskModeDefinition['kind'] }

function mode(recipe: Recipe): AgentTaskModeDefinition {
  return { kind: recipe.primarySkillSlugs.length > 1 ? 'bundle' : 'focus', ...recipe }
}

function context(preloadTopics: string[], retrieveOnDemandTopics: string[], maxPreloadChars = 8_000) {
  return { preloadTopics, retrieveOnDemandTopics, maxPreloadChars }
}

function adjacent(slug: string, when: string, expansion: 'same-session' | 'delegate' = 'same-session') {
  return { slug, when, expansion }
}

/**
 * Launch recipes for the twelve Tier 2 starters. Context preload entries are
 * actual document slugs; selected assets, records, and source guides stay in
 * bounded retrieval hints. Optional sources do not authorize external actions.
 */
export const TIER_TWO_TASK_MODES: Record<string, AgentTaskModeDefinition[]> = {
  'social-publisher': [
    mode({
      id: 'rollout', label: 'Plan Rollout',
      icon: 'calendar',
      description: 'Turn release-ready assets into a clear posting plan.',
      primarySkillSlugs: ['social-publishing'],
      context: context(['mission-brief', 'artist-release-horizon', 'artist-voice'], [
        'Selected campaign Release Kit items, readiness, ownership and checksums',
        'Target platforms, exact destination accounts and release timing; no publishing adapter needed just to plan',
        'Hand new content ideas to Content Genius when the rollout needs them',
      ]),
    }),
    mode({
      id: 'publish', label: 'Publish Approved Posts',
      icon: 'send',
      description: 'Check the exact posts and carry out your approved schedule.',
      primarySkillSlugs: ['social-publishing'],
      optionalSourceSlugs: ['trypost', 'postiz', 'printing-press-social'],
      context: context(['mission-brief'], [
        'Exact reviewed posting packet, selected ready Release Kit items and their checksums',
        'Approval, destination account verification and action receipts',
        'Resolve TryPost, then Postiz, then native according to the publishing policy; load only the selected route and never switch after a write begins',
      ], 5_000),
    }),
    mode({
      id: 'engagement', label: 'Replies & DMs',
      icon: 'message-circle',
      description: 'Respond to the right conversations in your voice.',
      primarySkillSlugs: ['social-publishing'],
      requiredSourceSlugs: ['printing-press-social'],
      context: context(['artist-voice'], [
        'The social-publishing engagement playbook and exact owned inbox or thread',
        'Selected account identity, relationship facts and exact approval or active bounded engagement mandate',
        'Hand sensitive correspondence to the communications specialist when needed',
      ], 5_000),
    }),
    mode({
      id: 'growth', label: 'Instagram Growth',
      icon: 'chart-no-axes-combined',
      description: 'See what changed and what deserves your attention.',
      primarySkillSlugs: ['instagram-growth-snapshot'],
      requiredSourceSlugs: ['printing-press-social'],
      context: context(['artist-instagram-snapshot'], [
        'Dated 14-day Insights and the prior comparable snapshot',
        'The selected ready Instagram profile; retain the read-only first-ready-profile rule and show freshness',
      ], 6_000),
    }),
  ],
  'hypermotion-agent': [
    mode({
      id: 'motion', label: 'Motion Visuals',
      icon: 'sparkles',
      description: 'Create animated promos, titles, and visual moments.',
      primarySkillSlugs: ['hyperframes'], requiredSourceSlugs: ['hypermotion'],
      context: context(['artist-branding', 'mission-brief'], [
        'Selected visual brief, real source assets, dimensions, duration and requested preview or render',
      ]),
      adjacentSkills: [adjacent('spotify-canvas-video', 'Use when the user also requests a silent Spotify song loop.')],
    }),
    mode({
      id: 'canvas', label: 'Spotify Canvas',
      icon: 'repeat',
      description: 'Make a seamless silent loop for your song.',
      primarySkillSlugs: ['spotify-canvas-video'],
      optionalSourceSlugs: ['hypermotion', 'media-generation'],
      context: context(['artist-branding'], [
        'Selected song visual direction and artwork or footage; silent vertical 3–8 second loop constraints',
        'Use Hypermotion for designed motion; load media-generation only for requested generation',
        'If native generation lacks the capability, use Anything Agent for Monid-first discovery; Zero only by explicit choice or confirmed capability absence',
      ], 6_000),
      adjacentSkills: [adjacent('hyperframes', 'Use when this loop needs designed motion rather than supplied footage.')],
    }),
    mode({
      id: 'full', label: 'Motion Package',
      icon: 'layers',
      description: 'Develop matching motion assets and a song loop.',
      primarySkillSlugs: ['hyperframes', 'spotify-canvas-video'], fullMode: true,
      requiredSourceSlugs: ['hypermotion'], optionalSourceSlugs: ['media-generation'],
      context: context(['artist-branding', 'mission-brief', 'campaign-worker-context'], [
        'Shared visual direction, selected reusable assets and explicitly requested motion and Canvas deliverables',
        'Generation provider only when the approved production brief requires it',
      ], 12_000),
    }),
  ],
  'lyric-video-agent': [
    mode({
      id: 'lyric-clip', label: 'Lyric Clip',
      icon: 'mic',
      description: 'Turn your song, approved lyrics, and visuals into one clip.',
      primarySkillSlugs: ['lyric-video-genesis'], requiredSourceSlugs: ['genesis-lyric'],
      optionalSourceSlugs: ['lyrics-transcriber', 'media-generation'],
      context: context(['mission-brief', 'artist-branding'], [
        'Selected audio for this run, otherwise the current mission-assets Master; approved Vault lyrics and timed lines',
        'Selected visual source and one clip brief; use lyrics-transcriber only when lyrics or timings are missing',
        'Storyboard, preflight blockers and explicit render approval; preserve canonical lyrics',
      ]),
    }),
    mode({
      id: 'canvas', label: 'Silent Song Loop',
      icon: 'repeat',
      helpText: 'For a looping song visual without lyrics or captions.',
      description: 'Plan a Spotify Canvas visual for the motion or editing specialist.',
      primarySkillSlugs: ['spotify-canvas-video'],
      context: context(['artist-branding'], [
        'Selected song artwork or footage and silent loop brief; no lyric timing or transcription context',
        'Hand production to Hypermotion for motion or the video editor for supplied footage',
      ], 6_000),
    }),
  ],
  'content-genius': [
    mode({
      id: 'ideas', label: 'Ideas & Scripts',
      icon: 'lightbulb',
      description: 'Find a strong angle and shape the scene.',
      primarySkillSlugs: ['contentgenuis'],
      context: context(['artist-profile', 'artist-voice', 'mission-brief'], [
        'Selected audience, content pillar, rough idea and reference; relevant campaign intent',
      ]),
      adjacentSkills: [adjacent('captions-and-overlays', 'Use only after the idea or scene is locked.')],
    }),
    mode({
      id: 'captions', label: 'Captions & Overlays',
      icon: 'captions',
      description: 'Finish a locked idea with words that earn attention.',
      primarySkillSlugs: ['captions-and-overlays'],
      context: context(['artist-voice'], [
        'Exact approved concept, script or clip notes, its honest payoff and selected platform',
      ], 5_000),
      adjacentSkills: [adjacent('contentgenuis', 'Use when the supplied concept is not yet strong enough to finish.')],
    }),
    mode({
      id: 'full', label: 'Complete Post Concept',
      icon: 'layers',
      description: 'Develop the idea, then finish its captions and overlays.',
      primarySkillSlugs: ['contentgenuis', 'captions-and-overlays'], fullMode: true,
      context: context(['artist-profile', 'artist-voice', 'artist-branding', 'mission-brief'], [
        'Selected content brief, audience and references, then the chosen concept',
        'Hand approved words to the appropriate editor or Social Publisher; this package does not edit or publish video',
      ], 10_000),
    }),
  ],
  'outreach-agent': [
    mode({
      id: 'contacts', label: 'Find a Contact',
      icon: 'search',
      description: 'Find a credible contact route and research the fit.',
      primarySkillSlugs: ['monid'], optionalSourceSlugs: ['monid'],
      context: context([], [
        'The exact named person, company or LinkedIn URL and a targeted Artist Network lookup; never preload the full contact library',
        'Use the saved email when available; inspect Monid hunterio /email-finder only when contact lookup is needed',
        'Person and organization evidence, source confidence and lookup caveats',
      ], 3_000),
      adjacentSkills: [adjacent('zero', 'Only when the user explicitly selects Zero or focused Monid discovery confirms capability absence; never for balance, connection, outage or budget problems.')],
    }),
    mode({
      id: 'cold-message', label: 'Cold Introduction',
      icon: 'send',
      description: 'Write a personal first message worth answering.',
      primarySkillSlugs: ['magnetic-outreach'],
      context: context(['artist-voice'], [
        'Already gathered target research, exact cold first-contact ask, sender identity and approved relevant artist facts',
      ], 5_000),
      adjacentSkills: [adjacent('artist-comms-strategist', 'Use instead when the contact is warm or the message is ordinary correspondence.')],
    }),
    mode({
      id: 'relationship-message', label: 'Warm Outreach',
      icon: 'message-circle',
      description: 'Write naturally to an existing contact or collaborator.',
      primarySkillSlugs: ['artist-comms-strategist'],
      context: context(['artist-profile', 'artist-voice'], [
        'Selected Artist Network person, relationship notes, current thread and exact ask; no broad contact inventory',
      ], 6_000),
    }),
    mode({
      id: 'send-follow-up', label: 'Send & Follow Up',
      icon: 'repeat',
      description: 'Prepare the exact message and verify approved delivery.',
      primarySkillSlugs: ['artist-comms-strategist'], optionalSourceSlugs: ['gmail'],
      context: context(['artist-voice'], [
        'Exact recipient, reviewed message, sender account, links, prior thread and current approval',
        'Selected College Radio packet records when provided; preserve station rules and return per-recipient receipts',
        'Use Gmail only when available and requested; otherwise keep a copy-ready packet without claiming delivery',
      ], 4_000),
    }),
  ],
  'x-editorial': [
    mode({
      id: 'post-thread', label: 'Post or Thread',
      icon: 'pencil-line',
      description: 'Develop one sharp idea in your own voice.',
      primarySkillSlugs: ['artist-x-editorial'],
      context: context(['artist-voice', 'artist-branding'], [
        'Selected topic, relevant worldview facts and bounded cited research',
        'Artist-wide X editorial history for collision checks; campaign context only when the topic fits',
      ], 7_000),
    }),
    mode({
      id: 'editorial-plan', label: 'Editorial Slate',
      icon: 'calendar',
      description: 'Build a balanced set of timely posts.',
      primarySkillSlugs: ['artist-x-editorial'],
      context: context(['artist-profile', 'artist-voice', 'artist-branding', 'artist-release-horizon'], [
        'Recent artist-wide X history, scheduled work, lane balance and fatigue',
        'Current cited research and the nearest or pinned campaign with honest timing',
      ], 10_000),
    }),
    mode({
      id: 'refine-voice', label: 'Refine the Voice',
      icon: 'audio-lines',
      description: 'Make an existing draft sound more like you.',
      primarySkillSlugs: ['artist-comms-strategist'],
      context: context(['artist-voice'], [
        'Exact supplied X draft, voice examples, audience and approved facts',
        'X editorial history for required collision checks; preserve the X length and no-publishing rules',
      ], 5_000),
      adjacentSkills: [adjacent('artist-x-editorial', 'Use when revision becomes a new thread or broader editorial slate.')],
    }),
  ],
  'college-radio-agent': [
    mode({
      id: 'match', label: 'Match Stations',
      icon: 'radio',
      description: 'Find stations that fit this release and verify their rules.',
      primarySkillSlugs: ['college-radio-matcher'],
      context: context(['artist-profile', 'mission-brief', 'campaign-worker-context'], [
        'Sound-alikes, clean or explicit status, release format, hometown and tour markets',
        'Bundled station directory and current public station, contact and submission-rule evidence',
      ]),
      adjacentSkills: [adjacent('college-radio-outreach', 'Use after the selected station matches and rules are verified.')],
    }),
    mode({
      id: 'outreach', label: 'Build Outreach',
      icon: 'send',
      description: 'Turn verified station matches into personal submissions.',
      primarySkillSlugs: ['college-radio-outreach'],
      context: context(['artist-voice', 'mission-brief'], [
        'Selected verified station records, rules, checked dates, release links and submission formats',
        'Recheck missing or stale facts only; hand email-ready packets to Outreach Agent when requested',
      ], 6_000),
    }),
    mode({
      id: 'full', label: 'Radio Campaign',
      icon: 'layers',
      description: 'Build a verified target list and a ready-to-review outreach packet.',
      primarySkillSlugs: ['college-radio-matcher', 'college-radio-outreach'], fullMode: true,
      context: context(['artist-profile', 'artist-voice', 'mission-brief', 'campaign-worker-context'], [
        'Bounded station directory matching, current verification and selected release links',
        'Station-specific pitch packet and follow-up plan; Outreach Agent owns approved email delivery',
      ], 12_000),
    }),
  ],
  'record-doctor': [
    mode({
      id: 'submission', label: 'Prepare Submission',
      icon: 'package',
      description: 'Package your song and questions for the producer review inbox.',
      primarySkillSlugs: ['record-doctor-handoff'],
      context: context(['artist-profile', 'mission-brief'], [
        'Selected song file or link, title, review goals, song-specific notes and relevant references',
        'Prepare a producer submission, not an invented audio diagnosis; keep private delivery configuration out of every visible surface',
      ], 6_000),
      adjacentSkills: [adjacent('artist-comms-strategist', 'Use when the producer note needs a clearer ask or more natural voice.')],
    }),
    mode({
      id: 'producer-note', label: 'Refine Producer Note',
      icon: 'pencil-line',
      description: 'Make your review request clear, specific, and personal.',
      primarySkillSlugs: ['artist-comms-strategist'],
      context: context(['artist-voice'], [
        'Exact existing submission draft, desired producer feedback and approved song facts',
        'Preserve the Record Doctor private-recipient rules; never expose delivery configuration or imply a review has happened',
      ], 4_000),
      adjacentSkills: [adjacent('record-doctor-handoff', 'Use when the revised note needs the full submission or private delivery process.')],
    }),
    mode({
      id: 'review-send', label: 'Review & Send',
      icon: 'send',
      description: 'Review the exact submission and approve its delivery.',
      primarySkillSlugs: ['record-doctor-handoff'], optionalSourceSlugs: ['gmail'],
      context: context([], [
        'Final submission packet, sender account, draft state and explicit approval of the private review route and exact message',
        'Keep the recipient address private; only a verified Gmail receipt proves a draft or send',
      ], 3_000),
    }),
  ],
  'open-slide-agent': [
    mode({
      id: 'new-deck', label: 'Build a Deck',
      icon: 'presentation',
      description: 'Turn your story into a clear, polished presentation.',
      primarySkillSlugs: ['open-slide-decks', 'slide-design-taste'], requiredSourceSlugs: ['open-slide'],
      context: context(['artist-branding'], [
        'Selected topic, audience, approved content, brand assets and requested deck length',
      ], 6_000),
    }),
    mode({
      id: 'refine-deck', label: 'Refine a Deck',
      icon: 'palette',
      description: 'Improve the selected slides while keeping the deck coherent.',
      primarySkillSlugs: ['slide-design-taste', 'open-slide-decks'], requiredSourceSlugs: ['open-slide'],
      context: context([], [
        'Selected existing deck and slide files, existing visual style, requested changes and current build',
      ], 3_000),
    }),
    mode({
      id: 'export', label: 'Export a Deck',
      icon: 'download',
      helpText: 'Choose HTML, PDF, or PNG from an existing deck.',
      description: 'Prepare the finished presentation for viewing or sharing.',
      primarySkillSlugs: ['open-slide-decks'], requiredSourceSlugs: ['open-slide'],
      context: context([], [
        'Exact existing deck or build, requested HTML, PDF or PNG format and export receipt',
      ], 2_000),
      adjacentSkills: [adjacent('slide-design-taste', 'Use only if export inspection reveals a slide that needs a visual edit.')],
    }),
  ],
  'spotify-playlist-creator': [
    mode({
      id: 'build', label: 'Build Artist Playlist',
      icon: 'list-music',
      description: 'Place your songs in a thoughtful musical neighborhood.',
      primarySkillSlugs: ['playlist-builder', 'spotify-playlist-curator'],
      optionalSourceSlugs: ['printing-press-social'],
      context: context(['artist-profile'], [
        'Real artist track IDs, theme, comparable artists and bounded discovered shortlist when needed',
        'Exact saved Spotify profile for discovery or approved creation; verify the final receipt before claiming a playlist exists',
      ], 6_000),
    }),
    mode({
      id: 'review', label: 'Review a Playlist',
      icon: 'list-checks',
      description: 'Improve the flow and artist-track placement of a real tracklist.',
      primarySkillSlugs: ['playlist-builder', 'spotify-playlist-curator'],
      optionalSourceSlugs: ['printing-press-social'],
      context: context([], [
        'Selected existing tracklist or playlist URL, real track IDs, artist tracks and reliable supplied musical data',
        'Return proposed changes; do not promise in-place playlist updates without a verified execution adapter',
      ], 3_000),
    }),
  ],
  'site-builder': [
    mode({
      id: 'new-site', label: 'Build New Site',
      icon: 'globe',
      description: 'Build a focused artist site from your real material.',
      primarySkillSlugs: ['artist-website-builder', 'artist-website-playbook'],
      context: context(['artist-profile', 'artist-voice', 'artist-branding'], [
        'Website manifest first; create only when mode is none and never duplicate an external site',
        'Selected approved Release Kit material, show dates and visitor goal',
      ], 10_000),
    }),
    mode({
      id: 'update-site', label: 'Update Existing Site',
      icon: 'pencil-line',
      description: 'Change the selected content, page, or design and preview it.',
      primarySkillSlugs: ['artist-website-builder'],
      context: context([], [
        'Website manifest, targeted existing content or templates, exact requested update and required artist facts',
        'Use the managed-site content and build tools; external sites and publishing go to Website Agent',
      ], 3_000),
      adjacentSkills: [adjacent('artist-website-playbook', 'Use when the requested update needs a decision about what the site should contain.')],
    }),
    mode({
      id: 'improve-site', label: 'Improve the Site',
      icon: 'sparkles',
      description: 'Find useful content and search improvements, then preview the changes.',
      primarySkillSlugs: ['artist-website-playbook', 'artist-website-builder'],
      context: context(['artist-profile'], [
        'Existing website manifest, current audit findings, visitor goal and only relevant artist material',
        'Build and preview verified improvements; Website Agent owns publishing',
      ], 5_000),
    }),
  ],
  'setup-concierge': [
    mode({
      id: 'connect', label: 'Connect an Account',
      icon: 'plug',
      description: 'Save the right connection securely and check that it works.',
      primarySkillSlugs: ['artist-os-guide'],
      context: context([], [
        'Exact selected service, current connection status, missing setup fields and its source guide',
        'Use encrypted save_secret and source_test when available; never place credentials in context or outputs',
      ], 2_000),
    }),
    mode({
      id: 'choose-tools', label: 'Choose Tools',
      icon: 'compass',
      description: 'Find the smallest set of connections for a specific job.',
      primarySkillSlugs: ['source-recipe'],
      context: context([], [
        'The exact capability goal and live active source catalog; curate a focused source bundle rather than claiming to create a new capability',
        'Use Monid as the default marketplace route; Zero needs explicit choice or confirmed Monid capability absence, never merely a connection or balance problem',
      ], 2_000),
    }),
    mode({
      id: 'app-help', label: 'App Help',
      icon: 'circle-help',
      description: 'Find the right place and the next useful step.',
      primarySkillSlugs: ['artist-os-guide'],
      context: context([], [
        'Current feature question and minimal relevant app state; load no source catalog or artist campaign context unless needed',
      ], 1_500),
    }),
  ],
}
