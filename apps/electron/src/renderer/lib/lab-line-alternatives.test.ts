import { describe, expect, test } from 'bun:test'
import type { LabSongLineAlternativeGroup } from '@craft-agent/shared/lab'
import {
  buildLineTargets,
  matchLineAlternativeGroups,
  promoteLineAlternative,
} from './lab-line-alternatives'

describe('Lab line alternatives', () => {
  test('keeps alternatives attached when their lyric line moves', () => {
    const group = alternativeGroup({ anchorText: 'Window down', lineIndex: 0 })
    const matches = matchLineAlternativeGroups('New first line\nWindow down', [group], 'rough')

    expect(matches.get(1)?.id).toBe(group.id)
    expect(matches.get(0)).toBeUndefined()
  })

  test('keeps alternatives at the same row when the primary line is revised', () => {
    const group = alternativeGroup({ anchorText: 'Window down', lineIndex: 1 })
    const matches = matchLineAlternativeGroups('First line\nWindows down', [group], 'rough')

    expect(matches.get(1)?.id).toBe(group.id)
  })

  test('distinguishes duplicate lyric lines by occurrence', () => {
    const targets = buildLineTargets('Stay\nLeave\nStay', 'section', 'chorus')

    expect(targets[0]?.occurrence).toBe(0)
    expect(targets[2]?.occurrence).toBe(1)
  })

  test('promotes an alternate without losing the current line', () => {
    const group = alternativeGroup({
      anchorText: 'Window down',
      lineIndex: 0,
      alternatives: [{ id: 'alt-1', text: 'Windows open', createdAt: '2026-08-29T00:00:00.000Z' }],
    })
    const promoted = promoteLineAlternative(group, 'alt-1', 'Window down', '2026-08-30T00:00:00.000Z')

    expect(promoted.primaryLine).toBe('Windows open')
    expect(promoted.group.anchorText).toBe('Windows open')
    expect(promoted.group.alternatives).toEqual([
      { id: 'alt-1', text: 'Window down', createdAt: '2026-08-30T00:00:00.000Z' },
    ])
  })
})

function alternativeGroup(overrides: Partial<LabSongLineAlternativeGroup> = {}): LabSongLineAlternativeGroup {
  return {
    id: 'group-1',
    source: 'rough',
    anchorText: 'Window down',
    lineIndex: 0,
    occurrence: 0,
    alternatives: [],
    updatedAt: '2026-08-29T00:00:00.000Z',
    ...overrides,
  }
}
