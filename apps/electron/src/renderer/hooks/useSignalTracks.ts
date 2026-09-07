import { useCallback, useEffect, useRef, useState } from 'react'
import type { SignalMode, SignalState, SignalTrack, SignalTrackConfig } from '@craft-agent/shared/shared-intel'
import { parseAutomationsConfig } from '../components/automations/types'
import type { AutomationListItem } from '../components/automations/types'
import { assertSignalScheduleCanRewrite, legacySignalSchedule, saveSignalSettingsTransaction, signalScheduleMatches, signalWeeklyMatcher } from '../lib/signal-tracks'

export function useSignalTracks(workspaceId: string, ensureWorkflow: (track: SignalTrack, mode: SignalMode) => Promise<string>) {
  const [snapshot, setSnapshot] = useState<{ workspaceId: string; state: SignalState; automations: AutomationListItem[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const scope = useRef(workspaceId)
  scope.current = workspaceId
  const state = snapshot?.workspaceId === workspaceId ? snapshot.state : null
  const automations = snapshot?.workspaceId === workspaceId ? snapshot.automations : []
  const mutation = useRef(false)
  const refresh = useCallback(async () => {
    const request = ++generation.current
    try {
      const [next, raw] = await Promise.all([window.electronAPI.getSignalState(workspaceId), window.electronAPI.getAutomations(workspaceId)])
      if (request !== generation.current || scope.current !== workspaceId) return
      setSnapshot({ workspaceId, state: next, automations: raw ? parseAutomationsConfig(raw) : [] })
      setError(null)
    } catch (cause) {
      if (request === generation.current && scope.current === workspaceId) setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [workspaceId])
  useEffect(() => {
    setError(null)
    void refresh()
    const timer = setInterval(() => { if (!mutation.current) void refresh() }, 5000)
    const cleanupContext = window.electronAPI.onWorkspaceContextChanged((id) => { if (id === workspaceId) void refresh() })
    const cleanupAutomations = window.electronAPI.onAutomationsChanged(() => { void refresh() })
    return () => { generation.current++; clearInterval(timer); cleanupContext(); cleanupAutomations() }
  }, [workspaceId, refresh])

  const save = useCallback(async (next: SignalTrackConfig, adopt: boolean) => {
    if (!state || mutation.current) throw new Error('Signals settings are busy. Try again after refresh.')
    if (next.revision !== state.tracks[next.track].revision) throw new Error('Signals settings changed while editing. Close and reopen settings before saving.')
    const owner = workspaceId
    mutation.current = true; setBusy(true); generation.current++
    try {
      // Refresh automation identities immediately before the CAS update.
      const raw = await window.electronAPI.getAutomations(owner)
      const current = raw ? parseAutomationsConfig(raw) : []
      const matches = current.filter(item => signalScheduleMatches(item, state.hqWorkspaceId, next.track)
        || (adopt && next.track === 'industry' && legacySignalSchedule(item)))
      if (matches.length > 1) throw new Error('Multiple schedules match this track. Review them in Work before changing Signals setup.')
      const existing = matches[0]
      if (existing && !existing.rawMatcher) throw new Error('Schedule revision is unavailable. Reload before saving.')
      const weekly = next.enabled && next.cadence === 'weekly'
      assertSignalScheduleCanRewrite(existing, weekly || adopt)
      const digest = weekly || adopt ? await ensureWorkflow(next.track, 'scan') : ''
      await saveSignalSettingsTransaction({
        previous: state.tracks[next.track], next,
        save: (config, revision) => window.electronAPI.saveSignalConfig(owner, next.track, config, revision),
        schedule: async () => {
          if (existing) {
            const matcher = existing.rawMatcher!
            // Pausing preserves the exact execution/approval snapshot. Enabling is an explicit re-save.
            const replacement = weekly || adopt ? signalWeeklyMatcher(state.hqWorkspaceId, next.track, digest, weekly, matcher) : { ...matcher, enabled: false }
            await window.electronAPI.replaceAutomation(owner, existing.event, existing.id, matcher, replacement)
          } else if (weekly) {
            await window.electronAPI.createAutomationFromTemplate(owner, 'SchedulerTick', signalWeeklyMatcher(state.hqWorkspaceId, next.track, digest, true), { automaticCadence: 'weekly' })
          }
        },
      })
    } finally {
      mutation.current = false
      if (scope.current === owner) { setBusy(false); await refresh() }
    }
  }, [workspaceId, state, ensureWorkflow, refresh])

  const start = useCallback(async (track: SignalTrack, mode: SignalMode, idempotencyKey: string, links?: string[]) => {
    if (mutation.current) throw new Error('Save your settings before starting research.')
    const owner = workspaceId
    mutation.current = true; setBusy(true)
    try {
      await ensureWorkflow(track, mode)
      return await window.electronAPI.startSignalResearch(owner, { track, mode, idempotencyKey, links })
    } finally {
      mutation.current = false
      if (scope.current === owner) { setBusy(false); await refresh() }
    }
  }, [workspaceId, ensureWorkflow, refresh])
  return { state, automations, error, busy, refresh, save, start }
}
