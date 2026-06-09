import { atom } from 'jotai'
import type { TeamDTO } from '../../shared/types'

export interface TeamsState {
  allTeams: TeamDTO[]
  loading: boolean
  error: string | null
}

export const initialTeamsState: TeamsState = {
  allTeams: [],
  loading: true,
  error: null,
}

export const teamsStateAtom = atom<TeamsState>(initialTeamsState)
