import { atom } from 'jotai'
import { atomFamily } from 'jotai-family'
import type { TeamRunDetail, TeamRunSnapshot, TeamRunTick } from '../../shared/types'

export interface TeamRunsState {
  runs: TeamRunSnapshot[]
  detailsById: Record<string, TeamRunDetail>
  ticksByRunId: Record<string, TeamRunTick[]>
  loading: boolean
  error: string | null
}

export const initialTeamRunsState: TeamRunsState = {
  runs: [],
  detailsById: {},
  ticksByRunId: {},
  loading: true,
  error: null,
}

export const teamRunsStateAtomFamily = atomFamily(
  (workspaceId: string) => atom<TeamRunsState>(initialTeamRunsState),
  (a, b) => a === b,
)
