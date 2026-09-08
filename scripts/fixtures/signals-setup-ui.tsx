import React from 'react'
import { createRoot } from 'react-dom/client'
import { SignalLinksDialog, SignalTrackSetupDialog } from '../../apps/electron/src/renderer/components/app-shell/SignalTrackSetupDialog'
import { SignalsTracksPanel, type SignalsTracksPanelProps } from '../../apps/electron/src/renderer/components/app-shell/SignalsTracksPanel'
import type { SignalChannel, SignalMode, SignalState, SignalTrack, SignalTrackConfig } from '../../packages/shared/src/shared-intel/signal-contracts'

export type FixtureMode = 'setup' | 'links' | 'panel-empty' | 'panel-one' | 'panel-two' | 'panel-legacy' | 'panel-malformed' | 'panel-zero-channels'

const channel = (letter: string, name: string): SignalChannel => ({
  channelId: 'UC' + letter.repeat(22), url: 'https://www.youtube.com/channel/UC' + letter.repeat(22),
  name, priority: 'medium', notes: '',
})
const channels = { industry: channel('A', 'Industry Briefing'), world: channel('B', 'Studio Practice'), alternate: channel('C', 'Creative Process') }
const config = (track: SignalTrack, source: SignalChannel): SignalTrackConfig => ({
  version: 1, track, enabled: true, cadence: 'weekly', sinceDays: 7, maxPerChannel: 1,
  revision: track + '-initial', updatedAt: '2026-09-08T12:00:00.000Z', sources: [source],
})

const fixture = {
  channels,
  saves: [] as Array<{ config: SignalTrackConfig; adoption: boolean }>,
  resolutions: [] as string[],
  analyses: [] as Array<{ links: string[]; key: string }>,
  starts: [] as Array<{ track: SignalTrack; mode: SignalMode; idempotencyKey: string; links?: string[] }>,
  configWrites: 0, legacyConfigureCalls: 0,
  workflowChecks: 0, failResolve: false,
  replacements: [] as Array<{ workspace: string; event: string; id: string; before: Record<string, unknown>; after: Record<string, unknown> }>,
  failSave: false, failAnalyze: true, holdResolve: false,
  finishResolve: null as null | (() => void),
  closed: false,
  removeLegacySchedule: () => { automations.automations.SchedulerTick = [] },
  reset: (_mode: FixtureMode = 'setup') => {},
}
declare global { interface Window { signalsSetupFixture: typeof fixture } }
window.signalsSetupFixture = fixture

let panelState: SignalState
const legacyMatcher = { id: 'legacy-weekly', name: 'Existing Industry scan', enabled: true, cron: '0 9 * * 5', timezone: 'America/Chicago', permissionMode: 'safe',
  actions: [{ type: 'queue-work', title: 'Industry scan', ownerScope: 'hq', execution: { type: 'workflow-run', workflowSlug: 'weekly-signal-scan', workflowDigest: 'keep-this-digest', triggerInputs: { artist_name: 'Fixture artist' } } }],
}
let automations: { automations: { SchedulerTick: Array<Record<string, unknown>> } }
// Only the host/provider boundary is mocked; the real useSignalTracks and
// useSignalReportContent hooks drive the panel, refreshes, and one-off routing.
window.electronAPI = {
  getSignalState: async () => structuredClone(panelState),
  getAutomations: async () => structuredClone(automations),
  onWorkspaceContextChanged: () => () => {},
  onAutomationsChanged: () => () => {},
  resolveSignalChannel: async (_workspace: string, url: string) => {
    fixture.resolutions.push(url)
    if (fixture.failResolve) throw new Error('Fixture channel provider unavailable.')
    return structuredClone(channels.industry)
  },
  replaceAutomation: async (workspace: string, event: string, id: string, before: Record<string, unknown>, after: Record<string, unknown>) => {
    const current = automations.automations.SchedulerTick.find(item => item.id === id)
    if (JSON.stringify(current) !== JSON.stringify(before)) throw new Error('Fixture CAS mismatch')
    fixture.replacements.push(structuredClone({ workspace, event, id, before, after }))
    automations.automations.SchedulerTick = automations.automations.SchedulerTick.map(item => item.id === id ? after : item)
  },
  saveSignalConfig: async (_workspace: string, track: SignalTrack, next: SignalTrackConfig) => {
    fixture.configWrites++
    panelState.tracks[track] = { ...next, revision: track + '-panel-saved' }
    return structuredClone(panelState)
  },
  startSignalResearch: async (_workspace: string, input: typeof fixture.starts[number]) => {
    fixture.starts.push(structuredClone(input))
    return { hqWorkspaceId: 'fixture-hq', runId: 'fixture-run', orderIds: ['fixture-order'], reused: false }
  },
  readOutputAssetText: async () => '# Industry research\n\nIndependent releases benefit from clear audience goals and consistent follow-through.',
} as unknown as typeof window.electronAPI

const ensureWorkflow = async () => { fixture.workflowChecks++; return 'fixture-approved-digest' }
const getOutput: SignalsTracksPanelProps['getOutput'] = async id => ({ id, primaryAssetId: 'report.md' } as Awaited<ReturnType<SignalsTracksPanelProps['getOutput']>>)
function PanelHarness({ mode }: { mode: FixtureMode }) {
  const count = mode === 'panel-two' ? 2 : mode === 'panel-one' ? 1 : 0
  const outputs = Array.from({ length: count }, (_, index) => ({
    id: `fixture-report-${index}`, title: index ? 'Earlier industry research' : 'Independent release research',
    summary: 'A focused overview of audience development and release planning.', status: 'published',
    createdAt: `2026-09-0${8 - index}T12:00:00.000Z`, tags: ['research'], origin: { source: 'manual' },
  })) as SignalsTracksPanelProps['outputs']
  return <main style={{ maxWidth: 1120, margin: '0 auto', padding: 20 }}>
    <SignalsTracksPanel workspaceId="fixture-hq" workspaceName="Fixture artist" outputs={outputs} documents={[]}
      getOutput={getOutput} ensureWorkflow={ensureWorkflow} onSaveNugget={async () => {}}
      legacy={{ config: { version: 1, enabled: true, cadence: 'weekly', updatedAt: '2026-09-08T12:00:00.000Z', sources: [{ ...channels.industry, id: 'legacy-industry' }], sinceDays: 7, maxPerChannel: 1 },
        busy: false, weeklyEnabled: mode === 'panel-legacy' || mode === 'panel-malformed', onRun: async () => {}, onToggleWeekly: async () => {},
        onConfigure: () => { fixture.legacyConfigureCalls++ } }} />
  </main>
}

function Harness({ mode }: { mode: 'setup' | 'links' }) {
  const [open, setOpen] = React.useState(true)
  const [configs, setConfigs] = React.useState(() => ({ industry: config('industry', channels.industry), 'your-world': config('your-world', channels.world) }))
  const onOpenChange = (value: boolean) => { fixture.closed = !value; setOpen(value) }
  return mode === 'links'
    ? <SignalLinksDialog open={open} trackName="Your World" onOpenChange={onOpenChange} onAnalyze={async (links, key) => {
      fixture.analyses.push({ links: [...links], key })
      if (fixture.failAnalyze) throw new Error('Fixture queue unavailable. Retry this report.')
    }} />
    : <SignalTrackSetupDialog open={open} configs={configs} initialTrack="industry" adoptIndustry={false}
      nextRuns={{ industry: 'Friday, September 11 at 9:00 AM', 'your-world': 'Monday, September 14 at 10:00 AM' }}
      onOpenChange={onOpenChange} resolveChannel={async url => {
        fixture.resolutions.push(url)
        const source = url.includes('@alternate') ? channels.alternate
          : url.includes('@industry') || url === channels.industry.url ? channels.industry
          : url.includes('@world') || url === channels.world.url ? channels.world : undefined
        if (!source) throw new Error('Channel could not be resolved.')
        if (fixture.holdResolve) await new Promise<void>(resolve => { fixture.finishResolve = resolve })
        return structuredClone(source)
      }} onSave={async (next, adoption) => {
        fixture.saves.push({ config: structuredClone(next), adoption })
        if (fixture.failSave) throw new Error('Fixture save unavailable. Retry settings.')
        const saved = { ...next, revision: next.track + '-saved-' + fixture.saves.length }
        setConfigs(previous => ({ ...previous, [next.track]: saved }))
        return saved
      }} />
}

const root = createRoot(document.getElementById('root')!)
let generation = 0
fixture.reset = (mode = 'setup') => {
  fixture.saves = []; fixture.resolutions = []; fixture.analyses = []
  fixture.starts = []; fixture.configWrites = 0; fixture.legacyConfigureCalls = 0
  fixture.replacements = []; fixture.workflowChecks = 0; fixture.failResolve = false
  fixture.failSave = false; fixture.failAnalyze = true; fixture.holdResolve = false
  fixture.finishResolve = null; fixture.closed = false
  panelState = { hqWorkspaceId: 'fixture-hq', runs: [], tracks: {
    industry: { ...config('industry', channels.industry), enabled: false, cadence: 'manual', revision: mode === 'panel-legacy' || mode === 'panel-malformed' ? 'initial' : 'industry-ready' },
    'your-world': { ...config('your-world', channels.world), enabled: false, cadence: 'manual' },
  } }
  if (mode === 'panel-malformed') panelState.legacyIndustry = { requiresReview: true, configBody: '{malformed legacy config' }
  if (mode === 'panel-zero-channels') {
    panelState.tracks.industry.sources = []
    panelState.tracks['your-world'].sources = []
  }
  automations = { automations: { SchedulerTick: mode === 'panel-legacy' || mode === 'panel-malformed' ? [structuredClone(legacyMatcher)] : [] } }
  root.render(mode === 'setup' || mode === 'links' ? <Harness key={++generation} mode={mode} /> : <PanelHarness key={++generation} mode={mode} />)
}
