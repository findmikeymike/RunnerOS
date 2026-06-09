/**
 * Teams — types
 *
 * A Team is a saved group of agents with one lead, specialist members, and
 * explicit coordination rules. V1 stores definitions globally as TEAM.md files.
 */

import type { PermissionMode } from '../agent/mode-types.ts';
import { AGENT_SLUG_REGEX } from '../agent-definitions/types.ts';

export type TeamDefinitionSource = 'global';

export type TeamVerificationMode = 'off' | 'advisory' | 'blocking';

export type TeamRiskAction =
  | 'publish'
  | 'spend'
  | 'customer_message'
  | 'code_change'
  | 'deploy'
  | 'delete'
  | 'refund'
  | 'external_action';

export interface TeamVerificationPolicy {
  default: TeamVerificationMode;
  requiredFor?: TeamRiskAction[];
}

export interface TeamMemberDefinition {
  /** Agent slug for this member. */
  slug: string;
  /** Human-readable job in this team. */
  role: string;
  /** Optional source slugs this member expects to use. */
  requiredSources?: string[];
}

export interface TeamMetadata {
  name: string;
  description: string;
  /** Single emoji shown in pickers. */
  avatar?: string;
  /** Lead agent slug. */
  lead: string;
  members: TeamMemberDefinition[];
  /** Reusable long-lived team. */
  standing?: boolean;
  /** Default permission mode for team-launched sessions. */
  permissionMode?: PermissionMode;
  verification?: TeamVerificationPolicy;
}

export type TeamParseWarningCode =
  | 'invalid-avatar'
  | 'invalid-standing'
  | 'invalid-permission-mode'
  | 'invalid-member-sources'
  | 'invalid-verification'
  | 'unknown-field';

export interface TeamParseWarning {
  field: keyof TeamMetadata | 'member' | 'verification' | 'unknown';
  code: TeamParseWarningCode;
  message: string;
}

export interface LoadedTeam {
  /** Filesystem slug and @-mention identifier. */
  slug: string;
  metadata: TeamMetadata;
  /** Markdown body below frontmatter. */
  body: string;
  /** Absolute path to the team directory. */
  path: string;
  source: TeamDefinitionSource;
  parseWarnings?: TeamParseWarning[];
}

export const TEAM_SLUG_REGEX = AGENT_SLUG_REGEX;
export const TEAM_FILE = 'TEAM.md';

