import type { PermissionRequest, Session } from '../../shared/types'

/** A response begun before a newer approval event/response/Stop must not restore stale UI. */
export function hydratePendingPermissions(
  current: Map<string, PermissionRequest[]>,
  sessions: Pick<Session, 'id' | 'workspaceId' | 'isProcessing' | 'pendingPermissions'>[],
  workspaceId: string,
  startedVersions: ReadonlyMap<string, number>,
  currentVersions: ReadonlyMap<string, number>,
): Map<string, PermissionRequest[]> {
  const next = new Map(current)
  for (const session of sessions) {
    if (session.workspaceId !== workspaceId || session.pendingPermissions === undefined) continue
    if ((startedVersions.get(session.id) ?? 0) !== (currentVersions.get(session.id) ?? 0)) continue
    const requests = session.isProcessing
      ? session.pendingPermissions.filter(request => request.sessionId === session.id)
      : []
    if (requests.length) next.set(session.id, requests)
    else next.delete(session.id)
  }
  return next
}
