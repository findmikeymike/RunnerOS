import {
  loadGlobalAgent,
  readActivatedAgents,
  setAgentActive,
  writeActivatedAgents,
  type AgentStorageOptions,
} from '../agent-definitions/storage.ts';
import {
  listEnabledGlobalSkillSlugs,
  loadGlobalSkillBySlug,
  setGlobalSkillEnabled,
} from '../skills/storage.ts';
import {
  activateGlobalSourceInWorkspace,
  loadGlobalSource,
  readGlobalSourcesManifest,
  writeGlobalSourcesManifest,
} from '../sources/storage.ts';
import { isBuiltinSource } from '../sources/builtin-sources.ts';
import {
  loadGlobalWorkflow,
  readActivatedWorkflows,
  setWorkflowActive,
  writeActivatedWorkflows,
  type WorkflowStorageOptions,
} from '../workflows/storage.ts';
import { loadGlobalPack, readActivatedPacks, setPackActive, writeActivatedPacks, type PackStorageOptions } from './storage.ts';
import type { ActivatedPacksManifestEntry, LoadedPack, PackActivationBundle, PackDependencyKind, PackInstallIssue, PackInstallPlan, PackInstallResult, PackProfileSlug } from './types.ts';

export interface PackInstallOptions extends PackStorageOptions, AgentStorageOptions, WorkflowStorageOptions {
  profile?: PackProfileSlug;
  adapters?: Partial<PackInstallAdapters>;
}

interface PackWorkspaceSnapshot {
  agents: string[];
  skills: string[];
  sources: string[];
  workflows: string[];
  packs: ActivatedPacksManifestEntry[];
}

export interface PackInstallAdapters {
  exists(kind: PackDependencyKind, slug: string, options?: PackInstallOptions): boolean | 'unsupported';
  snapshot(workspaceRootPath: string): PackWorkspaceSnapshot;
  restore(workspaceRootPath: string, snapshot: PackWorkspaceSnapshot): void;
  activate(kind: Exclude<PackDependencyKind, 'external'>, workspaceRootPath: string, slug: string, profile?: string): void;
}

function dedupe(values: readonly string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean))).sort();
}

function mergeActivation(pack: LoadedPack, profileSlug: PackProfileSlug): PackActivationBundle {
  const profile = pack.metadata.profiles?.[profileSlug];
  return {
    agents: dedupe([...(pack.metadata.agents ?? []), ...(profile?.agents ?? [])]),
    skills: dedupe([...(pack.metadata.skills ?? []), ...(profile?.skills ?? [])]),
    sources: dedupe([...(pack.metadata.sources ?? []), ...(profile?.sources ?? [])]),
    workflows: dedupe([...(pack.metadata.workflows ?? []), ...(profile?.workflows ?? [])]),
    automations: dedupe([...(pack.metadata.automations ?? []), ...(profile?.automations ?? [])]),
  };
}

function issue(severity: PackInstallIssue['severity'], kind: PackInstallIssue['kind'], slug: string, message: string): PackInstallIssue {
  return { severity, kind, slug, message };
}

function restoreSkills(workspaceRootPath: string, previous: string[]): void {
  const wanted = new Set(previous);
  for (const slug of listEnabledGlobalSkillSlugs(workspaceRootPath)) {
    if (!wanted.has(slug)) setGlobalSkillEnabled(workspaceRootPath, slug, false);
  }
  for (const slug of previous) setGlobalSkillEnabled(workspaceRootPath, slug, true);
}

const NON_INSTALLABLE_BUILTIN_SOURCE_SLUGS = new Set(['runner-docs', 'craft-agents-docs']);

function isPackInstallableBuiltinSource(slug: string): boolean {
  return isBuiltinSource(slug) && !NON_INSTALLABLE_BUILTIN_SOURCE_SLUGS.has(slug);
}

const DEFAULT_ADAPTERS: PackInstallAdapters = {
  exists(kind, slug, options) {
    switch (kind) {
      case 'agent': return !!loadGlobalAgent(slug, options);
      case 'skill': return !!loadGlobalSkillBySlug(slug);
      case 'source': return isPackInstallableBuiltinSource(slug) || !!loadGlobalSource(slug);
      case 'workflow': return !!loadGlobalWorkflow(slug, options);
      case 'automation': return 'unsupported';
      case 'external': return 'unsupported';
    }
  },
  snapshot(workspaceRootPath) {
    return {
      agents: readActivatedAgents(workspaceRootPath).active,
      skills: listEnabledGlobalSkillSlugs(workspaceRootPath),
      sources: readGlobalSourcesManifest(workspaceRootPath).activatedSlugs,
      workflows: readActivatedWorkflows(workspaceRootPath).active,
      packs: readActivatedPacks(workspaceRootPath).active,
    };
  },
  restore(workspaceRootPath, snapshot) {
    writeActivatedAgents(workspaceRootPath, snapshot.agents);
    restoreSkills(workspaceRootPath, snapshot.skills);
    writeGlobalSourcesManifest(workspaceRootPath, snapshot.sources);
    writeActivatedWorkflows(workspaceRootPath, snapshot.workflows);
    writeActivatedPacks(workspaceRootPath, snapshot.packs);
  },
  activate(kind, workspaceRootPath, slug, profile) {
    switch (kind) {
      case 'agent':
        setAgentActive(workspaceRootPath, slug, true);
        return;
      case 'skill':
        setGlobalSkillEnabled(workspaceRootPath, slug, true);
        return;
      case 'source':
        activateGlobalSourceInWorkspace(workspaceRootPath, slug);
        return;
      case 'workflow':
        setWorkflowActive(workspaceRootPath, slug, true);
        return;
      case 'automation':
        throw new Error(`Automation activation is not implemented: ${slug}`);
    }
  },
};

function adapters(options?: PackInstallOptions): PackInstallAdapters {
  return { ...DEFAULT_ADAPTERS, ...(options?.adapters ?? {}) };
}

function addDependencyIssue(
  issues: PackInstallIssue[],
  kind: PackDependencyKind,
  slug: string,
  required: boolean,
  message: string,
): void {
  issues.push(issue(required ? 'error' : 'warning', kind, slug, message));
}

function validateDependency(
  issues: PackInstallIssue[],
  kind: PackDependencyKind,
  slug: string,
  required: boolean,
  options?: PackInstallOptions,
): void {
  if (kind === 'external') {
    addDependencyIssue(issues, kind, slug, required, `External dependency "${slug}" must be configured.`);
    return;
  }
  const exists = adapters(options).exists(kind, slug, options);
  if (exists === 'unsupported') {
    addDependencyIssue(issues, kind, slug, required, `${kind} dependency "${slug}" is declared but ${kind} activation is not implemented yet.`);
    return;
  }
  if (!exists) {
    addDependencyIssue(issues, kind, slug, required, `${kind} dependency "${slug}" is missing from the global library.`);
  }
}

export function buildPackInstallPlan(
  packSlug: string,
  options?: PackInstallOptions,
): PackInstallPlan {
  const profile = options?.profile ?? 'main';
  const pack = loadGlobalPack(packSlug, options);
  if (!pack) {
    return {
      packSlug,
      profile,
      activate: { agents: [], skills: [], sources: [], workflows: [], automations: [] },
      issues: [issue('error', 'pack', packSlug, `Pack "${packSlug}" was not found.`)],
    };
  }

  const profileExists = !pack.metadata.profiles || profile === 'main' || !!pack.metadata.profiles[profile];
  const activation = mergeActivation(pack, profile);
  const issues: PackInstallIssue[] = [];
  if (!profileExists) {
    issues.push(issue('error', 'profile', profile, `Profile "${profile}" is not defined by pack "${packSlug}".`));
  }

  for (const slug of activation.agents ?? []) {
    validateDependency(issues, 'agent', slug, true, options);
  }
  for (const slug of activation.skills ?? []) {
    validateDependency(issues, 'skill', slug, true, options);
  }
  for (const slug of activation.sources ?? []) {
    validateDependency(issues, 'source', slug, true, options);
  }
  for (const slug of activation.workflows ?? []) {
    validateDependency(issues, 'workflow', slug, true, options);
  }
  for (const slug of activation.automations ?? []) {
    issues.push(issue('warning', 'automation', slug, 'Automation activation is declared but not implemented yet.'));
  }

  for (const dep of pack.metadata.dependencies ?? []) {
    const before = issues.length;
    validateDependency(issues, dep.kind, dep.slug, dep.required !== false, options);
    if (dep.note && issues.length > before) issues[issues.length - 1]!.message = dep.note;
  }

  return {
    packSlug,
    profile,
    activate: {
      agents: activation.agents ?? [],
      skills: activation.skills ?? [],
      sources: activation.sources ?? [],
      workflows: activation.workflows ?? [],
      automations: activation.automations ?? [],
    },
    ...(activation.automations?.length ? { requiresSetup: { automations: activation.automations } } : {}),
    guardrails: pack.metadata.guardrails,
    runtime: pack.metadata.runtime,
    issues,
  };
}

export function installPack(
  workspaceRootPath: string,
  packSlug: string,
  options?: PackInstallOptions,
): PackInstallResult {
  const plan = buildPackInstallPlan(packSlug, options);
  const blocking = plan.issues.filter((item) => item.severity === 'error');
  if (blocking.length) {
    throw new Error(`Cannot install pack "${packSlug}": ${blocking.map((item) => item.message).join(' ')}`);
  }

  const adapter = adapters(options);
  const snapshot = adapter.snapshot(workspaceRootPath);
  let packManifest: { active: ActivatedPacksManifestEntry[] };
  try {
    for (const slug of plan.activate.agents) adapter.activate('agent', workspaceRootPath, slug, plan.profile);
    for (const slug of plan.activate.skills) adapter.activate('skill', workspaceRootPath, slug, plan.profile);
    for (const slug of plan.activate.sources) adapter.activate('source', workspaceRootPath, slug, plan.profile);
    for (const slug of plan.activate.workflows) adapter.activate('workflow', workspaceRootPath, slug, plan.profile);
    packManifest = setPackActive(workspaceRootPath, packSlug, true, plan.profile);
  } catch (error) {
    try {
      adapter.restore(workspaceRootPath, snapshot);
    } catch (rollbackError) {
      const main = error instanceof Error ? error.message : String(error);
      const rollback = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      throw new Error(`Pack install failed and rollback failed. Install error: ${main}. Rollback error: ${rollback}`);
    }
    throw error;
  }

  return {
    ...plan,
    installed: {
      agents: plan.activate.agents,
      skills: plan.activate.skills,
      sources: plan.activate.sources,
      workflows: plan.activate.workflows,
      automations: [],
      packs: packManifest.active,
    },
  };
}
