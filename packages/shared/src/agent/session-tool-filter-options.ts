import { RUNTIME_IDENTITY } from '../config/runtime-identity.ts';
import type { SessionToolFilterOptions } from '@craft-agent/session-tools-core';

/** Role/scope policy shared by backend adapters; runtime and backend flags stay local. */
export type SessionRoleToolFilterOptions = Required<Pick<SessionToolFilterOptions,
  | 'includeScheduleWork'
  | 'includeManageGoalRun'
  | 'excludeDefinitionAuthoring'
  | 'includeAutomationMaintenance'
  | 'includeSupplyWorkInput'
  | 'includeManagerTools'
  | 'includeWebsiteCampaignContext'
  | 'includeCampaignManagerTools'
  | 'includeLabTools'
  | 'includeSocialVariantTools'
  | 'includeSocialVariantQueryTools'
>>;

export function deriveSessionToolFilterOptions(
  agentSlug: string | undefined,
  artistWorkspaceScope: string | undefined,
  variant: string = RUNTIME_IDENTITY.variant,
): SessionRoleToolFilterOptions {
  const isManager = agentSlug === 'concierge';
  const isArtistOS = variant === 'artist-os';
  const isBuilder = isArtistOS && agentSlug === 'builder';
  return {
    includeScheduleWork: isManager || isBuilder,
    includeManageGoalRun: isManager,
    excludeDefinitionAuthoring: isArtistOS && ['concierge', 'setup-concierge', 'orchestrator'].includes(agentSlug ?? ''),
    includeAutomationMaintenance: isBuilder,
    includeSupplyWorkInput: isManager,
    includeManagerTools: isManager && (artistWorkspaceScope === 'hq' || artistWorkspaceScope === 'campaign'),
    includeWebsiteCampaignContext: isArtistOS && agentSlug === 'website-agent' && (artistWorkspaceScope === 'hq' || artistWorkspaceScope === 'campaign'),
    includeCampaignManagerTools: isManager && artistWorkspaceScope === 'campaign',
    includeLabTools: artistWorkspaceScope === 'lab',
    includeSocialVariantTools: agentSlug === 'raw-video-editor',
    includeSocialVariantQueryTools: isManager || agentSlug === 'social-publisher',
  };
}
