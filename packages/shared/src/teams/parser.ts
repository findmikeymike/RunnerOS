import matter from 'gray-matter';
import type { PermissionMode } from '../agent/mode-types.ts';
import { AGENT_SLUG_REGEX } from '../agent-definitions/types.ts';
import {
  type TeamMemberDefinition,
  type TeamMetadata,
  type TeamParseWarning,
  type TeamRiskAction,
  type TeamVerificationMode,
  type TeamVerificationPolicy,
} from './types.ts';

const VALID_PERMISSION_MODES: ReadonlyArray<PermissionMode> = ['safe', 'ask', 'allow-all'];
const VALID_VERIFICATION_MODES: ReadonlyArray<TeamVerificationMode> = ['off', 'advisory', 'blocking'];
const VALID_RISK_ACTIONS: ReadonlyArray<TeamRiskAction> = [
  'publish',
  'spend',
  'customer_message',
  'code_change',
  'deploy',
  'delete',
  'refund',
  'external_action',
];

const KNOWN_FIELDS = new Set([
  'name',
  'description',
  'avatar',
  'lead',
  'members',
  'standing',
  'permissionMode',
  'verification',
]);

function warning(
  field: TeamParseWarning['field'],
  code: TeamParseWarning['code'],
  message: string,
): TeamParseWarning {
  return { field, code, message };
}

function coercePermissionMode(value: unknown, warnings: TeamParseWarning[]): PermissionMode | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string' || !(VALID_PERMISSION_MODES as ReadonlyArray<string>).includes(value)) {
    warnings.push(warning('permissionMode', 'invalid-permission-mode', `permissionMode must be one of: ${VALID_PERMISSION_MODES.join(', ')}.`));
    return undefined;
  }
  return value as PermissionMode;
}

function coerceSources(value: unknown, warnings: TeamParseWarning[], memberSlug: string): string[] | undefined | null {
  if (value == null) return undefined;
  const candidates = typeof value === 'string' ? [value] : Array.isArray(value) ? value : null;
  if (!candidates) {
    warnings.push(warning('member', 'invalid-member-sources', `member "${memberSlug}" requiredSources must be a string or string array.`));
    return undefined;
  }
  const out = Array.from(
    new Set(
      candidates
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter(Boolean),
    ),
  );
  if (out.length !== candidates.length) {
    warnings.push(warning('member', 'invalid-member-sources', `member "${memberSlug}" ignored invalid requiredSources entries.`));
  }
  return out.length > 0 ? out : undefined;
}

function coerceMembers(value: unknown, lead: string, warnings: TeamParseWarning[]): TeamMemberDefinition[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const seen = new Set<string>();
  const members: TeamMemberDefinition[] = [];

  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const entry = raw as Record<string, unknown>;
    const slug = typeof entry.slug === 'string' ? entry.slug.trim() : '';
    const role = typeof entry.role === 'string' ? entry.role.trim() : '';
    if (!slug || !AGENT_SLUG_REGEX.test(slug)) return null;
    if (!role) return null;
    if (slug === lead) return null;
    if (seen.has(slug)) return null;
    const requiredSources = coerceSources(entry.requiredSources, warnings, slug);
    if (requiredSources === null) return null;
    const member: TeamMemberDefinition = { slug, role };
    if (requiredSources) member.requiredSources = requiredSources;
    members.push(member);
    seen.add(slug);
  }

  return members;
}

function coerceVerification(value: unknown, warnings: TeamParseWarning[]): TeamVerificationPolicy | undefined | null {
  if (value == null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    warnings.push(warning('verification', 'invalid-verification', 'verification must be an object.'));
    return null;
  }

  const raw = value as Record<string, unknown>;
  const defaultMode = typeof raw.default === 'string' ? raw.default.trim() : 'advisory';
  if (!(VALID_VERIFICATION_MODES as ReadonlyArray<string>).includes(defaultMode)) {
    warnings.push(warning('verification', 'invalid-verification', `verification.default must be one of: ${VALID_VERIFICATION_MODES.join(', ')}.`));
    return null;
  }

  const policy: TeamVerificationPolicy = { default: defaultMode as TeamVerificationMode };
  if (raw.requiredFor !== undefined) {
    if (!Array.isArray(raw.requiredFor)) {
      warnings.push(warning('verification', 'invalid-verification', 'verification.requiredFor must be an array.'));
      return null;
    }
    const requiredFor: TeamRiskAction[] = [];
    for (const entry of raw.requiredFor) {
      if (typeof entry !== 'string' || !(VALID_RISK_ACTIONS as ReadonlyArray<string>).includes(entry)) {
        warnings.push(warning('verification', 'invalid-verification', `verification.requiredFor entries must be one of: ${VALID_RISK_ACTIONS.join(', ')}.`));
        return null;
      }
      requiredFor.push(entry as TeamRiskAction);
    }
    policy.requiredFor = Array.from(new Set(requiredFor));
  }

  return policy;
}

export function parseTeamFile(
  content: string,
): { metadata: TeamMetadata; body: string; warnings: TeamParseWarning[] } | null {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(content);
  } catch {
    return null;
  }

  const data = parsed.data as Record<string, unknown>;
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const description = typeof data.description === 'string' ? data.description.trim() : '';
  const lead = typeof data.lead === 'string' ? data.lead.trim() : '';
  if (!name || !description || !lead || !AGENT_SLUG_REGEX.test(lead)) return null;

  const warnings: TeamParseWarning[] = [];
  for (const key of Object.keys(data)) {
    if (!KNOWN_FIELDS.has(key)) {
      warnings.push(warning('unknown', 'unknown-field', `Unknown team field "${key}" was ignored.`));
    }
  }

  const members = coerceMembers(data.members, lead, warnings);
  if (!members) return null;

  const avatar = typeof data.avatar === 'string' ? data.avatar.trim() || undefined : undefined;
  if (data.avatar !== undefined && typeof data.avatar !== 'string') {
    warnings.push(warning('avatar', 'invalid-avatar', 'avatar must be a string.'));
  }

  let standing: boolean | undefined;
  if (data.standing !== undefined) {
    if (typeof data.standing === 'boolean') {
      standing = data.standing;
    } else {
      warnings.push(warning('standing', 'invalid-standing', 'standing must be a boolean.'));
    }
  }

  const permissionMode = coercePermissionMode(data.permissionMode, warnings);
  const verification = coerceVerification(data.verification, warnings);
  if (verification === null) return null;

  return {
    metadata: {
      name,
      description,
      avatar,
      lead,
      members,
      standing,
      permissionMode,
      verification,
    },
    body: parsed.content.trim(),
    warnings,
  };
}

export function serializeTeam(metadata: TeamMetadata, body: string): string {
  validateSerializableTeamMetadata(metadata);
  const data: Record<string, unknown> = {
    name: metadata.name,
    description: metadata.description,
    lead: metadata.lead,
    members: metadata.members.map((member) => {
      const out: Record<string, unknown> = { slug: member.slug, role: member.role };
      if (member.requiredSources && member.requiredSources.length > 0) {
        out.requiredSources = member.requiredSources;
      }
      return out;
    }),
  };
  if (metadata.avatar) data.avatar = metadata.avatar;
  if (metadata.standing !== undefined) data.standing = metadata.standing;
  if (metadata.permissionMode) data.permissionMode = metadata.permissionMode;
  if (metadata.verification) data.verification = metadata.verification;
  return matter.stringify(body.trimEnd() + '\n', data);
}

function validateSerializableTeamMetadata(metadata: TeamMetadata): void {
  if (!metadata.name.trim()) throw new Error('Team name is required.');
  if (!metadata.description.trim()) throw new Error('Team description is required.');
  if (!AGENT_SLUG_REGEX.test(metadata.lead)) throw new Error(`Invalid lead agent slug: "${metadata.lead}".`);
  if (!metadata.members.length) throw new Error('Team must include at least one member.');
  if (metadata.permissionMode && !(VALID_PERMISSION_MODES as ReadonlyArray<string>).includes(metadata.permissionMode)) {
    throw new Error(`Invalid team permission mode: "${metadata.permissionMode}".`);
  }
  const seen = new Set<string>();
  for (const member of metadata.members) {
    if (!AGENT_SLUG_REGEX.test(member.slug)) throw new Error(`Invalid team member slug: "${member.slug}".`);
    if (!member.role.trim()) throw new Error(`Team member "${member.slug}" role is required.`);
    if (member.slug === metadata.lead) throw new Error(`Lead agent "${metadata.lead}" should not also be listed as a member.`);
    if (seen.has(member.slug)) throw new Error(`Duplicate team member slug: "${member.slug}".`);
    seen.add(member.slug);
  }
  if (metadata.verification) {
    if (!(VALID_VERIFICATION_MODES as ReadonlyArray<string>).includes(metadata.verification.default)) {
      throw new Error(`Invalid verification default: "${metadata.verification.default}".`);
    }
    for (const action of metadata.verification.requiredFor ?? []) {
      if (!(VALID_RISK_ACTIONS as ReadonlyArray<string>).includes(action)) {
        throw new Error(`Invalid verification risk action: "${action}".`);
      }
    }
  }
}

