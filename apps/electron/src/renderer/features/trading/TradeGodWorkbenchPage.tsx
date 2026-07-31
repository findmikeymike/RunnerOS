import React, { useCallback, useEffect, useState } from 'react'
import { Activity, AlertTriangle, BrainCircuit, Database, Play, ShieldCheck, Square } from 'lucide-react'
import { CANONICAL_ORDER_FLOW_CONFIGURATION, type HealthResponse, type OrderFlowArtifact, type OrderFlowInterpretation } from '@trade-god/contracts'

type RuntimeState = 'checking' | 'ready' | 'error'

const fixtureInput = {
  fixture: {
    id: 'es-demo-2026-07-11',
    sha256: 'ccf7063cf2b19a0e876b3117860d823e55f06af683714f857633bf05f40cb774',
  },
  instrument: {
    id: 'CME:ESU6', symbol: 'ESU6', venue: 'XCME', asset_class: 'future' as const,
    currency: 'USD', tick_size: '0.25', multiplier: '50',
  },
  session: { exchange_timezone: 'America/Chicago', session_id: '2026-07-11-synthetic' },
  analysis: CANONICAL_ORDER_FLOW_CONFIGURATION,
  timeoutMs: 5_000,
}

const TradeGodWorkbenchPage: React.FC = () => {
  const [runtimeState, setRuntimeState] = useState<RuntimeState>('checking')
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [artifact, setArtifact] = useState<OrderFlowArtifact | null>(null)
  const [interpretation, setInterpretation] = useState<OrderFlowInterpretation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [interpreting, setInterpreting] = useState(false)
  const [cancellationId, setCancellationId] = useState<string | null>(null)
  const [canceling, setCanceling] = useState(false)

  useEffect(() => {
    let active = true
    window.electronAPI.getTradeGodHealth()
      .then((result) => {
        if (!active) return
        setHealth(result)
        setRuntimeState(result.state === 'ready' ? 'ready' : 'error')
      })
      .catch((cause) => {
        if (!active) return
        setError(cause instanceof Error ? cause.message : String(cause))
        setRuntimeState('error')
      })
    return () => { active = false }
  }, [])

  const runFixture = useCallback(async () => {
    const runCancellationId = `workbench-${crypto.randomUUID()}`
    const runTraceId = `trace-workbench-${crypto.randomUUID()}`
    setRunning(true)
    setCancellationId(runCancellationId)
    setError(null)
    setInterpretation(null)
    try {
      setArtifact(await window.electronAPI.analyzeTradeGodFixture({ ...fixtureInput, cancellationId: runCancellationId, traceId: runTraceId }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRunning(false)
      setCancellationId(null)
      setCanceling(false)
    }
  }, [])

  const runSpecialist = useCallback(async () => {
    setInterpreting(true)
    setError(null)
    try {
      const runId = crypto.randomUUID()
      setInterpretation(await window.electronAPI.interpretTradeGodFixture({
        analysis: {
          ...fixtureInput,
          cancellationId: `specialist-${runId}`,
          traceId: `trace-specialist-workbench-${runId}`,
        },
        context: {
          snapshotId: `snapshot-specialist-workbench-${runId}`,
          intervalNs: '20000000000',
          watermarkNs: '1783780230000000000',
          staleAfterNs: '5000000000',
          sessionWindow: {
            session_window_schema_version: 'market-session-window@1',
            session_id: '2026-07-11-synthetic',
            exchange_timezone: 'America/Chicago',
            calendar_id: 'trade-god-synthetic',
            calendar_version: '1.0.0',
            trade_date: '2026-07-11',
            kind: 'synthetic',
            segments: [{ open_ns: '1783780200000000000', close_ns: '1783780260000000000' }],
          },
          recentTradeLimit: 4,
          closedCandleLimit: 2,
        },
        assignment: {
          question: 'What does this tiny sample support, what does it not support, and what fresh evidence would change the read?',
          horizon: 'immediate',
        },
      }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setInterpreting(false)
    }
  }, [])

  const cancelFixture = useCallback(async () => {
    if (!cancellationId || canceling) return
    setCanceling(true)
    try {
      await window.electronAPI.cancelTradeGodAnalysis(cancellationId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setCanceling(false)
    }
  }, [canceling, cancellationId])

  const statusLabel = runtimeState === 'checking' ? 'Checking runtime' : runtimeState === 'ready' ? 'Ready' : 'Unavailable'

  return (
    <div className="runneros-glass-route h-full overflow-y-auto bg-[#07090d] text-white">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-5 px-6 py-6 xl:px-9">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/[0.08] pb-5">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-amber-300/80">
              <Activity className="h-4 w-4" /> Trade God
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Order Flow Engine</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/48">Phase 0 diagnostic workbench. Deterministic evidence only—no broker, live data, or execution capability.</p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-white/[0.09] bg-white/[0.04] px-3 py-2 text-xs text-white/70">
            <span className={`h-2 w-2 rounded-full ${runtimeState === 'ready' ? 'bg-emerald-400' : runtimeState === 'error' ? 'bg-red-400' : 'animate-pulse bg-amber-300'}`} />
            {statusLabel}
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[1.1fr_1.9fr]">
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-5">
            <div className="flex items-center gap-2 text-sm font-medium"><Database className="h-4 w-4 text-sky-300" /> Synthetic ES fixture</div>
            <dl className="mt-5 grid grid-cols-2 gap-4 text-xs">
              <Metric label="Instrument" value="CME:ESU6" />
              <Metric label="Session" value="2026-07-11 RTH" />
              <Metric label="Events" value="4" />
              <Metric label="Mode" value="Replay fixture" />
            </dl>
            {running ? (
              <button type="button" onClick={cancelFixture} disabled={canceling} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-red-300 px-4 py-3 text-sm font-semibold text-black transition hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-50">
                <Square className="h-4 w-4" /> {canceling ? 'Canceling…' : 'Cancel analysis'}
              </button>
            ) : (
              <button type="button" onClick={runFixture} disabled={runtimeState !== 'ready'} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-300 px-4 py-3 text-sm font-semibold text-black transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-35">
                <Play className="h-4 w-4" /> Run ES fixture
              </button>
            )}
            <div className="mt-4 flex items-start gap-2 text-xs leading-5 text-white/38"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /> Project-owned synthetic data. Checksum verified before analysis.</div>
          </div>

          <div className="min-h-[260px] rounded-2xl border border-white/[0.08] bg-[#0b0e14] p-5">
            <div className="flex items-center justify-between"><h2 className="text-sm font-medium">Validated artifact</h2><span className="font-mono text-[10px] text-white/32">{artifact?.artifact_schema_version ?? 'waiting'}</span></div>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Metric label="Total volume" value={artifact?.summary.total_volume ?? '—'} large />
              <Metric label="Delta" value={artifact?.summary.delta ?? '—'} large />
              <Metric label="Point of control" value={artifact?.summary.point_of_control_price ?? '—'} large />
              <Metric label="Buy volume" value={artifact?.summary.buy_volume ?? '—'} />
              <Metric label="Sell volume" value={artifact?.summary.sell_volume ?? '—'} />
              <Metric label="Quality" value={artifact?.quality.state ?? '—'} />
            </div>
            <div className="mt-5 border-t border-white/[0.07] pt-4 font-mono text-[10px] leading-5 text-white/32">
              <div>trace: {artifact?.meta.trace_id ?? '—'}</div>
              <div>source: {artifact ? String('fixture_sha256' in artifact.input ? artifact.input.fixture_sha256 : artifact.input.source_sha256) : '—'}</div>
              <div>content: {artifact?.content_hash ?? '—'}</div>
              <div>producer: {health?.meta.producer.name ?? '—'} {health?.meta.producer.version ?? ''}</div>
            </div>
            <button type="button" onClick={runSpecialist} disabled={!artifact || interpreting} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-sky-300/20 bg-sky-300/[0.09] px-4 py-3 text-sm font-semibold text-sky-100 transition hover:bg-sky-300/[0.14] disabled:cursor-not-allowed disabled:opacity-35">
              <BrainCircuit className="h-4 w-4" /> {interpreting ? 'Running GPT specialist…' : 'Run GPT specialist'}
            </button>
          </div>
        </section>

        {interpretation ? (
          <section className="rounded-2xl border border-sky-300/15 bg-sky-300/[0.045] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-medium"><BrainCircuit className="h-4 w-4 text-sky-300" /> Specialist interpretation</div>
              <span className="font-mono text-[10px] text-white/40">{interpretation.model.provider_model}</span>
            </div>
            {interpretation.status === 'analyzed' ? (
              <div className="mt-4 space-y-4 text-sm leading-6 text-white/68">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Metric label="Classification" value={interpretation.thesis.classification} />
                  <Metric label="Confidence" value={String(interpretation.thesis.confidence)} />
                  <Metric label="Evidence quality" value={interpretation.quality.state} />
                </div>
                <p>{interpretation.thesis.rationale}</p>
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.14em] text-white/38">Alternative hypothesis</div>
                  <p className="mt-1">{interpretation.alternative_hypotheses[0]?.hypothesis ?? '—'}</p>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.14em] text-white/38">Why no trade instruction</div>
                  <p className="mt-1">{interpretation.no_trade_reasons.join(' ')}</p>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-white/68">{interpretation.refusal.reason}</p>
            )}
          </section>
        ) : null}

        {error ? <div className="flex items-start gap-3 rounded-xl border border-red-400/20 bg-red-400/[0.07] p-4 text-sm text-red-100"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div><div className="font-medium">Runtime failure</div><div className="mt-1 text-xs text-red-100/65">{error}</div></div></div> : null}
      </div>
    </div>
  )
}

const Metric: React.FC<{ label: string; value: string; large?: boolean }> = ({ label, value, large }) => (
  <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
    <dt className="text-[10px] uppercase tracking-[0.14em] text-white/34">{label}</dt>
    <dd className={`mt-2 font-mono text-white/82 ${large ? 'text-lg' : 'text-xs'}`}>{value}</dd>
  </div>
)

export default TradeGodWorkbenchPage
