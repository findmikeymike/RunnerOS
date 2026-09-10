import type { SessionToolFilterOptions } from '@craft-agent/session-tools-core';

/** Role/scope policy shared by backend adapters; runtime and backend flags stay local. */
export type SessionRoleToolFilterOptions = Required<Pick<SessionToolFilterOptions,
  | 'includeScheduleWork'
  | 'includeSupplyWorkInput'
  | 'includeManagerTools'
  | 'includeCampaignManagerTools'
  | 'includeLabTools'
  | 'includeSocialVariantTools'
  | 'includeSocialVariantQueryTools'
>>;

export function deriveSessionToolFilterOptions(
  agentSlug: string | undefined,
  artistWorkspaceScope: string | undefined,
): SessionRoleToolFilterOptions {
  const isManager = agentSlug === 'concierge';
  return {
    includeScheduleWork: isManager,
    includeSupplyWorkInput: isManager,
    includeManagerTools: isManager && (artistWorkspaceScope === 'hq' || artistWorkspaceScope === 'campaign'),
    includeCampaignManagerTools: isManager && artistWorkspaceScope === 'campaign',
    includeLabTools: artistWorkspaceScope === 'lab',
    includeSocialVariantTools: agentSlug === 'raw-video-editor',
    includeSocialVariantQueryTools: isManager || agentSlug === 'social-publisher',
  };
}
