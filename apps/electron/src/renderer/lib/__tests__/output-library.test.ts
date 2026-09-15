import { describe, expect, test } from 'bun:test'
import { createOutputLibraryLoadGate, outputLibraryPlan, isVisibleLibraryOutput, outputLibraryKey, outputLibraryStatus, outputLibraryTargets, releaseKitOutputKeys } from '../output-library'
import type { OutputSummaryDTO } from '../../hooks/useOutputs'
import type { ReleaseKitItem } from '@craft-agent/shared/release-kit'

const output: OutputSummaryDTO = { id: 'same-id', title: 'Useful draft', kind: 'collection', status: 'published', createdAt: '2026-09-15', origin: { source: 'session', sessionId: 'chat' } }
const workspaces = [{ id: 'hq', name: 'HQ' }, { id: 'campaign', name: 'Campaign' }, { id: 'remote', name: 'Remote', remoteServer: {} }]

describe('Output library boundaries', () => {
  test('owner is part of identity, including delimiter-like ids', () => {
    expect(outputLibraryKey('hq', 'same-id')).not.toBe(outputLibraryKey('campaign', 'same-id'))
    expect(outputLibraryKey('a:b', 'c')).not.toBe(outputLibraryKey('a', 'b:c'))
  })
  test('local aggregation excludes remote routes; remote aggregation is active-only', () => {
    expect(outputLibraryTargets(workspaces, 'hq').map((w) => w.id)).toEqual(['hq', 'campaign'])
    expect(outputLibraryTargets(workspaces, 'remote').map((w) => w.id)).toEqual(['remote'])
    expect(outputLibraryTargets(workspaces, 'remote', 'hq')).toEqual([])
    expect(outputLibraryTargets(workspaces, 'hq', 'campaign').map((w) => w.id)).toEqual(['campaign'])
  })
  test('only automatic session boards are hidden, not useful collections or renamed drafts', () => {
    expect(isVisibleLibraryOutput(output)).toBe(true)
    expect(isVisibleLibraryOutput({ ...output, title: 'Session board' })).toBe(true)
    expect(isVisibleLibraryOutput({ ...output, tags: ['visual-board'] })).toBe(true)
    expect(isVisibleLibraryOutput({ ...output, tags: ['visual-board', 'session-board'] })).toBe(false)
    expect(isVisibleLibraryOutput({ ...output, origin: { source: 'manual' }, tags: ['visual-board', 'session-board'] })).toBe(true)
  })
  test('saved published Outputs do not imply external publication or Final', () => {
    expect(outputLibraryStatus(output)).toBe('Ready for review')
    expect(outputLibraryStatus(output, true)).toBe('Final')
    expect(outputLibraryStatus({ ...output, status: 'failed' }, true)).toBe('Failed')
  })
  test('copied HQ snapshots mark their owner, and unrelated/unready items do not mark Finals', () => {
    const ready = { campaignId: 'campaign', status: 'ready', source: { type: 'output', outputId: 'same-id', sourceWorkspaceId: 'hq' } } as ReleaseKitItem
    expect(releaseKitOutputKeys('campaign', [ready])).toEqual([outputLibraryKey('hq', 'same-id')])
    expect(releaseKitOutputKeys('campaign', [{ ...ready, status: 'missing' }, { ...ready, campaignId: 'different' }])).toEqual([])
    expect(releaseKitOutputKeys('campaign', [{ ...ready, source: { type: 'legacy-final', outputId: 'same-id' } } as ReleaseKitItem])).toEqual([outputLibraryKey('campaign', 'same-id')])
  })
})


describe('Output library refresh ownership', () => {
  test('HQ scope reads only HQ outputs but includes permitted campaign Finals metadata', () => {
    const plan = outputLibraryPlan(workspaces, 'hq', 'hq')
    expect(plan.outputs.map((w) => w.id)).toEqual(['hq'])
    expect(plan.kits.map((w) => w.id)).toEqual(['campaign'])
    const remotePlan = outputLibraryPlan(workspaces, 'remote')
    expect(remotePlan.outputs.map((w) => w.id)).toEqual(['remote'])
    expect(remotePlan.kits).toEqual([])
  })
  test('a late request cannot replace a newer owner or survive unmount', async () => {
    const gate = createOutputLibraryLoadGate()
    let resolveOld!: (value: string) => void
    const values: string[] = []
    const old = gate.run(() => new Promise<string>((resolve) => { resolveOld = resolve }), (v) => values.push(v))
    await gate.run(async () => 'current', (v) => values.push(v))
    resolveOld('old'); await old
    expect(values).toEqual(['current'])
    let resolveUnmounted!: (value: string) => void
    const unmounted = gate.run(() => new Promise<string>((resolve) => { resolveUnmounted = resolve }), (v) => values.push(v))
    gate.invalidate(); resolveUnmounted('unmounted'); await unmounted
    expect(values).toEqual(['current'])
  })
})
