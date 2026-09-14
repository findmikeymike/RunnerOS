export const CREATOR_SYSTEM_SKILL_SLUGS = [
  'agent-creator',
  'automation-creator',
  'workflow-creator',
  'skill-scout',
  'source-recipe',
] as const;

export const CONCIERGE_SYSTEM_SKILL_SLUGS = [
  ...CREATOR_SYSTEM_SKILL_SLUGS,
  'artist-manager-operating-system',
  'artist-os-guide',
  'runneros-self-edit',
] as const;

export const SETUP_SYSTEM_SKILL_SLUGS = ['setup-models', 'setup-tools', 'setup-socials', 'setup-brain', 'setup-people'] as const;

export const SYSTEM_GLOBAL_SKILL_SLUGS = [
  ...SETUP_SYSTEM_SKILL_SLUGS,
  ...CONCIERGE_SYSTEM_SKILL_SLUGS,
] as const;

export function isSystemGlobalSkillSlug(slug: string): boolean {
  return (SYSTEM_GLOBAL_SKILL_SLUGS as readonly string[]).includes(slug);
}
