/**
 * Skills Types
 *
 * Type definitions for workspace skills.
 * Skills are specialized instructions that extend Claude's capabilities.
 */

import type { SkillCategoryId } from './categories.ts';

export {
  isSkillCategoryId,
  SKILL_CATEGORIES,
  SKILL_CATEGORY_IDS,
  SKILL_CATEGORY_LABELS,
  UNCATEGORIZED_SKILL_CATEGORY_ID,
  normalizeSkillCategory,
  normalizeSkillTags,
  classifySkillCategory,
} from './categories.ts';
export type { SkillCategoryId } from './categories.ts';

/**
 * Skill metadata from SKILL.md YAML frontmatter
 */
export interface SkillMetadata {
  /** Display name for the skill */
  name: string;
  /** Brief description shown in skill list */
  description: string;
  /** Optional category from frontmatter, or inferred by storage when loaded */
  category?: SkillCategoryId;
  /** Optional normalized tags for filtering and classification */
  tags?: string[];
  /** Optional file patterns that trigger this skill */
  globs?: string[];
  /** Optional tools to always allow when skill is active */
  alwaysAllow?: string[];
  /**
   * Optional icon - emoji or URL only.
   * - Emoji: rendered directly in UI (e.g., "🔧")
   * - URL: auto-downloaded to icon.{ext} file
   * Note: Relative paths and inline SVG are NOT supported.
   */
  icon?: string;
  /** Optional source slugs to auto-enable when this skill is invoked */
  requiredSources?: string[];
}

/** Source of a loaded skill */
export type SkillSource = 'global' | 'workspace' | 'project';

/**
 * Plugin name for project-level and global skills.
 *
 * The SDK derives plugin names from `path.basename()` of the registered plugin
 * directory. Both `{project}/.agents/` and `~/.agents/` share the basename
 * `.agents`, so skills from either tier resolve to `.agents:skillSlug`.
 */
export const AGENTS_PLUGIN_NAME = '.agents';

/**
 * A loaded skill with parsed content
 */
export interface LoadedSkill {
  /** Scoped saved-reference identities; never sourced from frontmatter. */
  aliases?: string[];
  /** Set only by trusted managed resolution, never from user frontmatter. */
  managed?: ManagedSkillIdentity;
  /** Directory name (slug) */
  slug: string;
  /** Parsed metadata from YAML frontmatter */
  metadata: SkillMetadata;
  /** Full SKILL.md content (without frontmatter) */
  content: string;
  /** Absolute path to icon file if exists */
  iconPath?: string;
  /** Absolute path to skill directory */
  path: string;
  /** Where this skill was loaded from */
  source: SkillSource;
}

/** Public catalog contract. Instruction bodies and filesystem paths never cross it. */
export interface SkillDescriptor {
  aliases?: string[];
  /** Missing managed parent with retained personal instructions. */
  available?: false;
  id: string;
  slug: string;
  metadata: Pick<SkillMetadata, 'name' | 'description' | 'category' | 'tags' | 'icon' | 'requiredSources'>;
  source: SkillSource;
  origin: 'managed' | 'user';
  revision?: string;
  capabilities: { canRead: boolean; canEdit: boolean; canExport: boolean; canDelete: boolean; canListFiles: boolean };
}

export interface ManagedSkillIdentity { id: string; revision: string }
export type PersonalInstructionScope = 'shared' | 'workspace';
export interface PersonalInstruction {
  id: string;
  parentManagedId: string;
  scope: PersonalInstructionScope;
  /** Stable existing workspace root identity; omitted for shared instructions. */
  workspaceRoot?: string;
  text: string;
  enabled: boolean;
  updatedAt: string;
  reviewedCoreRevision: string;
}
