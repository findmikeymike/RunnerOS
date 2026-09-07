import { signalWorkflowFor, type SignalMode, type SignalRunSummary, type SignalState, type SignalTrack, type SignalTrackConfig } from '@craft-agent/shared/shared-intel'
import type { OutputSummaryDTO } from '../hooks/useOutputs'
import type { AutomationListItem } from '../components/automations/types'
import type { ArtistIntelConfig, ArtistIntelSource } from './artist-intel'

export const signalTrackName = (track: SignalTrack) => track === 'industry' ? 'Industry' : 'Your World'
export const signalScheduleKey = (hq: string, track: SignalTrack) => `signals:${hq}:${track}:weekly`

export function signalWeeklyReadiness(config: SignalTrackConfig | undefined, matcher: { enabled: boolean } | undefined): { active: boolean; needsRepair: boolean } {
  const configured = config?.enabled === true && config.cadence === 'weekly'
  return { active: matcher?.enabled === true && configured, needsRepair: matcher?.enabled === true && !configured }
}

export function signalOutputRun(output: OutputSummaryDTO, state: SignalState): SignalRunSummary | undefined {
  if (output.kind !== 'report' || output.status !== 'published' || !(output.primaryAssetId || output.primary?.id)
    || (output.workspaceId && output.workspaceId !== state.hqWorkspaceId) || output.tags?.includes('signal-source-packet')) return
  return state.runs.find(run => run.outputId === output.id && ['report', 'partial'].includes(run.status)
    && !!run.workflowRunId && output.origin?.source === 'workflow'
    && output.origin.workflowRunId === run.workflowRunId && output.origin.stepId === 'synthesize'
    && output.origin.workflowSlug === signalWorkflowFor(run.track, run.mode))
}

export function signalDefaultKey(items: Array<{ key: string; mode?: SignalMode }>, selected: string | null): string | null {
  if (selected && items.some(item => item.key === selected)) return selected
  return items.find(item => item.mode === 'scan')?.key ?? items[0]?.key ?? null
}

export function signalScheduleMatches(item: AutomationListItem, hq: string, track: SignalTrack): boolean {
  return item.event === 'SchedulerTick' && (item.rawMatcher?.templateKey === signalScheduleKey(hq, track)
    || item.actions.some(action => action.type === 'queue-work' && action.execution.type === 'workflow-run'
      && action.execution.workflowSlug === signalWorkflowFor(track, 'scan')
      && action.execution.triggerInputs?.track === track))
}

export function legacySignalSchedule(item: AutomationListItem): boolean {
  return item.event === 'SchedulerTick' && item.actions.some(action =>
    (action.type === 'queue-work' && ((action.execution.type === 'workflow-run' && action.execution.workflowSlug === 'weekly-signal-scan')
      || (action.execution.type === 'agent-task' && action.execution.agentSlug === 'youtube-intelligence-agent')))
    || (action.type === 'prompt' && action.agentSlug === 'youtube-research-agent' && /artist-intel-config|youtube intel pulse/i.test(action.prompt)))
}

export function signalWeeklyMatcher(hq: string, track: SignalTrack, digest: string, enabled: boolean, previous?: Record<string, unknown>): Record<string, unknown> {
  return {
    ...previous, templateKey: signalScheduleKey(hq, track), name: `${signalTrackName(track)} weekly scan`,
    enabled, timezone: previous?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    permissionMode: previous?.permissionMode ?? 'safe',
    actions: [{ type: 'queue-work', ownerScope: 'hq', calendarVisibility: 'hidden', title: `${signalTrackName(track)} scan`,
      intentId: signalScheduleKey(hq, track), execution: { type: 'workflow-run', workflowSlug: signalWorkflowFor(track, 'scan'), workflowDigest: digest,
        triggerInputs: { signalContract: 'signals-v1', track, mode: 'scan' } } }],
  }
}

export function assertSignalScheduleCanRewrite(item: Pick<AutomationListItem, 'actions'> | undefined, rewriteExecution: boolean): void {
  if (item && rewriteExecution && item.actions.length !== 1) throw new Error('This schedule has custom actions. Review it in Work before enabling or re-saving Signals. Pausing preserves its actions.')
}

/** Preserve the original rows, including explicit emptiness; legacy normalizers refill defaults. */
export function legacySignalSources(body: string | null | undefined, fallback: ArtistIntelConfig): ArtistIntelSource[] {
  if (!body?.trim()) return fallback.sources.map(source => ({ ...source }))
  const raw = body.match(/```json\s*([\s\S]*?)```/i)?.[1] ?? body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1)
  let data: unknown
  try { data = JSON.parse(raw) } catch { throw new Error('Existing Industry settings are unreadable. Repair them before adopting the update.') }
  const config = data as Partial<ArtistIntelConfig>
  if (config.version !== 1 || !Array.isArray(config.sources)) throw new Error('Existing Industry settings need review before adoption.')
  if (config.sources.length > 20) throw new Error('Industry has more than 20 channels. Choose a bounded selection in existing settings before adopting.')
  if (config.sources.some(source => !source || typeof source.url !== 'string' || !source.url.trim() || typeof source.name !== 'string' || !source.name.trim())) throw new Error('An existing Industry channel is incomplete. Repair it in existing settings first.')
  return config.sources.map(source => ({ ...source }))
}

/** Roll back against the revision we actually wrote, never against a concurrent edit. */
export async function saveSignalSettingsTransaction(input: {
  previous: SignalTrackConfig; next: SignalTrackConfig;
  save: (config: SignalTrackConfig, revision: string) => Promise<SignalState>;
  schedule: () => Promise<void>;
}): Promise<SignalState> {
  const saved = await input.save(input.next, input.previous.revision)
  try { await input.schedule(); return saved } catch (error) {
    try { await input.save(input.previous, saved.tracks[input.next.track].revision) }
    catch (rollback) { throw new Error(`Schedule update failed: ${String(error)}. Settings could not be restored: ${String(rollback)}. Reload before retrying.`) }
    throw error
  }
}
