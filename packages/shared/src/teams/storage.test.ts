import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deleteGlobalTeam,
  getGlobalTeamFile,
  isValidTeamSlug,
  loadAllGlobalTeams,
  loadGlobalTeam,
  parseTeamFile,
  seedGlobalTeamLibraryIfEmpty,
  serializeTeam,
  writeGlobalTeam,
} from './storage.ts';
import { STARTER_TEAMS } from './starter-templates.ts';
import type { TeamMetadata } from './types.ts';

let libDir: string;

beforeEach(() => {
  libDir = mkdtempSync(join(tmpdir(), 'teams-lib-'));
});

afterEach(() => {
  rmSync(libDir, { recursive: true, force: true });
});

const opts = () => ({ globalTeamsDir: libDir });

const minimalMeta = (overrides?: Partial<TeamMetadata>): TeamMetadata => ({
  name: 'Commerce Launch Team',
  description: 'Launch products with checks.',
  lead: 'head-of-biz',
  members: [
    { slug: 'ecommerce-ops', role: 'Commerce operations' },
    { slug: 'reviewer', role: 'Final review' },
  ],
  ...overrides,
});

describe('parseTeamFile', () => {
  test('parses a valid TEAM.md', () => {
    const parsed = parseTeamFile([
      '---',
      'name: Commerce Launch Team',
      'description: Launch products with checks.',
      'lead: head-of-biz',
      'standing: true',
      'archived: true',
      'permissionMode: ask',
      'verification:',
      '  default: advisory',
      '  requiredFor:',
      '    - publish',
      '    - spend',
      'members:',
      '  - slug: ecommerce-ops',
      '    role: Commerce operations',
      '    requiredSources:',
      '      - shopify',
      '  - slug: reviewer',
      '    role: Final review',
      '---',
      'body',
    ].join('\n'));

    expect(parsed).not.toBeNull();
    expect(parsed!.metadata.name).toBe('Commerce Launch Team');
    expect(parsed!.metadata.lead).toBe('head-of-biz');
    expect(parsed!.metadata.archived).toBe(true);
    expect(parsed!.metadata.members).toHaveLength(2);
    expect(parsed!.metadata.members[0]!.requiredSources).toEqual(['shopify']);
    expect(parsed!.metadata.verification?.requiredFor).toEqual(['publish', 'spend']);
    expect(parsed!.body).toBe('body');
  });

  test('rejects missing required fields', () => {
    expect(parseTeamFile('---\ndescription: x\nlead: a\nmembers: []\n---\n')).toBeNull();
    expect(parseTeamFile('---\nname: x\nlead: a\nmembers: []\n---\n')).toBeNull();
    expect(parseTeamFile('---\nname: x\ndescription: y\nmembers: []\n---\n')).toBeNull();
  });

  test('rejects invalid lead and duplicate members', () => {
    expect(parseTeamFile([
      '---',
      'name: A',
      'description: B',
      'lead: "Bad Lead"',
      'members:',
      '  - slug: reviewer',
      '    role: Review',
      '---',
    ].join('\n'))).toBeNull();

    expect(parseTeamFile([
      '---',
      'name: A',
      'description: B',
      'lead: lead-agent',
      'members:',
      '  - slug: reviewer',
      '    role: Review',
      '  - slug: reviewer',
      '    role: Review again',
      '---',
    ].join('\n'))).toBeNull();
  });

  test('rejects lead listed as a member', () => {
    expect(parseTeamFile([
      '---',
      'name: A',
      'description: B',
      'lead: lead-agent',
      'members:',
      '  - slug: lead-agent',
      '    role: Lead',
      '---',
    ].join('\n'))).toBeNull();
  });

  test('rejects invalid verification policy', () => {
    expect(parseTeamFile([
      '---',
      'name: A',
      'description: B',
      'lead: lead-agent',
      'members:',
      '  - slug: reviewer',
      '    role: Review',
      'verification:',
      '  default: impossible',
      '---',
    ].join('\n'))).toBeNull();
  });
});

describe('serializeTeam', () => {
  test('round-trips team metadata', () => {
    const metadata = minimalMeta({
      standing: true,
      archived: true,
      permissionMode: 'ask',
      verification: { default: 'blocking', requiredFor: ['code_change'] },
    });
    const serialized = serializeTeam(metadata, '# Notes\n');
    const parsed = parseTeamFile(serialized);
    expect(parsed?.metadata).toEqual(metadata);
    expect(parsed?.body).toBe('# Notes');
  });
});

describe('team storage', () => {
  test('validates slugs', () => {
    expect(isValidTeamSlug('commerce-launch-team')).toBe(true);
    expect(isValidTeamSlug('Bad Team')).toBe(false);
  });

  test('writes, loads, lists, and deletes global teams', () => {
    const written = writeGlobalTeam(
      { slug: 'commerce-launch-team', metadata: minimalMeta(), body: '# Team' },
      opts(),
    );
    expect(written.slug).toBe('commerce-launch-team');
    expect(existsSync(getGlobalTeamFile('commerce-launch-team', opts()))).toBe(true);

    const loaded = loadGlobalTeam('commerce-launch-team', opts());
    expect(loaded?.metadata.lead).toBe('head-of-biz');
    expect(loaded?.body).toBe('# Team');

    expect(loadAllGlobalTeams(opts()).map((team) => team.slug)).toEqual(['commerce-launch-team']);
    expect(deleteGlobalTeam('commerce-launch-team', opts())).toBe(true);
    expect(loadGlobalTeam('commerce-launch-team', opts())).toBeNull();
  });

  test('skips malformed team files while listing', () => {
    writeGlobalTeam({ slug: 'valid-team', metadata: minimalMeta(), body: '' }, opts());
    const invalidFile = getGlobalTeamFile('invalid-team', opts());
    mkdirSync(join(libDir, 'invalid-team'), { recursive: true });
    writeFileSync(invalidFile, 'not really', 'utf-8');

    expect(loadAllGlobalTeams(opts()).map((team) => team.slug)).toEqual(['valid-team']);
  });

  test('seeds starter teams without overwriting existing files', () => {
    writeGlobalTeam({
      slug: STARTER_TEAMS[0]!.slug,
      metadata: minimalMeta({ name: 'Custom Team' }),
      body: '# Custom',
    }, opts());

    const result = seedGlobalTeamLibraryIfEmpty(STARTER_TEAMS, opts());
    expect(result.seeded).toBe(STARTER_TEAMS.length - 1);
    const customRaw = readFileSync(getGlobalTeamFile(STARTER_TEAMS[0]!.slug, opts()), 'utf-8');
    expect(customRaw).toContain('Custom Team');

    const second = seedGlobalTeamLibraryIfEmpty(STARTER_TEAMS, opts());
    expect(second.seeded).toBe(0);
  });
});
