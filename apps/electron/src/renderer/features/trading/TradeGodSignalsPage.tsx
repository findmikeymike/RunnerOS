import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { BellRing, Check, RadioTower } from 'lucide-react'

import type { TradeAlert, TradeAlertIngestionStatus } from '@trade-god/contracts'

const TradeGodSignalsPage: React.FC = () => {
  const [alerts, setAlerts] = useState<TradeAlert[]>([])
  const [status, setStatus] = useState<TradeAlertIngestionStatus | null>(null)

  const load = useCallback(async () => {
    const [nextAlerts, nextStatus] = await Promise.all([
      window.electronAPI.listTradeGodAlerts(100),
      window.electronAPI.getTradeGodAlertIngestionStatus(),
    ])
    setAlerts(nextAlerts)
    setStatus(nextStatus)
  }, [])

  useEffect(() => {
    void load()
    return window.electronAPI.onTradeGodAlert(() => void load())
  }, [load])

  const sorted = useMemo(() => [...alerts].sort((a, b) => Date.parse(b.received_at) - Date.parse(a.received_at)), [alerts])
  const newCount = alerts.filter((alert) => alert.status === 'new').length

  return (
    <div className="h-full overflow-y-auto bg-[#090b0e] text-[#eef0f3]">
      <div className="mx-auto w-full max-w-[1420px] px-6 py-7 xl:px-9">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/[0.07] pb-6">
          <div>
            <p className="text-xs font-medium text-[#8b93a1]">Inbound intelligence</p>
            <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.03em]">Signals</h1>
            <p className="mt-2 text-sm text-[#858d99]">TradingView alerts and external trade signals in one clean queue.</p>
          </div>
          <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] ${status?.state === 'ready' ? 'border-emerald-400/15 bg-emerald-400/[0.06] text-emerald-300' : 'border-amber-300/15 bg-amber-300/[0.06] text-amber-200'}`}>
            <RadioTower className="size-3.5" /> {status?.state === 'ready' ? 'Receiver online' : 'Receiver offline'}
          </div>
        </header>

        <div className="mt-6 flex items-center gap-2 text-xs text-[#868e9a]"><BellRing className="size-4" /><span>{newCount} new</span><span className="text-[#454b54]">·</span><span>{alerts.length} total</span></div>

        <div className="mt-5 overflow-hidden rounded-xl border border-white/[0.08] bg-[#0d1014]">
          {!sorted.length ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
              <div className="flex size-11 items-center justify-center rounded-full bg-white/[0.05] text-[#7e8795]"><BellRing className="size-5" /></div>
              <h2 className="mt-4 text-sm font-medium">No signals yet</h2>
              <p className="mt-1 max-w-sm text-xs leading-5 text-[#727b88]">Connected TradingView and Discord signals will arrive here.</p>
            </div>
          ) : sorted.map((alert) => (
            <div key={alert.id} className="grid gap-3 border-b border-white/[0.06] px-5 py-4 last:border-0 md:grid-cols-[120px_1fr_auto] md:items-center">
              <div><span className="text-sm font-semibold">{alert.symbol}</span><p className="mt-1 text-[10px] capitalize text-[#69717e]">{alert.source} · {alert.direction}</p></div>
              <div><p className="text-sm text-[#d5d8dd]">{alert.title}</p>{alert.message && <p className="mt-1 line-clamp-1 text-xs text-[#747d89]">{alert.message}</p>}</div>
              <button disabled={alert.status === 'acknowledged'} onClick={async () => { await window.electronAPI.acknowledgeTradeGodAlert(alert.id); await load() }} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] text-[#858d99] hover:bg-white/[0.05] disabled:opacity-50">
                <Check className="size-3" /> {alert.status === 'acknowledged' ? 'Seen' : 'Mark seen'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default TradeGodSignalsPage
