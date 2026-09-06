import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { BellRing, Check, RadioTower } from 'lucide-react'

import type { TradeAlert, TradeAlertIngestionStatus } from '@trade-god/contracts'
import TradeGodPageHeader from './TradeGodPageHeader'

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
    <div className="trade-god-page-surface h-full overflow-y-auto text-[#eef0f3]">
      <div className="tg-page-container">
        <TradeGodPageHeader
          eyebrow="Inbound intelligence"
          title="Signals"
          description="TradingView alerts and external trade signals in one clean queue."
          actions={(
            <div className="tg-header-status">
              <RadioTower className={`size-3.5 ${status?.state === 'ready' ? 'text-emerald-600' : 'text-amber-600'}`} />
              {status?.state === 'ready' ? 'Receiver online' : 'Receiver offline'}
            </div>
          )}
        />

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
