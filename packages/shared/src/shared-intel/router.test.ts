import { describe, expect, test } from 'bun:test';
import type { Message } from '@craft-agent/core/types';
import {
  buildSharedIntelDocs,
  buildSharedIntelPromptSection,
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
    const docs = buildSharedIntelDocs({
      sessionId: 'secret-chat',
      agentCatalog: agents,
      messages: [
        message('user', 'Remember this API key for the campaign: sk-abc1234567890secretkey and route it to the branding agent.', 1),
        message('assistant', 'I cannot store secrets, but we can talk about branding safely.', 2),
      ],
    });

    expect(docs).toEqual([]);
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
});
