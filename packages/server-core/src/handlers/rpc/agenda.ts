import { getWorkspaceByNameOrId } from '@craft-agent/shared/config';
import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import type { AddAgendaTaskCommentInput } from '@craft-agent/shared/agenda';
import type { RpcServer } from '@craft-agent/server-core/transport';
import type { HandlerDeps } from '../handler-deps';

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.agenda.GET_TASK_THREAD,
  RPC_CHANNELS.agenda.ADD_TASK_COMMENT,
  RPC_CHANNELS.agenda.DELETE_TASK_THREAD,
] as const;

function resolveWorkspace(workspaceId: string): { rootPath: string } {
  const workspace = getWorkspaceByNameOrId(workspaceId);
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
  return workspace;
}

export function registerAgendaHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.agenda.GET_TASK_THREAD, async (_ctx, workspaceId: string, taskId: string) => {
    const workspace = resolveWorkspace(workspaceId);
    const [{ getTeamModeStatus }, { readAgendaTaskThread }] = await Promise.all([
      import('@craft-agent/shared/workspaces'),
      import('@craft-agent/shared/agenda'),
    ]);
    const status = getTeamModeStatus(workspace.rootPath);
    if (!status.team.enabled || !status.joined) return null;
    return readAgendaTaskThread(workspace.rootPath, taskId);
  });

  server.handle(RPC_CHANNELS.agenda.ADD_TASK_COMMENT, async (
    _ctx,
    workspaceId: string,
    taskId: string,
    input: AddAgendaTaskCommentInput,
  ) => {
    const workspace = resolveWorkspace(workspaceId);
    const [{ assertTeamPermission, getTeamModeStatus }, { addAgendaTaskComment }] = await Promise.all([
      import('@craft-agent/shared/workspaces'),
      import('@craft-agent/shared/agenda'),
    ]);
    assertTeamPermission(workspace.rootPath, 'records.write');
    const status = getTeamModeStatus(workspace.rootPath);
    return addAgendaTaskComment(
      workspace.rootPath,
      status.machine.machineId,
      status.currentMember?.displayName ?? status.machine.displayName,
      taskId,
      { id: input.commentId, body: input.body },
    );
  });

  server.handle(RPC_CHANNELS.agenda.DELETE_TASK_THREAD, async (_ctx, workspaceId: string, taskId: string) => {
    const workspace = resolveWorkspace(workspaceId);
    const [{ assertTeamPermission, getTeamModeStatus }, { deleteAgendaTaskThread }] = await Promise.all([
      import('@craft-agent/shared/workspaces'),
      import('@craft-agent/shared/agenda'),
    ]);
    assertTeamPermission(workspace.rootPath, 'records.write');
    const status = getTeamModeStatus(workspace.rootPath);
    deleteAgendaTaskThread(workspace.rootPath, status.machine.machineId, taskId);
  });
}
