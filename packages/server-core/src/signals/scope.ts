import { getWorkspaces } from '@craft-agent/shared/config';
import type { Workspace } from '@craft-agent/core/types';

/** Sole-HQ compatibility rule; never choose the first of multiple artist HQs. */
export function resolveSignalHqWorkspace(workspaceId: string, all: Workspace[] = getWorkspaces()): Workspace {
  const requested = all.find(workspace => workspace.id === workspaceId);
  if (!requested || requested.remoteServer) throw new Error('Signals requires a local artist workspace.');
  if (requested.artistWorkspaceScope === 'hq') return requested;
  if (requested.artistWorkspaceScope !== 'campaign') throw new Error('Signals requires Artist HQ or a linked campaign.');
  const hqs = all.filter(workspace => workspace.artistWorkspaceScope === 'hq' && !workspace.remoteServer);
  if (hqs.length !== 1) throw new Error('Link this campaign to an unambiguous Artist HQ before using Signals.');
  return hqs[0]!;
}
