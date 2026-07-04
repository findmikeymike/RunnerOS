import type { Message } from '@craft-agent/core/types';
import { CONCIERGE_SLUG } from '../agent-definitions/types.ts';
import {
  SHARED_INTEL_CONTEXT_PREFIX,
  SHARED_INTEL_FENCE,
  SHARED_INTEL_PROMPT_HEADER,
  type BuildSharedIntelInput,
  type BuiltSharedIntelDoc,
  type ExistingSharedIntelDoc,
  type SharedIntelAgentCatalogEntry,
  type SharedIntelCandidate,
  type SharedIntelNote,
  type SharedIntelRouteReason,
} from './types.ts';

const MAX_NOTES_PER_SHARE = 3;
const MAX_TARGET_AGENTS = 5;
const RECENT_MESSAGE_LIMIT = 20;
const MAX_SUMMARY_CHARS = 520;
const MAX_PROMPT_SUMMARY_CHARS = 240;
const MAX_SHARED_INTEL_PROMPT_CHARS = 2600;
const MAX_EVIDENCE_CHARS = 260;
const GENERIC_MIN_CHARS = 80;

const STOPWORDS = new Set([
  'about',
  'after',
  'again',
  'agent',
  'also',
  'because',
  'before',
  'being',
  'chat',
  'could',
  'from',
  'have',
  'into',
  'just',
  'like',
  'make',
  'more',
  'need',
  'needs',
  'should',
  'that',
  'their',
  'there',
  'this',
  'through',
  'user',
  'with',
  'would',
]);

const SECRET_PATTERNS = [
  /\b(api[_\s-]?key|access[_\s-]?token|refresh[_\s-]?token|password|secret|private[_\s-]?key|bearer)\b/i,
  /\b(sk-[a-zA-Z0-9_-]{16,}|ghp_[a-zA-Z0-9_]{16,}|xox[baprs]-[a-zA-Z0-9-]{12,})\b/,
  /\bAIza[0-9A-Za-z_-]{20,}\b/,
  /\b(AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|STRIPE_SECRET_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY)\b/i,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\s*:\s*\S{8,}\b/,
  /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/,
];

const TRANSIENT_JUNK_PATTERNS = [
  /\b(localhost|127\.0\.0\.1|0\.0\.0\.0):\d{2,5}\b/i,
  /\b(stack trace|traceback|syntaxerror|typeerror|referenceerror)\b/i,
  /\b(test failed|tests failed|typecheck failed|build failed|lint failed)\b/i,
  /\b(i feel|i'm feeling|my mood|i am sad|i am angry|i am tired)\b/i,
];

const TAG_KEYWORDS: Array<{ tag: string; keywords: string[] }> = [
  { tag: 'branding', keywords: ['brand', 'branding', 'mythology', 'identity', 'tension', 'archetype', 'positioning', 'narrative'] },
  { tag: 'visual-world', keywords: ['visual', 'cover', 'art', 'photo', 'image', 'color', 'typography', 'font', 'merch', 'poster', 'aesthetic', 'style'] },
  { tag: 'rollout', keywords: ['rollout', 'campaign', 'release', 'launch', 'breadcrumb', 'ritual', 'sequence', 'tease'] },
  { tag: 'outreach', keywords: ['outreach', 'email', 'dm', 'linkedin', 'a&r', 'label', 'producer', 'manager', 'pitch', 'rapport'] },
  { tag: 'comms', keywords: ['newsletter', 'fan', 'community', 'caption', 'copy', 'message', 'announcement', 'sms'] },
  { tag: 'content', keywords: ['content', 'post', 'reel', 'tiktok', 'short', 'youtube', 'hook', 'story'] },
  { tag: 'worldbuilding', keywords: ['world', 'universe', 'immersive', 'lore', 'character', 'symbol', 'place', 'motel', 'chapter'] },
  { tag: 'workflow', keywords: ['workflow', 'automation', 'trigger', 'repeat', 'pipeline', 'process'] },
  { tag: 'industry', keywords: ['industry', 'a&r', 'label', 'playlist', 'sync', 'publisher', 'supervisor', 'curator'] },
  { tag: 'music', keywords: ['song', 'album', 'single', 'lyrics', 'demo', 'sound', 'genre', 'bpm', 'mood', 'production'] },
];

const TARGET_HINTS: Record<string, string[]> = {
  branding: ['branding', 'brand', 'narrative', 'world', 'belief', 'profile'],
  'visual-world': ['art', 'visual', 'cover', 'design', 'typography', 'merch', 'photo'],
  rollout: ['campaign', 'rollout', 'content', 'calendar', 'world'],
  outreach: ['outreach', 'email', 'industry', 'hunter', 'comms'],
  comms: ['comms', 'communication', 'community', 'fan', 'email', 'copy'],
  content: ['content', 'social', 'publisher', 'video', 'genius'],
  worldbuilding: ['world', 'immersion', 'narrative', 'branding'],
  workflow: ['workflow', 'orchestrator', 'hnic'],
  industry: ['industry', 'hunter', 'outreach', 'a&r', 'label'],
  music: ['record', 'song', 'music', 'spotify', 'producer'],
};

export function buildSharedIntelDocs(input: BuildSharedIntelInput): BuiltSharedIntelDoc[] {
  const candidates = extractSharedIntelCandidates(input).slice(0, MAX_NOTES_PER_SHARE);
  const now = (input.now ?? new Date()).toISOString();
  const docs: BuiltSharedIntelDoc[] = [];

  for (const candidate of candidates) {
    const targetAgents = resolveTargetAgents(candidate.targetAgents, input.agentCatalog);
    if (targetAgents.length === 0) continue;
    const routeReasons = buildRouteReasons(candidate, targetAgents);

    const mergeTarget = input.forceNew ? null : findMergeTarget(input.existingNotes ?? [], candidate, input.sessionId);
    const action = mergeTarget ? 'updated' as const : 'created' as const;
    const note: SharedIntelNote = mergeTarget
      ? {
          ...mergeTarget.note,
          title: candidate.title,
          summary: candidate.summary,
          whyItMatters: candidate.whyItMatters,
          tags: mergeTags(mergeTarget.note.tags, candidate.tags),
          targetAgents: targetAgents.map((agent) => agent.slug),
          sourceAgentSlug: input.sourceAgentSlug ?? mergeTarget.note.sourceAgentSlug,
          sourceAgentName: input.sourceAgentName ?? mergeTarget.note.sourceAgentName,
          updatedAt: now,
          revision: mergeTarget.note.revision + 1,
          confidence: candidate.confidence,
          evidence: candidate.evidence ?? mergeTarget.note.evidence,
          routeReasons,
          superseded: false,
        }
      : {
          version: 1,
          id: createSharedIntelId(input.sessionId, candidate.title),
          title: candidate.title,
          summary: candidate.summary,
          whyItMatters: candidate.whyItMatters,
          tags: candidate.tags,
          targetAgents: targetAgents.map((agent) => agent.slug),
          sourceSessionId: input.sessionId,
          sourceAgentSlug: input.sourceAgentSlug,
          sourceAgentName: input.sourceAgentName,
          createdAt: now,
          updatedAt: now,
          revision: 1,
          confidence: candidate.confidence,
          evidence: candidate.evidence,
          routeReasons,
        };

    const slug = mergeTarget?.slug ?? createSharedIntelSlug(input.sessionId, candidate.title);
    docs.push({
      slug,
      note,
      body: renderSharedIntelBody(note, targetAgents),
      targetAgents,
      action,
    });
  }

  return docs;
}

export function extractSharedIntelCandidates(input: BuildSharedIntelInput): SharedIntelCandidate[] {
  const messages = selectRecentMeaningfulMessages(input.messages);
  if (messages.length === 0) return [];

  const focusText = buildFocusText(messages);
  if (!isDurableCandidateText(focusText)) return [];

  const assistantText = [...messages].reverse().find((message) => message.role === 'assistant')?.content.trim();
  const userText = [...messages].reverse().find((message) => message.role === 'user')?.content.trim();
  const sourceText = assistantText && assistantText.length >= GENERIC_MIN_CHARS ? assistantText : focusText;
  const tags = inferTags(`${focusText}\n${input.sourceAgentName ?? ''}\n${input.sourceAgentSlug ?? ''}`);
  if (tags.length === 0) return [];

  const title = buildTitle(sourceText, tags, input.sourceAgentName);
  const summary = summarizeText(sourceText);
  const evidence = trimText((assistantText || userText || sourceText).replace(/\s+/g, ' '), MAX_EVIDENCE_CHARS);
  const targetAgents = rankTargetAgents({
    tags,
    text: focusText,
    sourceAgentSlug: input.sourceAgentSlug,
    agentCatalog: input.agentCatalog,
  }).map((agent) => agent.slug);

  if (targetAgents.length === 0) return [];

  return [{
    title,
    summary,
    whyItMatters: buildWhyItMatters(tags, targetAgents),
    tags,
    targetAgents,
    confidence: focusText.length > 420 && targetAgents.length > 1 ? 'high' : 'medium',
    evidence,
  }];
}

export function renderSharedIntelBody(note: SharedIntelNote, targetAgents: SharedIntelAgentCatalogEntry[] = []): string {
  const targetNames = targetAgents.length
    ? targetAgents.map((agent) => `${agent.name} (@${agent.slug})`).join(', ')
    : note.targetAgents.map((slug) => `@${slug}`).join(', ');
  const payload = JSON.stringify(note, null, 2);
  const source = note.sourceAgentName || note.sourceAgentSlug
    ? `${note.sourceAgentName ?? note.sourceAgentSlug}${note.sourceAgentSlug ? ` (@${note.sourceAgentSlug})` : ''}`
    : 'Chat';

  return [
    `\`\`\`${SHARED_INTEL_FENCE}`,
    payload,
    '```',
    '',
    '## Shared Intel',
    '',
    note.summary,
    '',
    '## Why It Matters',
    '',
    note.whyItMatters,
    '',
    '## Targets',
    '',
    targetNames || 'No targets',
    '',
    ...(note.routeReasons?.length
      ? [
          '## Routing Reasons',
          '',
          ...note.routeReasons.map((item) => `- @${item.agentSlug}: ${item.reason}`),
          '',
        ]
      : []),
    '## Source',
    '',
    `${source}, ${note.updatedAt}`,
    '',
    ...(note.evidence
      ? ['## Evidence', '', `> ${note.evidence}`]
      : []),
  ].join('\n');
}

export function parseSharedIntelNote(body: string): SharedIntelNote | null {
  const escapedFence = SHARED_INTEL_FENCE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = body.match(new RegExp(`\`\`\`${escapedFence}\\s*\\n([\\s\\S]*?)\\n\`\`\``));
  if (!match?.[1]) return null;
  try {
    const parsed = JSON.parse(match[1]) as Partial<SharedIntelNote>;
    if (parsed.version !== 1) return null;
    if (!parsed.id || !parsed.title || !parsed.summary || !parsed.sourceSessionId) return null;
    if (!Array.isArray(parsed.tags) || !Array.isArray(parsed.targetAgents)) return null;
    return {
      version: 1,
      id: String(parsed.id),
      title: String(parsed.title),
      summary: String(parsed.summary),
      whyItMatters: String(parsed.whyItMatters ?? ''),
      tags: parsed.tags.filter((tag): tag is string => typeof tag === 'string'),
      targetAgents: parsed.targetAgents.filter((slug): slug is string => typeof slug === 'string'),
      sourceSessionId: String(parsed.sourceSessionId),
      sourceAgentSlug: typeof parsed.sourceAgentSlug === 'string' ? parsed.sourceAgentSlug : undefined,
      sourceAgentName: typeof parsed.sourceAgentName === 'string' ? parsed.sourceAgentName : undefined,
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date(0).toISOString(),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
      revision: typeof parsed.revision === 'number' ? parsed.revision : 1,
      confidence: parsed.confidence === 'high' || parsed.confidence === 'low' ? parsed.confidence : 'medium',
      evidence: typeof parsed.evidence === 'string' ? parsed.evidence : undefined,
      routeReasons: normalizeRouteReasons(parsed.routeReasons),
      superseded: parsed.superseded === true,
    };
  } catch {
    return null;
  }
}

export function isSharedIntelContextSlug(slug: string): boolean {
  return slug.startsWith(SHARED_INTEL_CONTEXT_PREFIX);
}

export function buildSharedIntelPromptSection(
  docs: Array<{ slug: string; metadata: { name: string; enabled?: boolean }; body: string }>,
): string {
  const notes = docs
    .filter((doc) => doc.metadata.enabled !== false && isSharedIntelContextSlug(doc.slug))
    .map((doc) => parseSharedIntelNote(doc.body))
    .filter((note): note is SharedIntelNote => Boolean(note && !note.superseded))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 7);

  if (notes.length === 0) return '';

  const lines: string[] = [];
  for (const [index, note] of notes.entries()) {
    const source = note.sourceAgentName || note.sourceAgentSlug || 'chat';
    const tags = note.tags.length ? `Tags: ${note.tags.join(', ')}` : 'Tags: none';
    const rendered = [
      `${index + 1}. ${note.title}`,
      `   ${tags}`,
      `   Source: ${source}; updated ${note.updatedAt}`,
      `   Summary: ${trimText(note.summary, MAX_PROMPT_SUMMARY_CHARS)}`,
    ].join('\n');
    const next = [...lines, rendered];
    const total = [
      SHARED_INTEL_PROMPT_HEADER,
      '',
      'Use these as internal reference context. Treat newer, directly targeted notes as stronger than older general notes. Do not repeat them back unless useful.',
      '',
      ...next,
    ].join('\n');
    if (total.length > MAX_SHARED_INTEL_PROMPT_CHARS) break;
    lines.push(rendered);
  }

  return [
    SHARED_INTEL_PROMPT_HEADER,
    '',
    'Use these as internal reference context. Treat newer, directly targeted notes as stronger than older general notes. Do not repeat them back unless useful.',
    '',
    ...lines,
  ].join('\n');
}

export function createSharedIntelSlug(sessionId: string, title: string): string {
  const sessionPart = slugify(sessionId).slice(0, 8) || 'session';
  const maxTitleLength = Math.max(4, 64 - SHARED_INTEL_CONTEXT_PREFIX.length - sessionPart.length - 1);
  const titlePart = slugify(title).slice(0, maxTitleLength) || 'note';
  return `${SHARED_INTEL_CONTEXT_PREFIX}${sessionPart}-${titlePart}`;
}

export function createSharedIntelId(sessionId: string, title: string): string {
  return `si_${stableHash(`${sessionId}:${title}`)}`;
}

function selectRecentMeaningfulMessages(messages: Message[]): Message[] {
  return messages
    .filter((message) => (
      (message.role === 'user' || message.role === 'assistant')
      && !message.isIntermediate
      && typeof message.content === 'string'
      && message.content.trim().length > 0
    ))
    .slice(-RECENT_MESSAGE_LIMIT);
}

function buildFocusText(messages: Message[]): string {
  return messages
    .map((message) => `${message.role.toUpperCase()}: ${message.content.trim()}`)
    .join('\n\n')
    .trim();
}

function isDurableCandidateText(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length < GENERIC_MIN_CHARS) return false;
  if (SECRET_PATTERNS.some((pattern) => pattern.test(normalized))) return false;
  if (TRANSIENT_JUNK_PATTERNS.some((pattern) => pattern.test(normalized))) return false;
  const lowered = normalized.toLowerCase();
  const weakPhrases = ['thanks', 'thank you', 'sounds good', 'ok cool', 'great thanks'];
  if (weakPhrases.some((phrase) => lowered === phrase || lowered.endsWith(`\n${phrase}`))) return false;
  return true;
}

function inferTags(text: string): string[] {
  const lowered = text.toLowerCase();
  const tags: string[] = [];
  for (const entry of TAG_KEYWORDS) {
    if (entry.keywords.some((keyword) => lowered.includes(keyword))) {
      tags.push(entry.tag);
    }
  }
  return tags.slice(0, 8);
}

function buildTitle(text: string, tags: string[], sourceAgentName?: string): string {
  const sentence = firstUsefulSentence(text);
  const clean = sentence
    .replace(/^(assistant|user):\s*/i, '')
    .replace(/^#+\s*/, '')
    .trim();
  const compact = trimText(clean, 72);
  if (compact.length >= 24) return compact;
  const tag = tags[0] ? titleCase(tags[0].replace(/-/g, ' ')) : 'Shared Intel';
  return sourceAgentName ? `${sourceAgentName}: ${tag}` : tag;
}

function summarizeText(text: string): string {
  const sentences = splitSentences(text)
    .map((sentence) => sentence.replace(/^(assistant|user):\s*/i, '').trim())
    .filter((sentence) => sentence.length > 24);
  const picked = sentences.slice(-3).join(' ');
  return trimText(picked || text.replace(/\s+/g, ' '), MAX_SUMMARY_CHARS);
}

function buildWhyItMatters(tags: string[], targetAgents: string[]): string {
  const tagLabel = tags.slice(0, 3).join(', ') || 'strategy';
  const targets = targetAgents.slice(0, 3).map((slug) => `@${slug}`).join(', ');
  return `This gives ${targets || 'the right workers'} reusable ${tagLabel} context for future work in this workspace.`;
}

function buildRouteReasons(candidate: SharedIntelCandidate, targetAgents: SharedIntelAgentCatalogEntry[]): SharedIntelRouteReason[] {
  return targetAgents.map((agent) => {
    const haystack = [
      agent.slug,
      agent.name,
      agent.description,
      agent.inputs,
      agent.outputs,
      ...(agent.tags ?? []),
    ].filter(Boolean).join(' ').toLowerCase();
    const matchedTags = candidate.tags.filter((tag) => {
      const hints = TARGET_HINTS[tag] ?? [tag];
      return (agent.tags ?? []).some((agentTag) => agentTag.toLowerCase() === tag)
        || hints.some((hint) => haystack.includes(hint));
    });
    const tagLabel = matchedTags.length ? matchedTags.join(', ') : candidate.tags.slice(0, 2).join(', ') || 'workspace context';
    return {
      agentSlug: agent.slug,
      matchedTags,
      reason: `Matched ${tagLabel} against ${agent.name}'s role metadata.`,
    };
  });
}

function normalizeRouteReasons(value: unknown): SharedIntelRouteReason[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.flatMap((item): SharedIntelRouteReason[] => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Partial<SharedIntelRouteReason>;
    if (typeof candidate.agentSlug !== 'string' || typeof candidate.reason !== 'string') return [];
    return [{
      agentSlug: candidate.agentSlug,
      matchedTags: Array.isArray(candidate.matchedTags) ? candidate.matchedTags.filter((tag): tag is string => typeof tag === 'string') : [],
      reason: candidate.reason,
    }];
  });
  return out.length ? out : undefined;
}

function rankTargetAgents(input: {
  tags: string[];
  text: string;
  sourceAgentSlug?: string;
  agentCatalog: SharedIntelAgentCatalogEntry[];
}): SharedIntelAgentCatalogEntry[] {
  const loweredText = input.text.toLowerCase();
  const explicitOnlyTags = inferExplicitOnlyTargetTags(loweredText);
  const scored = input.agentCatalog
    .filter((agent) => agent.slug && agent.slug !== CONCIERGE_SLUG && agent.active !== false)
    .map((agent) => {
      const haystack = [
        agent.slug,
        agent.name,
        agent.description,
        agent.inputs,
        agent.outputs,
        ...(agent.tags ?? []),
      ].filter(Boolean).join(' ').toLowerCase();
      let score = 0;
      for (const tag of input.tags) {
        const hints = TARGET_HINTS[tag] ?? [tag];
        if ((agent.tags ?? []).some((agentTag) => agentTag.toLowerCase() === tag)) score += 8;
        for (const hint of hints) {
          if (loweredText.includes(hint) && haystack.includes(hint)) score += 5;
        }
      }
      if (agent.slug === input.sourceAgentSlug) score += 2;
      if (agent.visualAgent && input.tags.includes('visual-world')) score += 4;
      return { agent, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.agent.name.localeCompare(b.agent.name));

  const filtered = explicitOnlyTags.size
    ? scored.filter((entry) => agentMatchesExplicitTargetTags(entry.agent, explicitOnlyTags))
    : scored;

  return filtered.slice(0, MAX_TARGET_AGENTS).map((entry) => entry.agent);
}

function inferExplicitOnlyTargetTags(loweredText: string): Set<string> {
  if (!/\bonly\b/.test(loweredText)) return new Set();
  const out = new Set<string>();
  if (/\bbrand(?:ing)?\b|branding agent/.test(loweredText)) out.add('branding');
  if (/\bart direction\b|\bart director\b|\bvisual(?:s| world)?\b|\bcover art\b/.test(loweredText)) out.add('visual-world');
  if (/\boutreach\b|\bemail\b|\bpitch\b/.test(loweredText)) out.add('outreach');
  if (/\bcomms?\b|\bcommunications?\b|\bcopy\b|\bcaption\b/.test(loweredText)) out.add('comms');
  if (/\bindustry\b|\ba&r\b|\blabel\b|\bcurator\b|\bsupervisor\b/.test(loweredText)) out.add('industry');
  return out;
}

function agentMatchesExplicitTargetTags(agent: SharedIntelAgentCatalogEntry, tags: Set<string>): boolean {
  const agentTags = new Set((agent.tags ?? []).map((tag) => tag.toLowerCase()));
  const label = `${agent.slug} ${agent.name}`.toLowerCase();
  if (tags.has('branding') && (agentTags.has('branding') || /\bbrand(?:ing)?\b/.test(label))) return true;
  if (tags.has('visual-world') && (agentTags.has('visual-world') || /\bart\b|\bvisual\b|\bdesign\b/.test(label))) return true;
  if (tags.has('outreach') && (agentTags.has('outreach') || /\boutreach\b/.test(label))) return true;
  if (tags.has('comms') && (agentTags.has('comms') || /\bcomms?\b|\bcommunications?\b/.test(label))) return true;
  if (tags.has('industry') && (agentTags.has('industry') || /\bindustry\b/.test(label))) return true;
  return false;
}

function resolveTargetAgents(slugs: string[], agentCatalog: SharedIntelAgentCatalogEntry[]): SharedIntelAgentCatalogEntry[] {
  const bySlug = new Map(agentCatalog.filter((agent) => agent.active !== false).map((agent) => [agent.slug, agent]));
  return Array.from(new Set(slugs))
    .map((slug) => bySlug.get(slug))
    .filter((agent): agent is SharedIntelAgentCatalogEntry => Boolean(agent))
    .slice(0, MAX_TARGET_AGENTS);
}

function findMergeTarget(
  existingDocs: ExistingSharedIntelDoc[],
  candidate: SharedIntelCandidate,
  sessionId: string,
): ExistingSharedIntelDoc | null {
  const candidateWords = keywordSet(`${candidate.title} ${candidate.summary}`);
  let best: { doc: ExistingSharedIntelDoc; score: number } | null = null;
  for (const doc of existingDocs) {
    if (doc.note.sourceSessionId !== sessionId || doc.note.superseded) continue;
    const tagOverlap = intersectionSize(new Set(candidate.tags), new Set(doc.note.tags));
    const targetOverlap = intersectionSize(new Set(candidate.targetAgents), new Set(doc.note.targetAgents));
    const wordOverlap = intersectionSize(candidateWords, keywordSet(`${doc.note.title} ${doc.note.summary}`));
    const score = tagOverlap * 3 + targetOverlap * 2 + wordOverlap;
    if (score >= 5 && (!best || score > best.score)) best = { doc, score };
  }
  return best?.doc ?? null;
}

function mergeTags(left: string[], right: string[]): string[] {
  return Array.from(new Set([...left, ...right])).slice(0, 12);
}

function firstUsefulSentence(text: string): string {
  return splitSentences(text).find((sentence) => sentence.trim().length > 18) ?? text.trim();
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function trimText(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function keywordSet(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .map((word) => word.trim())
      .filter((word) => word.length > 3 && !STOPWORDS.has(word)),
  );
}

function intersectionSize<T>(left: Set<T>, right: Set<T>): number {
  let count = 0;
  for (const item of left) {
    if (right.has(item)) count += 1;
  }
  return count;
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}
