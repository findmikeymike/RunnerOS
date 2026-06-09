import { atom } from 'jotai'
import { atomFamily } from 'jotai-family'
import type { TeamRunDetail, TeamRunSnapshot } from '../../shared/types'

export interface TeamRunsState {
  runs: TeamRunSnapshot[]
  detailsById: Record<string, TeamRunDetail>
  loading: boolean
  error: string | null
}

export const initialTeamRunsState: TeamRunsState = {
  runs: [],
  detailsById: {},
  loading: true,
  error: null,
}

export const teamRunsStateAtomFamily = atomFamily(
  (workspaceId: string) => atom<TeamRunsState>(initialTeamRunsState),
  (a, b) => a === b,
)
