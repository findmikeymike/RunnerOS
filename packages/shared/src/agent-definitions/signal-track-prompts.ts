const COLLECTOR = `Signals v2 execution contract:
When the host workflow explicitly supplies a Signals v2 request, its immutable track, mode, selected sources, evidence ledger, limits, and packet schema govern this run instead of the legacy weekly defaults below.
- Use only the supplied track configuration. Your World must not read Industry's subscriptions as its own or add music-business websites.
- For mode links, inspect only the supplied canonical video IDs, without a lookback restriction or channel expansion.
- For mode scan, follow the host's bounded selection of unseen videos; a covered newest upload does not forbid another selected unseen upload. Do not substitute your own coverage state.
- Prefer cached transcripts and retain timestamped evidence. A retrieved transcript, a useful finding, and a completed final report are different outcomes. Never claim unavailable or unread videos were examined.
- Follow the supplied source-packet schema and output title, not the legacy youtube-intel report format. The host owns validation, run identity, final coverage, and routing. Do not write artist-intel-state or broadcast context yourself.
- Extract interesting stories, observations, creative tensions, and ideas for Your World even when they have no music-business tactic. Distinguish evidence from your interpretation. Channel subscriptions do not establish artist beliefs.
- Existing provider budgets, paid-retrieval approvals, and read-only restrictions still apply. A v2 instruction is not permission to expand capabilities.
For all other tasks, retain the existing legacy behavior below.`;

const ANALYST = `Signals v2 execution contract:
When the host workflow explicitly supplies a Signals v2 request, follow its track, mode, final-result schema, and report structure instead of the legacy Industry headings and quotas below.
- Industry retains its music-business lens. Your World concerns the artist's passions, themes, culture, and message beyond the music industry; do not reject a finding simply because it is not music-business news or does not promote a release.
- Read only accessible current artist profile, Brain, and approved Branding relevant to this task. These help interpretation; do not invent identity when they are sparse. Research is inspiration, not approved artist truth.
- Separate evidence-backed discoveries from optional creative angles. Bold or contrasting angles must fit the evidence and task; do not manufacture controversy or assume the artist agrees with a source.
- Use source publication and underlying event dates when supplied. A report written today does not turn an older event into current news. Unknown dates remain unknown; retain evergreen usefulness.
- Follow the supplied no-change/partial/unavailable contract. Do not manufacture a report, recap, or idea solely to satisfy the legacy Markdown structure. The host validates and publishes the final result.
- Never create automatic production work, posts, messages, Brain changes, or worker context copies. Later workers retrieve relevant saved sections when useful.
For all other tasks, retain the existing legacy behavior below.`;

export function signalTrackPromptPrefix(slug: string): string {
  const instruction = slug === 'youtube-intelligence-agent' ? COLLECTOR
    : slug === 'signal-analyst-agent' ? ANALYST : '';
  return instruction ? `${instruction}\n\n` : '';
}

export function youtubeProviderPromptPrefix(slug: string): string {
  if (!['youtube-research-agent', 'youtube-intelligence-agent'].includes(slug)) return '';
  return `Current YouTube provider order:
Use verified cached evidence first, then the connected native YouTube route, then Monid. Zero is allowed only for an explicit user choice or confirmed Monid capability absence; connection, balance, budget, outage, and paid-run errors do not authorize switching. Read the bundled monid skill when marketplace tools are needed: metadata is pinned to apify /streamers/youtube-scraper and transcripts to apify /starvibe/youtube-video-transcript. Inspect current schemas, availability and prices; do not search the marketplace during routine Signals runs. Respect the user's existing per-call and weekly budgets. A Data API key provides metadata, not third-party caption download rights. Never retry an uncertain paid submission through another provider. For host-managed Signals requests, use the collector's supplied packets instead of independently repeating collection. Missing or unverified evidence is a visible limitation, never a reason to invent findings.

`;
}

/** Only exact previously shipped prompts qualify; user edits remain untouched. */
export function isPreviousSignalTrackPrompt(slug: string, existing: string, current: string, briefingSuffix: string): boolean {
  const prefix = signalTrackPromptPrefix(slug);
  const providerPrefix = youtubeProviderPromptPrefix(slug);
  const previousRouting = providerPrefix && current.startsWith(`${prefix}${providerPrefix}`)
    ? `${prefix}${current.slice(prefix.length + providerPrefix.length)}` : current;
  if (providerPrefix && previousRouting !== current && existing === previousRouting) return true;
  if (!prefix || !previousRouting.startsWith(prefix)) return false;
  const previous = previousRouting.slice(prefix.length);
  return existing === previous || (slug === 'signal-analyst-agent'
    && previous.endsWith(briefingSuffix)
    && existing === previous.slice(0, -briefingSuffix.length));
}
