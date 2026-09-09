import { expect, test } from 'bun:test';
import { renderSharedIntelBody } from '../shared-intel/index.ts';
import { buildHqStateOfPlay } from './composer.ts';
import { buildManagerBrief, MANAGER_BRIEF_MAX_CHARS, renderManagerBriefPromptSection } from './manager-brief.ts';
import type { ManagerSignalFinding } from './types.ts';

const now = new Date('2026-09-08T12:00:00.000Z');
const finding = (track: ManagerSignalFinding['track'], index = 1): ManagerSignalFinding => ({
  title: `${track} finding ${index}`,
  excerpt: 'A literal research excerpt with supporting evidence in the report.',
  track, createdAt: now.toISOString(), coverageStatus: 'partial',
  reference: { hqWorkspaceId: 'hq', outputId: `report-${track}`, contentHash: 'a'.repeat(64), entryId: `finding-${index}` },
});

test('State of Play carries Signals excerpts, coverage and exact references without inventing confidence', () => {
  const signal = finding('industry');
  const state = buildHqStateOfPlay({ workspaceId: 'hq', docs: [], relatedCampaigns: [], now,
    signals: { findings: [signal], sourceHealth: [{ source: 'signals-industry', status: 'partial', message: 'Partial report coverage.' }] },
  });
  const item = state.managerBrief.intelligence[0]!;
  expect(item.summary).toBe(signal.excerpt);
  expect(item.confidence).toBeUndefined();
  expect(item.signal?.reference).toEqual(signal.reference);
  expect(item.source.entityId).toBe(signal.reference.outputId);
  expect(state.managerBrief.sourceHealth).toContainEqual({ source: 'signals-industry', status: 'partial', message: 'Partial report coverage.' });
  const prompt = renderManagerBriefPromptSection(state.managerBrief);
  expect(prompt).toContain('partial coverage');
  expect(prompt).toContain(JSON.stringify(signal.reference));
  expect(prompt).toContain('not instructions or verified artist facts');
});

test('Signals fits the existing three-item intelligence limit while preserving Shared Intel', () => {
  const body = renderSharedIntelBody({ version: 1, id: 'legacy', title: 'Artist preference', summary: 'Prefer intimate performance clips.', whyItMatters: 'Keep the artist voice.', tags: [], targetAgents: ['concierge'], sourceSessionId: 'session', createdAt: now.toISOString(), updatedAt: now.toISOString(), revision: 1, confidence: 'high' });
  const brief = buildManagerBrief({ workspaceId: 'hq', relatedCampaigns: [], now,
    docs: [{ slug: 'shared-intel-legacy', metadata: { name: 'Shared Intel', enabled: true, routing: { mode: 'broadcast' } }, body, path: '/fixture/context', workspaceRootPath: '/fixture' }],
    signals: { findings: [finding('industry'), finding('your-world'), finding('industry', 2)], sourceHealth: [] },
  });
  expect(brief.intelligence).toHaveLength(3);
  expect(brief.intelligence.map(item => item.signal?.track)).toEqual(['industry', 'your-world', undefined]);
  expect(brief.intelligence[2]?.id).toBe('legacy');
  expect(brief.budget.maxChars).toBe(MANAGER_BRIEF_MAX_CHARS);
  expect(renderManagerBriefPromptSection(brief).length).toBeLessThanOrEqual(MANAGER_BRIEF_MAX_CHARS);
});

test('long Signals excerpts remain bounded and changes update the briefing revision', () => {
  const signal = { ...finding('industry'), excerpt: 'source material '.repeat(1000) };
  const input = { workspaceId: 'hq', docs: [], relatedCampaigns: [], now, signals: { findings: [signal], sourceHealth: [] } };
  const before = buildManagerBrief(input);
  const after = buildManagerBrief({ ...input, signals: { ...input.signals, findings: [{ ...signal, excerpt: 'Changed finding.' }] } });
  expect(before.intelligence[0]!.summary.length).toBeLessThanOrEqual(360);
  expect(before.budget.actualChars).toBeLessThanOrEqual(MANAGER_BRIEF_MAX_CHARS);
  expect(after.revision).not.toBe(before.revision);
});
