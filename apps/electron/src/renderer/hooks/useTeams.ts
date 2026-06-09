import { useCallback, useEffect, useMemo } from 'react'
import { useAtom } from 'jotai'
import { teamsStateAtom } from '@/atoms/teams'
import type { TeamDTO, TeamMetadataDTO } from '../../shared/types'

export interface UseTeamsResult {
  allTeams: TeamDTO[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  upsert: (input: {
    slug: string
    metadata: TeamMetadataDTO
    body: string
  }) => Promise<TeamDTO>
  remove: (slug: string) => Promise<boolean>
}

let loaded = false
let inFlightRefresh: Promise<void> | null = null
let listenerCleanup: (() => void) | null = null
let mountedCount = 0

function sortTeams(teams: TeamDTO[]): TeamDTO[] {
  return [...teams].sort((a, b) => a.metadata.name.localeCompare(b.metadata.name))
}

export function useTeams(): UseTeamsResult {
  const [state, setState] = useAtom(teamsStateAtom)

  const refresh = useCallback(async () => {
    if (inFlightRefresh) return inFlightRefresh

    inFlightRefresh = (async () => {
      setState((prev) => ({ ...prev, loading: true }))
      try {
        const teams = await window.electronAPI.listAllTeams()
        setState({ allTeams: sortTeams(teams), loading: false, error: null })
        loaded = true
      } catch (err) {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        }))
      } finally {
        inFlightRefresh = null
      }
    })()

    return inFlightRefresh
  }, [setState])

  useEffect(() => {
    if (!loaded) {
      refresh()
    }
  }, [refresh])

  useEffect(() => {
    mountedCount += 1
    if (!listenerCleanup) {
      listenerCleanup = window.electronAPI.onTeamsChanged((teams) => {
        setState((prev) => ({ ...prev, allTeams: sortTeams(teams), loading: false, error: null }))
        loaded = true
      })
    }

    return () => {
      mountedCount -= 1
      if (mountedCount <= 0 && listenerCleanup) {
        listenerCleanup()
        listenerCleanup = null
        mountedCount = 0
      }
    }
  }, [setState])

  const upsert = useCallback(async (input: {
    slug: string
    metadata: TeamMetadataDTO
    body: string
  }): Promise<TeamDTO> => {
    const saved = await window.electronAPI.upsertTeam(input)
    setState((prev) => {
      const next = prev.allTeams.filter((team) => team.slug !== saved.slug)
      next.push(saved)
      return { ...prev, allTeams: sortTeams(next) }
    })
    return saved
  }, [setState])

  const remove = useCallback(async (slug: string) => {
    const ok = await window.electronAPI.deleteTeam(slug)
    if (ok) {
      setState((prev) => ({ ...prev, allTeams: prev.allTeams.filter((team) => team.slug !== slug) }))
    }
    return ok
  }, [setState])

  const allTeams = useMemo(() => state.allTeams, [state.allTeams])

  return {
    allTeams,
    loading: state.loading,
    error: state.error,
    refresh,
    upsert,
    remove,
  }
}
