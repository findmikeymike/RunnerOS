import type {
  LabSongLineAlternativeGroup,
  LabSongLineSource,
} from '@craft-agent/shared/lab'

export interface LabLineTarget {
  source: LabSongLineSource
  sectionId?: string
  lineIndex: number
  anchorText: string
  occurrence: number
}

export function buildLineTargets(
  text: string,
  source: LabSongLineSource,
  sectionId?: string,
): LabLineTarget[] {
  const seen = new Map<string, number>()
  return text.split('\n').map((anchorText, lineIndex) => {
    const occurrence = seen.get(anchorText) ?? 0
    seen.set(anchorText, occurrence + 1)
    return { source, sectionId, lineIndex, anchorText, occurrence }
  })
}

export function matchLineAlternativeGroups(
  text: string,
  groups: LabSongLineAlternativeGroup[],
  source: LabSongLineSource,
  sectionId?: string,
): Map<number, LabSongLineAlternativeGroup> {
  const targets = buildLineTargets(text, source, sectionId)
  const scopedGroups = groups.filter((group) => sameScope(group, source, sectionId))
  const matches = new Map<number, LabSongLineAlternativeGroup>()
  const matchedGroups = new Set<string>()

  for (const target of targets) {
    const exact = scopedGroups.find((group) => (
      !matchedGroups.has(group.id)
      && group.anchorText === target.anchorText
      && group.occurrence === target.occurrence
    ))
    if (!exact) continue
    matches.set(target.lineIndex, exact)
    matchedGroups.add(exact.id)
  }

  for (const group of scopedGroups) {
    if (matchedGroups.has(group.id) || matches.has(group.lineIndex) || !targets[group.lineIndex]) continue
    matches.set(group.lineIndex, group)
    matchedGroups.add(group.id)
  }

  return matches
}

export function promoteLineAlternative(
  group: LabSongLineAlternativeGroup,
  alternativeId: string,
  currentLine: string,
  now = new Date().toISOString(),
): { group: LabSongLineAlternativeGroup; primaryLine: string } {
  const selected = group.alternatives.find((alternative) => alternative.id === alternativeId)
  if (!selected) return { group, primaryLine: currentLine }
  return {
    primaryLine: selected.text,
    group: {
      ...group,
      anchorText: selected.text,
      alternatives: group.alternatives.map((alternative) => alternative.id === alternativeId
        ? { ...alternative, text: currentLine, createdAt: now }
        : alternative),
      updatedAt: now,
    },
  }
}

function sameScope(
  group: LabSongLineAlternativeGroup,
  source: LabSongLineSource,
  sectionId?: string,
): boolean {
  return group.source === source && (source === 'rough' || group.sectionId === sectionId)
}
