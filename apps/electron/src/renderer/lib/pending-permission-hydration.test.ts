import { describe, expect, test } from 'bun:test'
import { hydratePendingPermissions } from './pending-permission-hydration'
import type { PermissionRequest } from '../../shared/types'
const request = { sessionId: 'manager', requestId: 'approval-1', toolName: 'schedule_work', description: 'Schedule work', type: 'mcp_mutation' } as PermissionRequest
const snapshot = { id: 'manager', workspaceId: 'hq', isProcessing: true, pendingPermissions: [request] }
const versions = new Map<string, number>()
describe('pending approval hydration', () => {
  test('restores an approval cleared by workspace switching or emitted while away', () => {
    const returned = hydratePendingPermissions(new Map(), [snapshot], 'hq', versions, versions)
    expect(returned.get('manager')).toEqual([request])
    expect(hydratePendingPermissions(returned, [snapshot], 'hq', versions, versions).get('manager')).toHaveLength(1)
  })
  test('does not expose another workspace or a mismatched session request', () => {
    expect(hydratePendingPermissions(new Map(), [snapshot], 'campaign', versions, versions).size).toBe(0)
    expect(hydratePendingPermissions(new Map(), [{ ...snapshot, pendingPermissions: [{ ...request, sessionId: 'other' }] }], 'hq', versions, versions).size).toBe(0)
  })
  test('cannot resurrect an answered or stopped approval from an older in-flight snapshot', () => {
    expect(hydratePendingPermissions(new Map(), [snapshot], 'hq', versions, new Map([['manager', 1]])).size).toBe(0)
  })
  test('does not overwrite a newer live request with an older empty snapshot', () => {
    const live = new Map([['manager', [request]]])
    expect(hydratePendingPermissions(live, [{ ...snapshot, pendingPermissions: [] }], 'hq', versions, new Map([['manager', 1]])).get('manager')).toEqual([request])
  })
  test('authoritative settled snapshots clear approvals, without inventing state for older hosts', () => {
    const live = new Map([['manager', [request]]])
    expect(hydratePendingPermissions(live, [{ ...snapshot, pendingPermissions: [] }], 'hq', versions, versions).size).toBe(0)
    expect(hydratePendingPermissions(live, [{ ...snapshot, isProcessing: false }], 'hq', versions, versions).size).toBe(0)
    expect(hydratePendingPermissions(live, [{ ...snapshot, pendingPermissions: undefined }], 'hq', versions, versions).get('manager')).toEqual([request])
  })
})
