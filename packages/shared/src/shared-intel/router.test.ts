import { describe, expect, test } from 'bun:test';
import type { Message } from '@craft-agent/core/types';
import {
  buildSharedIntelDocs,
  buildSharedIntelPromptSection,
  createSharedIntelSlug,
  parseSharedIntelNote,
  type SharedIntelAgentCatalogEntry,
} from './index.ts';

function message(role: 'user' | 'assistant', content: string, index: number): Message {
  return {
    id: `m-${index}`,
    role,
    content,
    timestamp: index,
  };
}

const agents: SharedIntelAgentCatalogEntry[] = [
  {
    slug: 'branding-agent',
    name: 'Branding Agent',
    description: 'Build artist brand DNA, mythology, narrative, tensions, and public expression.',
    tags: ['branding', 'narrative'],
    active: true,
  },
  {
    slug: 'art-director',
    name: 'Art Director',
    description: 'Cover art, visual world, typography, merch design, photos, and campaign visuals.',
    tags: ['visual-world', 'design'],
    visualAgent: true,
    active: true,
  },
  {
    slug: 'outreach-agent',
    name: 'Outreach Agent',
    description: 'Find emails and draft high-rapport personalized outreach.',
    tags: ['outreach', 'email'],
    active: true,
  },
  {
    slug: 'comms-agent',
    name: 'Comms Agent',
    description: 'Draft fan, press, newsletter, caption, and community messages.',
    tags: ['comms', 'community'],
    active: true,
  },
  {
    slug: 'industry-hunter',
    name: 'Industry Hunter',
    description: 'Research labels, playlists, supervisors, curators, and industry opportunities.',
    tags: ['industry', 'research'],
    active: true,
  },
  {
    slug: 'dormant-worker',
    name: 'Dormant Worker',
    description: 'Dormant brand worker.',
    tags: ['branding'],
    active: false,
  },
];

describe('shared intel router', () => {
  test('creates a targeted shared intel doc from a durable recent idea', () => {
    const docs = buildSharedIntelDocs({
      sessionId: '260704-premium-lens',
      sourceAgentSlug: 'persona-agent',
      sourceAgentName: 'Legendary Minds',
      agentCatalog: agents,
      now: new Date('2026-07-04T12:00:00.000Z'),
      messages: [
        message('user', 'Run this through Tom Ford for the artist rollout.', 1),
        message('assistant', 'The useful rule is premium restraint. The rollout should use black-and-white contrast, fewer colors, severe typography, and one recurring visual signal instead of explaining the mythology in every post. This gives the brand and visual world a strict taste rule: remove busy signals before adding concept.', 2),
      ],
    });

    expect(docs).toHaveLength(1);
    const doc = docs[0]!;
    expect(doc.slug.startsWith('shared-intel-260704-p')).toBe(true);
    expect(doc.note.tags).toContain('branding');
    expect(doc.note.tags).toContain('visual-world');
    expect(doc.note.targetAgents).toContain('branding-agent');
    expect(doc.note.targetAgents).toContain('art-director');
    expect(doc.note.targetAgents).not.toContain('dormant-worker');
    expect(doc.note.routeReasons?.some((reason) => reason.agentSlug === 'branding-agent')).toBe(true);
    expect(doc.body).toContain('## Routing Reasons');
    expect(doc.body).toContain('```json shared-intel');
  });

  test('does not save generic short chatter', () => {
    const docs = buildSharedIntelDocs({
      sessionId: 'short-chat',
      agentCatalog: agents,
      messages: [
        message('user', 'thanks', 1),
        message('assistant', 'Great.', 2),
      ],
    });

    expect(docs).toEqual([]);
  });

  test('does not save secrets or credentials', () => {
    const secretMessages = [
      'Remember this API key for the campaign: sk-abc1234567890secretkey and route it to the branding agent.',
      'OPENAI_API_KEY=sk-abc1234567890secretkey should be used for the artist rollout.',
      'Save this login for outreach: manager@example.com:supersecretpassword.',
      '-----BEGIN PRIVATE KEY----- abcdef -----END PRIVATE KEY----- Save this for the campaign.',
    ];

    for (const content of secretMessages) {
      const docs = buildSharedIntelDocs({
        sessionId: 'secret-chat',
        agentCatalog: agents,
        messages: [
          message('user', content, 1),
          message('assistant', 'I cannot store secrets, but we can talk about branding safely.', 2),
        ],
      });

      expect(docs).toEqual([]);
    }
  });

  test('does not save transient runtime junk or personal mood scraps', () => {
    const junkMessages = [
      'The local dev server at localhost:5173 failed. TypeError stack trace says the campaign route crashed.',
      'Remember that I am tired and angry today but still want the rollout to be good.',
    ];

    for (const content of junkMessages) {
      expect(buildSharedIntelDocs({
        sessionId: 'junk-chat',
        agentCatalog: agents,
        messages: [
          message('user', content, 1),
          message('assistant', 'Temporary note acknowledged.', 2),
        ],
      })).toEqual([]);
    }
  });

  test('updates an existing note from the same session instead of duplicating', () => {
    const first = buildSharedIntelDocs({
      sessionId: 'same-session',
      sourceAgentSlug: 'persona-agent',
      sourceAgentName: 'Legendary Minds',
      agentCatalog: agents,
      now: new Date('2026-07-04T12:00:00.000Z'),
      messages: [
        message('user', 'Save this brand direction.', 1),
        message('assistant', 'The artist brand should lean into spiritual but reckless tension. It should show ritual imagery with volatile, late-night behavior, and the rollout should leave breadcrumbs instead of spelling out the mythology.', 2),
      ],
    });
    const firstDoc = first[0]!;

    const second = buildSharedIntelDocs({
      sessionId: 'same-session',
      sourceAgentSlug: 'persona-agent',
      sourceAgentName: 'Legendary Minds',
      agentCatalog: agents,
      existingNotes: [{ slug: firstDoc.slug, note: firstDoc.note }],
      now: new Date('2026-07-04T12:05:00.000Z'),
      messages: [
        message('user', 'Actually refine that.', 3),
        message('assistant', 'The sharper brand rule is spiritual recklessness: chapel imagery, motel lighting, and reckless late-night rituals. Keep the mythology implied through symbols and campaign breadcrumbs rather than explained directly.', 4),
      ],
    });

    expect(second).toHaveLength(1);
    const secondDoc = second[0]!;
    expect(secondDoc.action).toBe('updated');
    expect(secondDoc.slug).toBe(firstDoc.slug);
    expect(secondDoc.note.revision).toBe(2);
    expect(secondDoc.note.summary).toContain('spiritual recklessness');
    expect(secondDoc.note.routeReasons?.length).toBeGreaterThan(0);
  });

  test('updates replace target workers instead of preserving stale over-routes', () => {
    const first = buildSharedIntelDocs({
      sessionId: 'same-session-retarget',
      sourceAgentSlug: 'concierge',
      sourceAgentName: 'HNIC',
      agentCatalog: agents,
      now: new Date('2026-07-04T12:00:00.000Z'),
      messages: [
        message('user', 'Save this broad artist rollout idea.', 1),
        message('assistant', 'The rollout should connect brand mythology, fan communications, label outreach, and visual assets into one campaign system.', 2),
      ],
    });

    const second = buildSharedIntelDocs({
      sessionId: 'same-session-retarget',
      sourceAgentSlug: 'concierge',
      sourceAgentName: 'HNIC',
      agentCatalog: agents,
      existingNotes: first.map((doc) => ({ slug: doc.slug, note: doc.note })),
      now: new Date('2026-07-04T12:05:00.000Z'),
      messages: [
        message('user', 'Narrow that note.', 3),
        message('assistant', 'The useful durable rule is only for branding and art direction: stark cover art, severe typography, and one recurring red symbol across campaign assets.', 4),
      ],
    });

    expect(second).toHaveLength(1);
    expect(second[0]!.action).toBe('updated');
    expect(new Set(second[0]!.note.targetAgents)).toEqual(new Set(['branding-agent', 'art-director']));
  });

  test('keeps distinct ideas from the same session as separate notes when forceNew is set', () => {
    const first = buildSharedIntelDocs({
      sessionId: 'same-session-force',
      agentCatalog: agents,
      now: new Date('2026-07-04T12:00:00.000Z'),
      messages: [
        message('user', 'Save this visual direction.', 1),
        message('assistant', 'The campaign visual world should use stark cover art, severe typography, and one recurring red symbol across every asset.', 2),
      ],
    });

    const second = buildSharedIntelDocs({
      sessionId: 'same-session-force',
      agentCatalog: agents,
      existingNotes: first.map((doc) => ({ slug: doc.slug, note: doc.note })),
      forceNew: true,
      now: new Date('2026-07-04T12:05:00.000Z'),
      messages: [
        message('user', 'Save a separate outreach idea.', 3),
        message('assistant', 'For outreach, pitch playlist curators with a short personal note about the cinematic underdog angle and the single release timing.', 4),
      ],
    });

    expect(second).toHaveLength(1);
    expect(second[0]?.action).toBe('created');
    expect(second[0]?.slug).not.toBe(first[0]?.slug);
    expect(second[0]?.note.targetAgents).toContain('outreach-agent');
  });

  test('routes overlapping terms to the precise worker set', () => {
    const docs = buildSharedIntelDocs({
      sessionId: 'precision-chat',
      agentCatalog: agents,
      now: new Date('2026-07-04T12:00:00.000Z'),
      messages: [
        message('user', 'Save this industry outreach angle.', 1),
        message('assistant', 'The industry play is to research playlist curators and label contacts first, then draft high-rapport outreach emails around the single release story. Do not route this as a brand mythology task.', 2),
      ],
    });

    expect(docs).toHaveLength(1);
    const targets = docs[0]!.note.targetAgents;
    expect(targets).toContain('outreach-agent');
    expect(targets).toContain('industry-hunter');
    expect(targets).not.toContain('art-director');
  });

  test('honors explicit only-target wording over broad inferred routing', () => {
    const docs = buildSharedIntelDocs({
      sessionId: 'explicit-only-chat',
      sourceAgentSlug: 'concierge',
      sourceAgentName: 'HNIC',
      agentCatalog: agents,
      now: new Date('2026-07-04T12:00:00.000Z'),
      messages: [
        message('user', 'Save this Artist HQ rollout note.', 1),
        message('user', 'The next artist rollout should use stark black-and-white cover art, severe typography, and one recurring red symbol across campaign assets. Route this to branding and art direction only.', 2),
      ],
    });

    expect(docs).toHaveLength(1);
    expect(new Set(docs[0]!.note.targetAgents)).toEqual(new Set(['branding-agent', 'art-director']));
  });

  test('renders compact shared intel prompt section', () => {
    const docs = buildSharedIntelDocs({
      sessionId: 'prompt-session',
      sourceAgentName: 'Legendary Minds',
      agentCatalog: agents,
      now: new Date('2026-07-04T12:00:00.000Z'),
      messages: [
        message('user', 'Need the best visual brand rule.', 1),
        message('assistant', 'Use a visual-world rule: every cover and campaign asset should feel like a single severe photograph interrupted by one uncanny symbol. The art direction should avoid generic collage and preserve a strict, memorable brand signal.', 2),
      ],
    });
    const doc = docs[0]!;
    const parsed = parseSharedIntelNote(doc.body);

    expect(parsed?.title).toBe(doc.note.title);
    expect(parsed?.routeReasons?.[0]?.reason).toContain('Matched');
    const prompt = buildSharedIntelPromptSection([{
      slug: doc.slug,
      metadata: { name: 'Shared Intel', enabled: true },
      body: doc.body,
    }]);

    expect(prompt).toContain('Shared Intel for this worker:');
    expect(prompt).toContain(doc.note.title);
    expect(prompt).toContain('Tags:');
    expect(prompt).toContain('Summary:');
    expect(prompt.length).toBeLessThan(1400);
  });

  test('caps prompt bloat across many shared intel docs', () => {
    const docs = Array.from({ length: 12 }, (_, index) => buildSharedIntelDocs({
      sessionId: `prompt-bloat-${index}`,
      sourceAgentName: 'Legendary Minds',
      agentCatalog: agents,
      now: new Date(`2026-07-04T12:${String(index).padStart(2, '0')}:00.000Z`),
      messages: [
        message('user', 'Save this rollout and visual-world rule.', 1),
        message('assistant', `The rollout rule ${index} is to keep the campaign visually strict, use one recurring symbol, keep captions compact, and avoid explaining the mythology directly. `.repeat(8), 2),
      ],
    })[0]!).filter(Boolean);

    const prompt = buildSharedIntelPromptSection(docs.map((doc) => ({
      slug: doc.slug,
      metadata: { name: 'Shared Intel', enabled: true },
      body: doc.body,
    })));

    expect(prompt).toContain('Shared Intel for this worker:');
    expect(prompt.length).toBeLessThanOrEqual(2600);
  });

  test('keeps generated context slugs inside the workspace context limit', () => {
    const slug = createSharedIntelSlug(
      '260605-tall-chrome',
      'Hey what we need do to connect my google agent USER: Smoke test note for Artist HQ with a very long title',
    );

    expect(slug).toMatch(/^shared-intel-[a-z0-9-]+$/);
    expect(slug.length).toBeLessThanOrEqual(64);
  });
});
