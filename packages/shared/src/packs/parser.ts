import matter from 'gray-matter';
import { PACK_SLUG_REGEX, type PackActivationBundle, type PackDependency, type PackGuardrails, type PackMetadata, type PackParseWarning, type PackPermissionMode, type PackProfile, type PackRuntime } from './types.ts';

const VALID_PERMISSION_MODES = new Set<PackPermissionMode>(['safe', 'ask', 'allow-all']);
const VALID_DEPENDENCY_KINDS = new Set(['agent', 'skill', 'source', 'workflow', 'automation', 'external']);

function warn(field: PackParseWarning['field'], code: string, message: string): PackParseWarning {
  return { field, code, message };
}

function stringArray(value: unknown, field: PackParseWarning['field'], warnings: PackParseWarning[]): string[] | undefined {
  const raw = typeof value === 'string' ? [value] : Array.isArray(value) ? value : undefined;
  if (raw === undefined) {
    if (value != null) warnings.push(warn(field, 'invalid-string-array', `${String(field)} must be a string or string array.`));
    return undefined;
  }
  const out = Array.from(new Set(raw
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)));
  return out.length ? out : undefined;
}

function activationBundle(data: Record<string, unknown>, warnings: PackParseWarning[], field: PackParseWarning['field'] = 'profile'): PackActivationBundle {
  return {
    agents: stringArray(data.agents, field, warnings),
    skills: stringArray(data.skills, field, warnings),
    sources: stringArray(data.sources, field, warnings),
    workflows: stringArray(data.workflows, field, warnings),
    automations: stringArray(data.automations, field, warnings),
  };
}

function permissionMode(value: unknown, field: PackParseWarning['field'], warnings: PackParseWarning[]): PackPermissionMode | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string' && VALID_PERMISSION_MODES.has(value as PackPermissionMode)) return value as PackPermissionMode;
  warnings.push(warn(field, 'invalid-permission-mode', 'permissionMode must be safe, ask, or allow-all.'));
  return undefined;
}

function profiles(value: unknown, warnings: PackParseWarning[]): Record<string, PackProfile> | undefined {
  if (value == null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    warnings.push(warn('profiles', 'invalid-profiles', 'profiles must be an object keyed by profile slug.'));
    return undefined;
  }
  const out: Record<string, PackProfile> = {};
  for (const [slug, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!PACK_SLUG_REGEX.test(slug)) {
      warnings.push(warn('profile', 'invalid-profile-slug', `Invalid profile slug: ${slug}`));
      continue;
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      warnings.push(warn('profile', 'invalid-profile', `Profile ${slug} must be an object.`));
      continue;
    }
    const data = raw as Record<string, unknown>;
    out[slug] = {
      ...activationBundle(data, warnings),
      description: typeof data.description === 'string' ? data.description : undefined,
      permissionMode: permissionMode(data.permissionMode, 'profile', warnings),
      startupContext: stringArray(data.startupContext, 'profile', warnings),
    };
  }
  return Object.keys(out).length ? out : undefined;
}

function dependencies(value: unknown, warnings: PackParseWarning[]): PackDependency[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value)) {
    warnings.push(warn('dependencies', 'invalid-dependencies', 'dependencies must be an array.'));
    return undefined;
  }
  const out: PackDependency[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      warnings.push(warn('dependency', 'invalid-dependency', 'Each dependency must be an object.'));
      continue;
    }
    const data = raw as Record<string, unknown>;
    const kind = data.kind;
    const slug = data.slug;
    if (typeof kind !== 'string' || !VALID_DEPENDENCY_KINDS.has(kind)) {
      warnings.push(warn('dependency', 'invalid-dependency-kind', 'Dependency kind is invalid.'));
      continue;
    }
    if (typeof slug !== 'string' || !slug.trim()) {
      warnings.push(warn('dependency', 'invalid-dependency-slug', 'Dependency slug is required.'));
      continue;
    }
    out.push({
      kind: kind as PackDependency['kind'],
      slug: slug.trim(),
      required: typeof data.required === 'boolean' ? data.required : true,
      note: typeof data.note === 'string' ? data.note : undefined,
    });
  }
  return out.length ? out : undefined;
}

function guardrails(value: unknown, warnings: PackParseWarning[]): PackGuardrails | undefined {
  if (value == null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    warnings.push(warn('guardrails', 'invalid-guardrails', 'guardrails must be an object.'));
    return undefined;
  }
  const data = value as Record<string, unknown>;
  return {
    permissionMode: permissionMode(data.permissionMode, 'guardrails', warnings),
    requiresApprovalFor: stringArray(data.requiresApprovalFor, 'guardrails', warnings),
    blockedTools: stringArray(data.blockedTools, 'guardrails', warnings),
    notes: stringArray(data.notes, 'guardrails', warnings),
  };
}

function runtime(value: unknown, warnings: PackParseWarning[]): PackRuntime | undefined {
  if (value == null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    warnings.push(warn('runtime', 'invalid-runtime', 'runtime must be an object.'));
    return undefined;
  }
  const data = value as Record<string, unknown>;
  const environment = data.environment && typeof data.environment === 'object' && !Array.isArray(data.environment)
    ? Object.fromEntries(Object.entries(data.environment as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    : undefined;
  return {
    startupContext: stringArray(data.startupContext, 'runtime', warnings),
    environment,
  };
}

export function parsePackFile(raw: string): { metadata: PackMetadata; body: string; warnings: PackParseWarning[] } | null {
  try {
    const parsed = matter(raw);
    const data = parsed.data as Record<string, unknown>;
    if (typeof data.name !== 'string' || !data.name.trim()) return null;
    if (typeof data.description !== 'string' || !data.description.trim()) return null;
    if (typeof data.version !== 'string' || !data.version.trim()) return null;
    const warnings: PackParseWarning[] = [];
    const metadata: PackMetadata = {
      name: data.name.trim(),
      description: data.description.trim(),
      version: data.version.trim(),
      category: typeof data.category === 'string' ? data.category.trim() : undefined,
      owner: typeof data.owner === 'string' ? data.owner.trim() : undefined,
      tags: stringArray(data.tags, 'tags', warnings),
      ...activationBundle(data, warnings),
      profiles: profiles(data.profiles, warnings),
      dependencies: dependencies(data.dependencies, warnings),
      guardrails: guardrails(data.guardrails, warnings),
      runtime: runtime(data.runtime, warnings),
    };
    return { metadata, body: parsed.content.trim(), warnings };
  } catch {
    return null;
  }
}

export function serializePack(metadata: PackMetadata, body: string): string {
  return matter.stringify(body.trim() ? `${body.trim()}\n` : '', metadata).replace(/\n+$/, '\n');
}
