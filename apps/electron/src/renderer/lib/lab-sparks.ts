import type { LabSpark, LabSparkKind } from '@craft-agent/shared/lab'

export type LabSparkKindFilter = LabSparkKind | 'all'

export interface LabSparkFilters {
  query: string
  kind: LabSparkKindFilter
  tag: string | 'all'
}

export function parseSparkTags(value: string): string[] {
  return Array.from(new Set(value
    .split(/[,#\n]+/)
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)))
}

export function filterLabSparks(sparks: LabSpark[], filters: LabSparkFilters): LabSpark[] {
  const query = filters.query.trim().toLowerCase()
  return sparks
    .filter((spark) => filters.kind === 'all' || spark.kind === filters.kind)
    .filter((spark) => filters.tag === 'all' || spark.tags.includes(filters.tag))
    .filter((spark) => {
      if (!query) return true
      return `${spark.text} ${spark.kind} ${spark.tags.join(' ')}`.toLowerCase().includes(query)
    })
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    })
}
