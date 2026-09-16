import { describe, expect, test } from 'bun:test'
import { SessionManager, createManagedSession } from './SessionManager'
import type { PermissionRequest } from '@craft-agent/shared/protocol'

function fixture() {
  const manager = new SessionManager()
  const session = createManagedSession({ id: 'manager', name: 'Manager' }, { id: 'hq', name: 'HQ', rootPath: '/tmp/permission-restoration-unused', createdAt: 1 } as never, { messagesLoaded: true })
  session.isProcessing = true
  const delivered: unknown[] = []
  session.agent = { respondToPermission: (...args: unknown[]) => delivered.push(args) } as never
  const internals = manager as unknown as {
    sessions: Map<string, typeof session>
    pendingPermissionRequests: Map<string, { sessionId: string; request: PermissionRequest }>
    clearPendingPermissionRequestsForSession: (id: string) => void
  }
  internals.sessions.set(session.id, session)
  const request = { sessionId: session.id, requestId: 'pending-1', type: 'mcp_mutation', toolName: 'schedule_work', description: 'Schedule the report', command: 'schedule_work' } as PermissionRequest
  internals.pendingPermissionRequests.set(request.requestId, { sessionId: session.id, request })
  return { manager, session, internals, request, delivered }
}

describe('live pending permission snapshots', () => {
  test('workspace list and session reload restore the full request while another workspace cannot list it', async () => {
    const { manager, request } = fixture()
    expect(manager.getSessions('campaign')).toEqual([])
    expect(manager.getSessions('hq')[0]?.pendingPermissions).toEqual([request])
    expect((await manager.getSession('manager'))?.pendingPermissions).toEqual([request])
  })
  test('answered requests are removed and cannot be answered again', async () => {
    const { manager, request, delivered } = fixture()
    expect(manager.respondToPermission('manager', request.requestId, true, false)).toBe(true)
    expect((await manager.getSession('manager'))?.pendingPermissions).toEqual([])
    expect(manager.respondToPermission('manager', request.requestId, true, false)).toBe(false)
    expect(delivered).toHaveLength(1)
  })
  test('Stop clears pending requests even when the processing flag is already idle', async () => {
    const { manager, session, internals, request } = fixture()
    session.isProcessing = false
    await manager.cancelProcessing('manager')
    expect(internals.pendingPermissionRequests.size).toBe(0)
    expect((await manager.getSession('manager'))?.pendingPermissions).toEqual([])
    expect(manager.respondToPermission('manager', request.requestId, true, false)).toBe(false)
  })
  test('a different session cannot answer or consume the request', () => {
    const { manager, session, internals, request, delivered } = fixture()
    internals.sessions.set('other', { ...session, id: 'other' })
    expect(manager.respondToPermission('other', request.requestId, true, false)).toBe(false)
    expect(internals.pendingPermissionRequests.has(request.requestId)).toBe(true)
    expect(delivered).toHaveLength(0)
  })
})
