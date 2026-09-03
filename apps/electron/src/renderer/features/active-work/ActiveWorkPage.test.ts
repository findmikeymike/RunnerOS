import { describe, expect, test } from 'bun:test'
import type { ActiveWorkItem } from './types'
import { countStaleInputRequests } from './build-active-work-items'

describe('ActiveWorkPage helpers', () => {
  test('counts only input requests waiting at least one week', () => {
    const item = (id: string, requestedAt?: string): ActiveWorkItem => ({
      id, source: 'scheduled-work', sourceId: id, workspaceId: 'hq', section: 'attention',
      title: id, statusLabel: 'Needs setup', openTarget: { kind: 'scheduled-work', id },
      inputRequest: requestedAt ? {
        id: `${id}:input`, inputs: ['brief'], requestedAt, lastTriggeredAt: requestedAt,
        coalescedFireCount: 1, fireDefinitionDigests: ['fire'],
      } : undefined,
    })
    const now = Date.parse('2026-09-09T12:00:00.000Z')
    expect(countStaleInputRequests([
      item('old', '2026-09-02T12:00:00.000Z'),
      item('recent', '2026-09-03T12:00:00.001Z'),
      item('other'),
    ], now)).toBe(1)
  })
})
