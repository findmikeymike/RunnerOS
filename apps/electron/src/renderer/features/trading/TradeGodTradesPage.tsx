import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Clock3, RefreshCw, ShieldCheck } from 'lucide-react'

import type { ExecutionLifecycleState, ExecutionRecord } from '@trade-god/contracts'

const ACTIVE_STATES = new Set<ExecutionLifecycleState>([
  'acknowledged', 'partially-filled', 'filled', 'protecting', 'protected', 'closing',
])
const PENDING_STATES = new Set<ExecutionLifecycleState>([
  'created', 'awaiting-authorization', 'approved', 'claimed', 'submitting',
  'submit-unknown', 'protection-unknown', 'reconcile-halted',
])

type TradeTab = 'active' | 'pending' | 'closed'

const tabForRecord = (record: ExecutionRecord): TradeTab => (
  ACTIVE_STATES.has(record.state) ? 'active' : PENDING_STATES.has(record.state) ? 'pending' : 'closed'
)

const prettyState = (value: string) => value.replaceAll('-', ' ')
const protectionLabel = (leg: { type: 'price' | 'ticks'; value: string }) => (
  leg.type === 'ticks' ? `${leg.value} ticks` : leg.value
)

const formatTime = (value: string) => new Intl.DateTimeFormat(undefined, {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
}).format(new Date(value))

const TradeGodTradesPage: React.FC = () => {
  const [records, setRecords] = useState<ExecutionRecord[]>([])
  const [connectionNames, setConnectionNames] = useState<Record<string, string>>({})
  const [activeTab, setActiveTab] = useState<TradeTab>('active')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [nextRecords, connections] = await Promise.all([
        window.electronAPI.listTradeGodExecutions(),
        window.electronAPI.listTradingConnections(),
      ])
      setRecords([...nextRecords].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)))
      setConnectionNames(Object.fromEntries(connections.map(({ connection }) => [
        connection.connection_id,
        connection.display_name,
      ])))
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load trades')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 4_000)
    return () => window.clearInterval(timer)
  }, [load])

  const counts = useMemo(() => records.reduce<Record<TradeTab, number>>((result, record) => {
    result[tabForRecord(record)] += 1
    return result
  }, { active: 0, pending: 0, closed: 0 }), [records])
  const visible = records.filter((record) => tabForRecord(record) === activeTab)

  return (
    <div className="h-full overflow-y-auto bg-[#090b0e] text-[#eef0f3]">
      <div className="mx-auto w-full max-w-[1420px] px-6 py-7 xl:px-9">
        <header className="flex items-start justify-between gap-5 border-b border-white/[0.07] pb-6">
          <div>
            <p className="text-xs font-medium text-[#8b93a1]">Execution ledger</p>
            <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.03em]">Trades</h1>
            <p className="mt-2 text-sm text-[#858d99]">Every routed trade, its account, protection, and current state.</p>
          </div>
          <button onClick={() => void load()} className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-xs text-[#aab1bc] hover:bg-white/[0.06]">
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </header>

        <div className="mt-6 inline-flex rounded-lg bg-white/[0.04] p-1">
          {(['active', 'pending', 'closed'] as TradeTab[]).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`rounded-md px-4 py-2 text-xs font-medium capitalize transition-colors ${activeTab === tab ? 'bg-[#252a32] text-white shadow-sm' : 'text-[#858d99] hover:text-white'}`}>
              {tab} <span className="ml-1.5 text-[10px] text-[#707886]">{counts[tab]}</span>
            </button>
          ))}
        </div>

        {error && <div className="mt-5 rounded-lg border border-red-400/20 bg-red-400/[0.05] px-4 py-3 text-sm text-red-200">{error}</div>}

        <div className="mt-5 overflow-hidden rounded-xl border border-white/[0.08] bg-[#0d1014]">
          {visible.length === 0 ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center px-6 text-center">
              <div className="flex size-11 items-center justify-center rounded-full bg-white/[0.05] text-[#7e8795]">
                {activeTab === 'active' ? <ShieldCheck className="size-5" /> : <Clock3 className="size-5" />}
              </div>
              <h2 className="mt-4 text-sm font-medium">No {activeTab} trades</h2>
              <p className="mt-1 max-w-sm text-xs leading-5 text-[#727b88]">
                {activeTab === 'active'
                  ? 'Protected positions will appear here as soon as the execution gateway confirms them.'
                  : activeTab === 'pending'
                    ? 'Signals waiting on authorization, submission, or reconciliation appear here.'
                    : 'Completed and rejected trade records will collect here.'}
              </p>
            </div>
          ) : visible.map((record) => {
            const intent = record.intent
            const stop = protectionLabel(intent.protection.stop_loss)
            const targets = intent.protection.exit_legs?.map((leg) => leg.take_profit ? protectionLabel(leg.take_profit) : undefined).filter((value): value is string => Boolean(value))
              ?? (intent.protection.take_profit ? [protectionLabel(intent.protection.take_profit)] : [])
            return (
              <div key={intent.intent_id} className="grid gap-4 border-b border-white/[0.06] px-5 py-4 last:border-0 md:grid-cols-[1.1fr_1.3fr_1fr_auto] md:items-center">
                <div className="flex items-center gap-3">
                  <div className={`flex size-9 items-center justify-center rounded-lg ${intent.side === 'buy' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-red-400/10 text-red-300'}`}>
                    {intent.side === 'buy' ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2"><span className="font-semibold">{intent.instrument.symbol}</span><span className="text-[10px] uppercase text-[#717986]">{intent.side}</span></div>
                    <p className="mt-0.5 text-[11px] text-[#717986]">{intent.quantity} contract{intent.quantity === 1 ? '' : 's'}</p>
                  </div>
                </div>
                <div>
                  <p className="truncate text-xs text-[#c1c6ce]">{connectionNames[intent.connection_id] ?? intent.connection_id}</p>
                  <p className="mt-1 truncate text-[10px] text-[#69717e]">{intent.source.type} · {intent.source.source_id}</p>
                </div>
                <div className="flex gap-5 text-[11px]">
                  <div><span className="block text-[#69717e]">Stop</span><span className="mt-1 block text-[#c1c6ce]">{stop ?? 'Market managed'}</span></div>
                  <div><span className="block text-[#69717e]">Targets</span><span className="mt-1 block text-[#c1c6ce]">{targets.length ? targets.join(' · ') : 'Runner'}</span></div>
                </div>
                <div className="text-right">
                  <span className="inline-flex rounded-full border border-white/[0.08] bg-white/[0.035] px-2.5 py-1 text-[10px] capitalize text-[#aeb4bd]">{prettyState(record.state)}</span>
                  <p className="mt-1.5 text-[10px] text-[#656d79]">{formatTime(record.updated_at)}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default TradeGodTradesPage
