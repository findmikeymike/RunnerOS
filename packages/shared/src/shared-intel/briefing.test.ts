import { describe, expect, test } from 'bun:test';
import { isFinalSignalReport, parseSignalBriefing, SIGNAL_BRIEFING_INSTRUCTIONS } from './index.ts';
import type { OutputManifest, OutputSummary } from '../outputs/types.ts';

const briefing = (count = 120) => [
  ...Array.from({ length: Math.max(0, count - 8) }, () => 'Insight'),
  'The full report has the details and sources.',
].join(' ');
const report = (text = briefing()) => `# Weekly Signal Brief\n\n## Your Briefing\n\n${text}\n\n## What changed\nReport details.\n\n## Confidence and sources\nhttps://example.com`;

describe('Signal briefing contract', () => {
  test('accepts exact word bounds and normalizes whitespace for backend comparison', () => {
    for (const count of [80, 119, 120, 135, 150, 151, 180]) {
      expect(parseSignalBriefing(report(briefing(count).replace(' ', '\n\n')))).toBe(briefing(count));
    }
    for (const count of [0, 79, 181]) expect(parseSignalBriefing(report(briefing(count)))).toBeNull();
  });

  test('returns null for old, empty, unavailable, and oversized reports', () => {
    for (const text of ['', '# Old report\nA summary.', '## Your Briefing',
      report(briefing().replace('Insight', 'scan unavailable')),
      report(briefing().replace('Insight', 'all lanes failed')),
      report(briefing().replace('Insight', 'no usable findings')),
      report(briefing().replace('Insight', 'x'.repeat(2500))), 'x'.repeat(100_001)]) {
      expect(parseSignalBriefing(text)).toBeNull();
    }
    expect(parseSignalBriefing(report(briefing().replace('Insight', 'One lane was unavailable')))).not.toBeNull();
  });

  test('recognizes actual h2 boundaries, CRLF, closing hashes, and setext headings', () => {
    expect(parseSignalBriefing(report().replaceAll('\n', '\r\n'))).toBe(briefing());
    expect(parseSignalBriefing(report().replace('## Your Briefing', '  ## Your Briefing ##'))).toBe(briefing());
    expect(parseSignalBriefing(`## Your Briefing\n${briefing()}\n# Details\nNot spoken`)).toBe(briefing());
    expect(parseSignalBriefing(`## Your Briefing\n${briefing()}\n\nDetails\n-------\nNot spoken`)).toBe(briefing());
    expect(parseSignalBriefing(`## Your Briefing\n${briefing()}`)).toBe(briefing());
    expect(parseSignalBriefing(`## Your Briefing Extra\n${briefing()}`)).toBeNull();
    expect(parseSignalBriefing(`${report()}\n## Your Briefing\n${briefing()}`)).toBeNull();
  });

  test('ignores headings inside fences but rejects fenced content in a briefing', () => {
    for (const marker of ['```', '~~~~']) {
      expect(parseSignalBriefing(`${marker}markdown\n${report()}\n${marker}`)).toBeNull();
      expect(parseSignalBriefing(`${marker}\n## Your Briefing\nfake\n${marker}\n${report()}`)).toBe(briefing());
      expect(parseSignalBriefing(`## Your Briefing\n${marker}\n${briefing()}\n${marker}`)).toBeNull();
    }
    expect(parseSignalBriefing(`\`\`\`\`\n\`\`\`\n${report()}\n\`\`\`\``)).toBeNull();
    expect(parseSignalBriefing(`${report()}\n\`\`\`\n## Your Briefing\nexample\n\`\`\``)).toBe(briefing());
  });

  test('rejects markup, stage directions, URLs, control characters and nested headings', () => {
    for (const junk of ['**bold**', '_emphasis_', '[pause]', '[link](https://example.com)',
      '<script>', '`code`', 'https://example.com', '&amp;', '\u0000', '\u202e',
      '\n- bullet', '\n1. numbered', '\n> quote', '\n### subheading']) {
      expect(parseSignalBriefing(report(briefing().replace('Insight', junk)))).toBeNull();
    }
  });

  test('classifies only the final workflow report, not arbitrary collector outputs', () => {
    const final = {
      kind: 'report', status: 'published', title: 'Weekly Signal Brief', tags: [], primary: { id: 'report.md' },
      origin: { source: 'workflow', workflowSlug: 'weekly-signal-scan', workflowRunId: 'run-1', stepId: 'synthesize' },
    };
    const acceptsSummary: (output: OutputSummary) => boolean = isFinalSignalReport;
    const acceptsManifest: (output: OutputManifest) => boolean = isFinalSignalReport;
    expect(acceptsSummary).toBe(isFinalSignalReport);
    expect(acceptsManifest).toBe(isFinalSignalReport);
    expect(isFinalSignalReport(final)).toBe(true);
    expect(isFinalSignalReport({ ...final, title: 'My renamed report' })).toBe(true);
    expect(isFinalSignalReport({ ...final, primary: undefined, primaryAssetId: 'report.md' })).toBe(true);
    for (const patch of [{ kind: 'audio' }, { status: 'draft' }, { status: 'failed' },
      { primary: undefined }, { tags: ['signal-source-packet'] },
      { origin: { ...final.origin, stepId: 'youtube-intel' } },
      { origin: { ...final.origin, stepId: 'platform-watch' } },
      { origin: { ...final.origin, stepId: 'industry-desk' } },
      { origin: { ...final.origin, stepId: undefined } },
      { origin: { ...final.origin, source: 'agent' } },
      { origin: { ...final.origin, workflowSlug: 'another-workflow' } },
      { origin: { ...final.origin, workflowRunId: '' } }, { origin: undefined }]) {
      expect(isFinalSignalReport({ ...final, ...patch })).toBe(false);
    }
    expect(SIGNAL_BRIEFING_INSTRUCTIONS).toContain('Do not generate audio');
  });
});
