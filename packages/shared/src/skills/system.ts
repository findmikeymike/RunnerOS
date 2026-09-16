export const CREATOR_SYSTEM_SKILL_SLUGS = [
  'agent-creator',
  'automation-creator',
  'workflow-creator',
  'skill-scout',
  'source-recipe',
] as const;

/** Artist OS construction ownership; registration remains independent of recipients. */
export const BUILDER_SYSTEM_SKILL_SLUGS = [...CREATOR_SYSTEM_SKILL_SLUGS, 'skill-recipe'] as const;
export const ARTIST_MANAGER_SYSTEM_SKILL_SLUGS = ['artist-manager-operating-system', 'artist-os-guide', 'runneros-self-edit'] as const;

/** Generic RunnerOS retains its established concierge capabilities. */
export const CONCIERGE_SYSTEM_SKILL_SLUGS = [
  ...CREATOR_SYSTEM_SKILL_SLUGS,
  'artist-manager-operating-system',
  'artist-os-guide',
  'runneros-self-edit',
] as const;

export const SETUP_SYSTEM_SKILL_SLUGS = ['setup-models', 'setup-tools', 'setup-socials', 'setup-brain', 'setup-people'] as const;

export const SYSTEM_GLOBAL_SKILL_SLUGS = [...new Set([
  ...SETUP_SYSTEM_SKILL_SLUGS,
  ...CONCIERGE_SYSTEM_SKILL_SLUGS,
  ...BUILDER_SYSTEM_SKILL_SLUGS,
])] as const;

export function isSystemGlobalSkillSlug(slug: string): boolean {
  return (SYSTEM_GLOBAL_SKILL_SLUGS as readonly string[]).includes(slug);
}
