import { AGENT_SLUG_REGEX } from '../agent-definitions/types.ts';

export type PackDefinitionSource = 'global';

export type PackProfileSlug = 'main' | 'personal-ops' | 'runner-os-core' | string;

export type PackDependencyKind = 'agent' | 'skill' | 'source' | 'workflow' | 'automation' | 'external';

export type PackPermissionMode = 'safe' | 'ask' | 'allow-all';

export interface PackDependency {
  kind: PackDependencyKind;
  slug: string;
  required?: boolean;
  note?: string;
}

export interface PackActivationBundle {
  agents?: string[];
  skills?: string[];
  sources?: string[];
  workflows?: string[];
  automations?: string[];
}

export interface PackProfile extends PackActivationBundle {
  description?: string;
  permissionMode?: PackPermissionMode;
  startupContext?: string[];
}

export interface PackGuardrails {
  permissionMode?: PackPermissionMode;
  requiresApprovalFor?: string[];
  blockedTools?: string[];
  notes?: string[];
}

export interface PackRuntime {
  startupContext?: string[];
  environment?: Record<string, string>;
}

export interface PackMetadata extends PackActivationBundle {
  name: string;
  description: string;
  version: string;
  category?: string;
  owner?: string;
  tags?: string[];
  profiles?: Record<string, PackProfile>;
  dependencies?: PackDependency[];
  guardrails?: PackGuardrails;
  runtime?: PackRuntime;
}

export interface PackParseWarning {
  field: keyof PackMetadata | 'profile' | 'dependency';
  code: string;
  message: string;
}

export interface LoadedPack {
  slug: string;
  metadata: PackMetadata;
  body: string;
  path: string;
  source: PackDefinitionSource;
  parseWarnings?: PackParseWarning[];
}

export interface ActivatedPacksManifestEntry {
  slug: string;
  profile: PackProfileSlug;
  activatedAt: string;
}

export interface ActivatedPacksManifest {
  version: 1;
  active: ActivatedPacksManifestEntry[];
  updatedAt: string;
}

export interface PackInstallIssue {
  severity: 'error' | 'warning';
  kind: PackDependencyKind | 'pack' | 'profile';
  slug: string;
  message: string;
}

export interface PackInstallPlan {
  packSlug: string;
  profile: PackProfileSlug;
  activate: Required<Pick<PackActivationBundle, 'agents' | 'skills' | 'sources' | 'workflows' | 'automations'>>;
  requiresSetup?: {
    automations: string[];
  };
  guardrails?: PackGuardrails;
  runtime?: PackRuntime;
  issues: PackInstallIssue[];
}

export interface PackInstallResult extends PackInstallPlan {
  installed: {
    agents: string[];
    skills: string[];
    sources: string[];
    workflows: string[];
    automations: string[];
    packs: ActivatedPacksManifestEntry[];
  };
}

export const PACK_FILE = 'PACK.md';
export const PACK_SLUG_REGEX = AGENT_SLUG_REGEX;
