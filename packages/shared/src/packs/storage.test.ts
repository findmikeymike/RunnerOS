import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ActivatedPacksManifestEntry, PackDependencyKind } from './index.ts';
import { STARTER_AGENTS } from '../agent-definitions/starter-templates.ts';
import { BUNDLED_STARTER_SKILLS, STARTER_SKILLS } from '../skills/index.ts';
import { STARTER_WORKFLOWS } from '../workflows/starter-templates.ts';
import {
  buildPackInstallPlan,
  ensureRequiredPacks,
  getActivatedPacksManifestPath,
  installPack,
  loadGlobalPack,
  parsePackFile,
  readActivatedPacks,
  seedGlobalPackLibraryIfEmpty,
  serializePack,
  writeGlobalPack,
} from './index.ts';
import { STARTER_PACKS } from './starter-templates.ts';

let sandbox: string;
let globalPacksDir: string;
let workspace: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'runner-packs-'));
  globalPacksDir = join(sandbox, 'packs');
  workspace = join(sandbox, 'workspace');
  mkdirSync(workspace, { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

test('parsePackFile accepts a Hermes-style operating bundle manifest', () => {
  const parsed = parsePackFile(`---
name: Ads Ops
description: Operate paid acquisition with approval gates.
version: 1.0.0
agents: [ads-strategist]
skills: [google-ads]
sources: [google-ads]
workflows: [campaign-brief]
guardrails:
  permissionMode: ask
  requiresApprovalFor: [campaign-create, budget-change]
profiles:
  personal-ops:
    agents: [operator]
    workflows: [daily-growth-review]
    permissionMode: ask
dependencies:
  - kind: external
    slug: google-ads-oauth
    required: false
---
# Ads Ops
`);

  expect(parsed?.metadata.name).toBe('Ads Ops');
  expect(parsed?.metadata.profiles?.['personal-ops']?.agents).toEqual(['operator']);
  expect(parsed?.metadata.guardrails?.requiresApprovalFor).toContain('budget-change');
  expect(parsed?.metadata.dependencies?.[0]?.kind).toBe('external');
});

test('writeGlobalPack round-trips PACK.md', () => {
  const written = writeGlobalPack({
    slug: 'ads-ops',
    metadata: {
      name: 'Ads Ops',
      description: 'Operate paid acquisition.',
      version: '1.0.0',
      agents: ['ads-strategist'],
      profiles: {
        main: { skills: ['google-ads'] },
      },
    },
    body: '# Ads Ops',
  }, { globalPacksDir });

  expect(written.slug).toBe('ads-ops');
  expect(written.metadata.agents).toEqual(['ads-strategist']);
});

test('readActivatedPacks backs up malformed manifests', () => {
  writeFileSync(getActivatedPacksManifestPath(workspace), '{ nope', 'utf-8');
  const manifest = readActivatedPacks(workspace);
  expect(manifest.active).toEqual([]);
});

describe('pack install plans', () => {
  test('Print-On-Demand Company OS manifest covers its POD agent and workflow dependencies', () => {
    const pack = STARTER_PACKS.find((starter) => starter.slug === 'print-on-demand-company-os');
    expect(pack).toBeDefined();

    const packAgents = new Set(pack!.metadata.agents ?? []);
    const packSkills = new Set(pack!.metadata.skills ?? []);
    const packSources = new Set(pack!.metadata.sources ?? []);
    const packWorkflows = new Set(pack!.metadata.workflows ?? []);
    const starterAgentSlugs = new Set(STARTER_AGENTS.map((agent) => agent.slug));
    const starterSkillSlugs = new Set([
      ...STARTER_SKILLS.map((skill) => skill.slug),
      ...BUNDLED_STARTER_SKILLS.map((skill) => skill.slug),
    ]);

    expect([...packAgents].filter((agentSlug) => !starterAgentSlugs.has(agentSlug))).toEqual([]);

    expect([...packSkills].filter((skillSlug) => !starterSkillSlugs.has(skillSlug))).toEqual([]);

    const packStarterAgents = STARTER_AGENTS.filter((starter) => packAgents.has(starter.slug));
    const missingAgentSkills = packStarterAgents
      .flatMap((agent) => (agent.metadata.skills ?? [])
        .filter((skillSlug) => !packSkills.has(skillSlug))
        .map((skillSlug) => `${agent.slug}:${skillSlug}`));
    const missingAgentSources = packStarterAgents
      .flatMap((agent) => (agent.metadata.sources ?? [])
        .filter((sourceSlug) => !packSources.has(sourceSlug))
        .map((sourceSlug) => `${agent.slug}:${sourceSlug}`));

    expect(missingAgentSkills).toEqual([]);
    expect(missingAgentSources).toEqual([]);

    for (const workflow of STARTER_WORKFLOWS.filter((starter) => packWorkflows.has(starter.slug))) {
      for (const step of workflow.metadata.steps) {
        expect(packAgents.has(step.agent)).toBe(true);
      }
    }
  });

  test('report missing components before activation', () => {
    writeGlobalPack({
      slug: 'missing-demo',
      metadata: {
        name: 'Missing Demo',
        description: 'Declares unavailable pieces.',
        version: '1.0.0',
        agents: ['missing-agent'],
        skills: ['missing-skill'],
        sources: ['missing-source'],
        workflows: ['missing-workflow'],
      },
      body: '',
    }, { globalPacksDir });

    const plan = buildPackInstallPlan('missing-demo', { globalPacksDir });
    expect(plan.issues.filter((item) => item.severity === 'error').map((item) => item.kind).sort()).toEqual([
      'agent',
      'skill',
      'source',
      'workflow',
    ]);
  });

  test('validates declared non-external dependencies', () => {
    writeGlobalPack({
      slug: 'dependency-demo',
      metadata: {
        name: 'Dependency Demo',
        description: 'Declares explicit dependencies.',
        version: '1.0.0',
        dependencies: [
          { kind: 'agent', slug: 'missing-agent' },
          { kind: 'workflow', slug: 'optional-flow', required: false },
        ],
      },
      body: '',
    }, { globalPacksDir });

    const plan = buildPackInstallPlan('dependency-demo', { globalPacksDir });
    expect(plan.issues).toContainEqual(expect.objectContaining({ severity: 'error', kind: 'agent', slug: 'missing-agent' }));
    expect(plan.issues).toContainEqual(expect.objectContaining({ severity: 'warning', kind: 'workflow', slug: 'optional-flow' }));
  });

  test('does not treat disabled doc placeholder sources as installable', () => {
    writeGlobalPack({
      slug: 'source-demo',
      metadata: {
        name: 'Source Demo',
        description: 'Declares builtin and disabled sources.',
        version: '1.0.0',
        sources: ['google-ads', 'runner-docs'],
      },
      body: '',
    }, { globalPacksDir });

    const plan = buildPackInstallPlan('source-demo', { globalPacksDir });
    expect(plan.issues).toContainEqual(expect.objectContaining({ severity: 'error', kind: 'source', slug: 'runner-docs' }));
    expect(plan.issues).not.toContainEqual(expect.objectContaining({ kind: 'source', slug: 'google-ads' }));
  });

  test('installs a pack with profile activation when referenced pieces exist', () => {
    writeGlobalPack({
      slug: 'operator-pack',
      metadata: {
        name: 'Operator Pack',
        description: 'Installs the operator world.',
        version: '1.0.0',
        profiles: {
          'personal-ops': {
            agents: ['operator'],
            skills: ['operator-skill'],
            sources: ['operator-source'],
            workflows: ['operator-flow'],
          },
        },
      },
      body: '',
    }, { globalPacksDir });

    const activated: Record<Exclude<PackDependencyKind, 'automation' | 'external'>, string[]> = {
      agent: [],
      skill: [],
      source: [],
      workflow: [],
    };
    const result = installPack(workspace, 'operator-pack', {
      globalPacksDir,
      profile: 'personal-ops',
      adapters: {
        exists: () => true,
        snapshot: () => ({ agents: [], skills: [], sources: [], workflows: [], packs: [] }),
        restore: () => undefined,
        activate: (kind, _workspaceRootPath, slug) => {
          if (kind !== 'automation') activated[kind].push(slug);
        },
      },
    });

    expect(activated.agent).toEqual(['operator']);
    expect(activated.skill).toEqual(['operator-skill']);
    expect(activated.source).toEqual(['operator-source']);
    expect(activated.workflow).toEqual(['operator-flow']);
    expect(result.installed.packs).toContainEqual(expect.objectContaining({ slug: 'operator-pack', profile: 'personal-ops' }));
  });

  test('reports declared automations as setup-required instead of installed', () => {
    writeGlobalPack({
      slug: 'cadence-pack',
      metadata: {
        name: 'Cadence Pack',
        description: 'Declares background cadence.',
        version: '1.0.0',
        automations: ['daily-brief'],
      },
      body: '',
    }, { globalPacksDir });

    const result = installPack(workspace, 'cadence-pack', {
      globalPacksDir,
      adapters: {
        exists: () => true,
        snapshot: () => ({ agents: [], skills: [], sources: [], workflows: [], packs: [] }),
        restore: () => undefined,
        activate: () => undefined,
      },
    });

    expect(result.activate.automations).toEqual(['daily-brief']);
    expect(result.requiresSetup?.automations).toEqual(['daily-brief']);
    expect(result.installed.automations).toEqual([]);
  });

  test('rolls back activated pieces when installation fails', () => {
    writeGlobalPack({
      slug: 'rollback-pack',
      metadata: {
        name: 'Rollback Pack',
        description: 'Fails mid-install.',
        version: '1.0.0',
        agents: ['agent-a'],
        workflows: ['flow-a'],
      },
      body: '',
    }, { globalPacksDir });

    const state: {
      agents: string[];
      skills: string[];
      sources: string[];
      workflows: string[];
      packs: ActivatedPacksManifestEntry[];
    } = {
      agents: ['already-active'],
      skills: ['already-skill'],
      sources: ['already-source'],
      workflows: ['already-flow'],
      packs: [],
    };

    expect(() => installPack(workspace, 'rollback-pack', {
      globalPacksDir,
      adapters: {
        exists: () => true,
        snapshot: () => structuredClone(state),
        restore: (_workspaceRootPath, snapshot) => {
          state.agents = [...snapshot.agents];
          state.skills = [...snapshot.skills];
          state.sources = [...snapshot.sources];
          state.workflows = [...snapshot.workflows];
          state.packs = [...snapshot.packs];
        },
        activate: (kind, _workspaceRootPath, slug) => {
          if (kind === 'workflow') throw new Error('workflow failed');
          state[`${kind}s` as 'agents' | 'skills' | 'sources'].push(slug);
        },
      },
    })).toThrow('workflow failed');

    expect(state.agents).toEqual(['already-active']);
    expect(state.skills).toEqual(['already-skill']);
    expect(state.sources).toEqual(['already-source']);
    expect(state.workflows).toEqual(['already-flow']);
    expect(state.packs).toEqual([]);
  });
});

test('serializePack emits readable PACK.md frontmatter', () => {
  const serialized = serializePack({
    name: 'Video Studio',
    description: 'Video agent operating bundle.',
    version: '1.0.0',
    agents: ['video-producer'],
  }, '# Video Studio');
  expect(serialized).toContain('name: Video Studio');
  expect(serialized).toContain('# Video Studio');
});

test('ensureRequiredPacks seeds missing packs without overwriting existing files', () => {
  const input = {
    slug: 'starter-pack',
    metadata: {
      name: 'Starter Pack',
      description: 'Seeds a starter pack.',
      version: '1.0.0',
    },
    body: 'FIRST',
  };
  expect(ensureRequiredPacks([input], { globalPacksDir }).ensured).toBe(1);
  expect(ensureRequiredPacks([{ ...input, body: 'SECOND' }], { globalPacksDir }).ensured).toBe(0);
});

test('seedGlobalPackLibraryIfEmpty does not recreate deleted starter packs', () => {
  const input = {
    slug: 'starter-pack',
    metadata: {
      name: 'Starter Pack',
      description: 'Seeds a starter pack.',
      version: '1.0.0',
    },
    body: 'FIRST',
  };
  expect(seedGlobalPackLibraryIfEmpty([input], { globalPacksDir }).seeded).toBe(1);
  expect(loadGlobalPack('starter-pack', { globalPacksDir })).not.toBeNull();

  rmSync(join(globalPacksDir, 'starter-pack'), { recursive: true, force: true });
  expect(seedGlobalPackLibraryIfEmpty([input], { globalPacksDir }).seeded).toBe(0);
  expect(loadGlobalPack('starter-pack', { globalPacksDir })).toBeNull();
});

test('seedGlobalPackLibraryIfEmpty backfills new starters after old seeded marker', () => {
  mkdirSync(globalPacksDir, { recursive: true });
  writeFileSync(join(globalPacksDir, '.seeded'), '2026-01-01T00:00:00.000Z', 'utf-8');

  const legacy = {
    slug: 'legacy-pack',
    metadata: {
      name: 'Legacy Pack',
      description: 'Old starter pack.',
      version: '1.0.0',
    },
    body: 'LEGACY',
  };
  const next = {
    slug: 'next-pack',
    metadata: {
      name: 'Next Pack',
      description: 'New starter pack.',
      version: '1.0.0',
    },
    body: 'NEXT',
  };

  expect(seedGlobalPackLibraryIfEmpty([legacy, next], {
    globalPacksDir,
    legacySeededSlugs: ['legacy-pack'],
  }).seeded).toBe(1);
  expect(loadGlobalPack('legacy-pack', { globalPacksDir })).toBeNull();
  expect(loadGlobalPack('next-pack', { globalPacksDir })).not.toBeNull();
});
