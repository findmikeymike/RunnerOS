import { describe, expect, test } from 'bun:test';
import { buildCampaignManagerBrief, CAMPAIGN_MANAGER_BRIEF_MAX_CHARS, parseCampaignManagerBrief, renderCampaignManagerBriefPromptSection, serializeCampaignManagerBrief } from './campaign-manager-brief.ts';
import type { ManagerBriefV1, ManagerCampaignSnapshot } from './types.ts';

describe('Campaign Manager Brief', () => {
  test('combines a small artist bridge with current campaign readiness and operations', () => {
    const brief = buildCampaignManagerBrief({
      artistWorkspaceId: 'hq-1',
      artistBrief: artistBrief(),
      campaign: campaign(),
      operational: {
        generatedAt: '2026-08-29T12:00:00.000Z',
        scope: { type: 'campaign', campaignId: 'campaign-1' },
        active: [],
        approvals: [{ id: 'approval', kind: 'output', title: 'Approve cover', status: 'pending', updatedAt: '2026-08-29T00:00:00.000Z', scope: { type: 'campaign', campaignId: 'campaign-1' }, fingerprint: 'a', source: 'output' }],
        failures: [],
        recentOutputs: [],
        sourceHealth: [],
      },
      now: new Date('2026-08-29T12:00:00.000Z'),
    });

    expect(brief.artist.artistName).toBe('Mikey Mike');
    expect(brief.campaign.name).toBe('September Single');
    expect(brief.campaign.readiness?.nextMissing).toContain('Cover art');
    expect(brief.operatingState.suggestedFocus).toContain('approval');
    expect(brief.campaign.mission?.bpm).toBe(130);
    expect(brief.campaign.mission?.sonicReferences).toEqual(['Rush — Artist A', 'Static — Artist B']);
    expect(brief.revision).toMatch(/^campaign-manager-v1:fnv1a:[0-9a-f]{8}$/);
    const prompt = renderCampaignManagerBriefPromptSection(brief);
    expect(prompt).toContain('Genre: alt-pop / drum and bass');
    expect(prompt).toContain('BPM: 130');
    expect(prompt).toContain('Similar sonics: Rush — Artist A, Static — Artist B');
    expect(prompt).toContain('Theme: Escaping a life that no longer fits.');
    expect(prompt.length).toBeLessThanOrEqual(CAMPAIGN_MANAGER_BRIEF_MAX_CHARS);
    expect(parseCampaignManagerBrief(serializeCampaignManagerBrief(brief))?.revision).toBe(brief.revision);
  });

  test('keeps revision stable when only generation time changes', () => {
    const first = buildCampaignManagerBrief({ artistWorkspaceId: 'hq-1', artistBrief: artistBrief(), campaign: campaign(), now: new Date('2026-08-29T00:00:00.000Z') });
    const second = buildCampaignManagerBrief({ artistWorkspaceId: 'hq-1', artistBrief: artistBrief(), campaign: campaign(), now: new Date('2026-08-30T00:00:00.000Z') });
    expect(first.generatedAt).not.toBe(second.generatedAt);
    expect(first.revision).toBe(second.revision);
  });

  test('never exceeds the prompt budget under hostile campaign text', () => {
    const huge = 'x'.repeat(20_000);
    const snapshot = campaign();
    snapshot.name = huge;
    snapshot.mission = { ...snapshot.mission!, title: huge, goal: huge, mood: huge, visualWorld: huge, targetListener: huge };
    snapshot.readiness = { done: 0, total: 99, nextMissing: Array.from({ length: 30 }, () => huge) };
    snapshot.sourceHealth = Array.from({ length: 30 }, (_, index) => ({ source: `${index}-${huge}`, status: 'malformed' as const, message: huge }));
    const brief = buildCampaignManagerBrief({ artistWorkspaceId: 'hq-1', artistBrief: artistBrief(), campaign: snapshot });
    expect(renderCampaignManagerBriefPromptSection(brief).length).toBeLessThanOrEqual(CAMPAIGN_MANAGER_BRIEF_MAX_CHARS);
    expect(brief.budget.actualChars).toBe(renderCampaignManagerBriefPromptSection(brief).length);
  });

  test('rejects structurally incomplete and tampered persisted briefs', () => {
    const malformed = `\`\`\`campaign-state-of-play\n${JSON.stringify({
      version: 1,
      workspaceId: 'campaign-1',
      artistWorkspaceId: 'hq-1',
      revision: 'campaign-manager-v1:fnv1a:12345678',
      campaign: {},
    })}\n\`\`\``;
    expect(parseCampaignManagerBrief(malformed)).toBeNull();

    const valid = buildCampaignManagerBrief({ artistWorkspaceId: 'hq-1', artistBrief: artistBrief(), campaign: campaign() });
    valid.campaign.name = 'Tampered after revision';
    expect(parseCampaignManagerBrief(serializeCampaignManagerBrief(valid))).toBeNull();
  });

  test('labels overdue and upcoming campaign work separately', () => {
    const snapshot = campaign();
    snapshot.calendarHighlights = [
      { title: 'Release day', date: '2026-09-12', status: 'scheduled', timing: 'upcoming' },
      { title: 'Late artwork', date: '2026-08-20', status: 'scheduled', timing: 'overdue' },
    ];
    snapshot.workHighlights = [
      { title: 'Pitch press', startAt: '2026-09-01T12:00:00.000Z', status: 'scheduled', timing: 'upcoming' },
      { title: 'Approve master', startAt: '2026-08-20T12:00:00.000Z', status: 'scheduled', timing: 'overdue' },
    ];
    const rendered = renderCampaignManagerBriefPromptSection(buildCampaignManagerBrief({
      artistWorkspaceId: 'hq-1',
      artistBrief: artistBrief(),
      campaign: snapshot,
    }));
    expect(rendered).toContain('### Upcoming Calendar');
    expect(rendered).toContain('### Overdue Calendar');
    expect(rendered).toContain('### Upcoming Work');
    expect(rendered).toContain('### Overdue Work');
  });
});

function artistBrief(): ManagerBriefV1 {
  return {
    version: 1,
    workspaceId: 'hq-1',
    revision: 'manager-v1:fnv1a:12345678',
    generatedAt: '2026-08-29T00:00:00.000Z',
    budget: { maxChars: 8000, actualChars: 0, truncated: false },
    identity: { artistName: 'Mikey Mike', mission: 'Build a lasting independent catalog.', sound: 'Raw soul.', audience: 'Underdogs.' },
    trajectory: [],
    growth: {},
    intelligence: [],
    operatingState: { attention: [], blockers: [], activeWork: [] },
    sourceHealth: [],
  };
}

function campaign(): ManagerCampaignSnapshot {
  return {
    workspaceId: 'campaign-1',
    name: 'September Single',
    primary: true,
    mission: {
      id: 'mission-brief',
      workspaceId: 'campaign-1',
      status: 'full',
      completeness: 90,
      missionType: 'single',
      title: 'September Single',
      goal: 'Build audience.',
      releaseDate: '2026-09-12',
      genre: 'alt-pop / drum and bass',
      bpm: 130,
      sonicReferences: ['Rush — Artist A', 'Static — Artist B'],
      theme: 'Escaping a life that no longer fits.',
      energy: 'Tense verses with a fast, explosive chorus.',
      keyMoments: 'Double-time lift at 0:42.',
      updatedAt: '2026-08-29T00:00:00.000Z',
    },
    readiness: { done: 8, total: 12, nextMissing: ['Cover art'] },
    essentialAssets: [{ label: 'Master', available: true }, { label: 'Cover art', available: false }],
    calendarHighlights: [{ title: 'Final mix', date: '2026-09-01', status: 'scheduled', timing: 'upcoming' }],
    workHighlights: [],
    outputHighlights: [],
    sourceHealth: [],
  };
}
