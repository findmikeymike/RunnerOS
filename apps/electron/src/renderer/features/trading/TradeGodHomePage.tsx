import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  BellRing,
  CalendarClock,
  Check,
  CircleGauge,
  Copy,
  Database,
  Hash,
  Newspaper,
  Plus,
  Radio,
  Satellite,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react'

import type {
  IbkrGatewayHealth,
  MarketCandleSeries,
  TradeAlert,
  TradeAlertIngestionStatus,
} from '@trade-god/contracts'

import TradeGodWorkbenchPage from './TradeGodWorkbenchPage'
import DiscoTraderControlCenterPage from './DiscoTraderControlCenterPage'
import TradeGodTradesPage from './TradeGodTradesPage'
import TradeGodSignalsPage from './TradeGodSignalsPage'
import OptionsControlCenterPage from './OptionsControlCenterPage'
import TradingConnectionsSettingsPage from '@/pages/settings/TradingConnectionsSettingsPage'
import { marketCandleSeriesToChartBars } from './chart-series-adapter'
import type { SyntheticChartTimeframe } from '../../../main/trading/synthetic-chart-fixture'

const FuturesChartPanel = React.lazy(() => import('./FuturesChartPanel'))

export type TradeGodView = 'overview' | 'trades' | 'signals' | 'discotrader' | 'options' | 'accounts' | 'order-flow'

export const TRADE_GOD_VIEW_EVENT = 'trade-god:view'
export const TRADE_GOD_VIEW_STORAGE_KEY = 'trade-god:active-view'

const DEFAULT_WATCHLIST = ['ES', 'NQ', 'SPY']

const futuresBoard = [
  { symbol: 'ES', name: 'E-mini S&P', context: 'US risk benchmark' },
  { symbol: 'NQ', name: 'E-mini Nasdaq', context: 'Growth + duration' },
  { symbol: 'YM', name: 'E-mini Dow', context: 'Large-cap value' },
  { symbol: 'RTY', name: 'E-mini Russell', context: 'Small-cap risk' },
] as const

const sectorEtfs = ['XLK', 'XLC', 'XLF', 'XLI', 'XLV', 'XLE', 'XLP', 'XLU', 'XLRE']

const intermarketBoard = [
  { symbol: 'DXY', label: 'US Dollar' },
  { symbol: 'US10Y', label: '10Y Yield' },
  { symbol: 'CL', label: 'Crude Oil' },
  { symbol: 'GC', label: 'Gold' },
] as const

const sessionSchedule = [
  { time: '08:30', label: 'US cash session opens', kind: 'Session' },
  { time: '15:00', label: 'US cash session closes', kind: 'Session' },
] as const

interface TradeGodHomePageProps {
  workspaceId?: string
  workspaceName?: string
}

export const normalizeWatchTicker = (value: string): string =>
  value.trim().toUpperCase().replace(/[^A-Z0-9./:-]/g, '').slice(0, 12)

const readStoredView = (): TradeGodView => {
  if (typeof window === 'undefined') return 'overview'
  const stored = window.sessionStorage.getItem(TRADE_GOD_VIEW_STORAGE_KEY)
  return stored === 'trades' || stored === 'signals' || stored === 'discotrader' || stored === 'options' || stored === 'accounts' || stored === 'order-flow'
    ? stored
    : 'overview'
}

export const readWatchlistPreference = (content: string, workspaceId?: string): string[] | undefined => {
  try {
    const preferences = JSON.parse(content) as {
      tradeGod?: {
        watchlist?: unknown
        futuresHubs?: Record<string, { watchlist?: unknown }>
      }
    }
    const stored = (
      workspaceId
        ? preferences.tradeGod?.futuresHubs?.[workspaceId]?.watchlist
        : undefined
    ) ?? preferences.tradeGod?.watchlist
    if (!Array.isArray(stored)) return DEFAULT_WATCHLIST
    return stored
      .filter((value): value is string => typeof value === 'string')
      .map(normalizeWatchTicker)
      .filter(Boolean)
      .slice(0, 20)
  } catch {
    return undefined
  }
}

const TradeGodHomePage: React.FC<TradeGodHomePageProps> = ({ workspaceId, workspaceName }) => {
  const [activeView, setActiveView] = useState<TradeGodView>(readStoredView)
  const [watchlist, setWatchlist] = useState<string[]>(DEFAULT_WATCHLIST)
  const [tickerDraft, setTickerDraft] = useState('')
  const [selectedSymbol, setSelectedSymbol] = useState<(typeof futuresBoard)[number]['symbol']>('ES')
  const [chartTimeframe, setChartTimeframe] = useState<SyntheticChartTimeframe>('5m')
  const [chartSessionMode, setChartSessionMode] = useState<'ETH' | 'RTH'>('ETH')
  const [chartSeries, setChartSeries] = useState<MarketCandleSeries | null>(null)
  const [chartDataMode, setChartDataMode] = useState<'loading' | 'synthetic' | 'offline'>('loading')
  const [alerts, setAlerts] = useState<TradeAlert[]>([])
  const [alertStatus, setAlertStatus] = useState<TradeAlertIngestionStatus | null>(null)
  const [ibkrHealth, setIbkrHealth] = useState<IbkrGatewayHealth | null>(null)
  const [setupCopied, setSetupCopied] = useState(false)

  useEffect(() => {
    const handleViewChange = (event: Event) => {
      const view = (event as CustomEvent<TradeGodView>).detail
      if (view === 'overview' || view === 'trades' || view === 'signals' || view === 'discotrader' || view === 'options' || view === 'accounts' || view === 'order-flow') setActiveView(view)
    }
    window.addEventListener(TRADE_GOD_VIEW_EVENT, handleViewChange)
    return () => window.removeEventListener(TRADE_GOD_VIEW_EVENT, handleViewChange)
  }, [])

  useEffect(() => {
    let active = true
    setChartSeries(null)
    setChartDataMode('loading')
    void window.electronAPI.getSyntheticTradeGodChartFixture({
      symbol: selectedSymbol,
      timeframe: chartTimeframe,
      sessionMode: chartSessionMode,
    }).then((series) => {
      if (!active) return
      setChartSeries(series)
      setChartDataMode(series ? 'synthetic' : 'offline')
    }).catch(() => {
      if (!active) return
      setChartSeries(null)
      setChartDataMode('offline')
    })
    return () => {
      active = false
    }
  }, [chartSessionMode, chartTimeframe, selectedSymbol])

  useEffect(() => {
    void window.electronAPI.readPreferences()
      .then(({ content, exists }) => {
        if (!exists) return
        const storedWatchlist = readWatchlistPreference(content, workspaceId)
        if (storedWatchlist) setWatchlist(storedWatchlist)
      })
      .catch(() => {
        // Keep the safe default watchlist when preferences cannot be read.
      })
  }, [workspaceId])

  useEffect(() => {
    let active = true
    void window.electronAPI.getIbkrGatewayHealth('paper')
      .then((health) => {
        if (active) setIbkrHealth(health)
      })
      .catch(() => {
        if (active) setIbkrHealth(null)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    void Promise.all([
      window.electronAPI.listTradeGodAlerts(50),
      window.electronAPI.getTradeGodAlertIngestionStatus(),
    ]).then(([storedAlerts, ingestionStatus]) => {
      if (!active) return
      setAlerts(storedAlerts)
      setAlertStatus(ingestionStatus)
    }).catch(() => {
      if (active) {
        setAlertStatus({
          state: 'unavailable',
          authentication: 'json-body-secret',
          public_relay_connected: false,
          message: 'Alert receiver is unavailable.',
        })
      }
    })

    const unsubscribe = window.electronAPI.onTradeGodAlert((alert) => {
      setAlerts((current) => [alert, ...current.filter((entry) => entry.id !== alert.id)].slice(0, 50))
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const saveWatchlist = useCallback((nextWatchlist: string[]) => {
    setWatchlist(nextWatchlist)
    void window.electronAPI.readPreferences()
      .then(async ({ content, exists }) => {
        let preferences: Record<string, unknown> = {}
        if (exists) {
          try {
            preferences = JSON.parse(content) as Record<string, unknown>
          } catch {
            return
          }
        }

        const existingTradeGod = (
          preferences.tradeGod
          && typeof preferences.tradeGod === 'object'
          && !Array.isArray(preferences.tradeGod)
        )
          ? preferences.tradeGod as Record<string, unknown>
          : {}

        const futuresHubs = (
          existingTradeGod.futuresHubs
          && typeof existingTradeGod.futuresHubs === 'object'
          && !Array.isArray(existingTradeGod.futuresHubs)
        )
          ? existingTradeGod.futuresHubs as Record<string, unknown>
          : {}

        const nextTradeGod = workspaceId
          ? {
              ...existingTradeGod,
              futuresHubs: {
                ...futuresHubs,
                [workspaceId]: {
                  ...(
                    futuresHubs[workspaceId]
                    && typeof futuresHubs[workspaceId] === 'object'
                    && !Array.isArray(futuresHubs[workspaceId])
                      ? futuresHubs[workspaceId] as Record<string, unknown>
                      : {}
                  ),
                  watchlist: nextWatchlist,
                },
              },
            }
          : {
              ...existingTradeGod,
              watchlist: nextWatchlist,
            }

        await window.electronAPI.writePreferences(JSON.stringify({
          ...preferences,
          tradeGod: nextTradeGod,
        }, null, 2))
      })
      .catch(() => {
        // The in-memory watch pad remains usable if persistence is unavailable.
      })
  }, [workspaceId])

  const addTicker = useCallback(() => {
    const ticker = normalizeWatchTicker(tickerDraft)
    if (!ticker || watchlist.includes(ticker)) {
      setTickerDraft('')
      return
    }
    saveWatchlist([...watchlist, ticker].slice(0, 20))
    setTickerDraft('')
  }, [saveWatchlist, tickerDraft, watchlist])

  const removeTicker = useCallback((ticker: string) => {
    saveWatchlist(watchlist.filter((item) => item !== ticker))
  }, [saveWatchlist, watchlist])

  const acknowledgeAlert = useCallback((alertId: string) => {
    void window.electronAPI.acknowledgeTradeGodAlert(alertId).then((updated) => {
      if (!updated) return
      setAlerts((current) => current.map((alert) => alert.id === updated.id ? updated : alert))
    })
  }, [])

  const copyTradingViewSetup = useCallback(() => {
    void window.electronAPI.getTradeGodAlertWebhookSetup()
      .then(async (setup) => {
        await navigator.clipboard.writeText(
          `Webhook URL:\n${setup.delivery_url}\n\nMessage body:\n${setup.json_body_template}`,
        )
        setSetupCopied(true)
        window.setTimeout(() => setSetupCopied(false), 2_000)
      })
  }, [])

  const chartBars = useMemo(() => marketCandleSeriesToChartBars(chartSeries), [chartSeries])
  const newAlertCount = alerts.filter((alert) => alert.status === 'new').length
  const gatewayReady = ibkrHealth?.state === 'ready'
  const receiverReady = alertStatus?.state === 'ready'
  const hubLabel = workspaceName && !/\b(my workspace|workspace)\b/i.test(workspaceName)
    ? workspaceName
    : 'Futures Desk'
  const selectedMarket = futuresBoard.find((market) => market.symbol === selectedSymbol) ?? futuresBoard[0]

  if (activeView === 'order-flow') return <TradeGodWorkbenchPage />
  if (activeView === 'discotrader') return <DiscoTraderControlCenterPage workspaceId={workspaceId} />
  if (activeView === 'trades') return <TradeGodTradesPage />
  if (activeView === 'signals') return <TradeGodSignalsPage />
  if (activeView === 'options') return <OptionsControlCenterPage />
  if (activeView === 'accounts') return <TradingConnectionsSettingsPage workspaceId={workspaceId} />

  return (
    <div className="runneros-glass-route h-full overflow-y-auto bg-[#090c0f] text-[#eaecef]">
      <div className="mx-auto flex w-full max-w-[1560px] flex-col gap-4 px-5 py-5 xl:px-8 xl:py-7">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[#252b33] pb-5">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-amber-300">
              <Activity className="h-4 w-4" /> {hubLabel}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Futures Overview</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#929aa5]">
              Market state, catalysts, and signals—ordered by what needs your attention now.
            </p>
          </div>
          <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${
            gatewayReady
              ? 'border-[#0ecb81]/20 bg-[#0ecb81]/[0.06] text-[#8fe8bd]'
              : 'border-amber-300/20 bg-amber-300/[0.06] text-amber-100'
          }`}>
            {gatewayReady ? <ShieldCheck className="h-3.5 w-3.5" /> : <Radio className="h-3.5 w-3.5" />}
            {gatewayReady ? 'Paper Gateway authenticated · quotes not yet wired' : 'Preview mode · market data offline'}
          </div>
        </header>

        <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="Desk state">
          <DeskStateCard
            icon={<Database className="h-3.5 w-3.5" />}
            label="Market data"
            value={gatewayReady ? 'Gateway ready' : 'Offline'}
            detail={gatewayReady ? 'Health-only connection' : 'IBKR paper · port 4002'}
            tone={gatewayReady ? 'positive' : 'warning'}
          />
          <DeskStateCard
            icon={<BellRing className="h-3.5 w-3.5" />}
            label="Attention queue"
            value={`${newAlertCount} new`}
            detail={receiverReady ? 'Alert receiver ready' : 'Receiver unavailable'}
            tone={newAlertCount > 0 ? 'warning' : receiverReady ? 'positive' : 'muted'}
          />
          <DeskStateCard
            icon={<CalendarClock className="h-3.5 w-3.5" />}
            label="Session clock"
            value="Central time"
            detail="Exchange calendar pending"
            tone="muted"
          />
          <DeskStateCard
            icon={<Hash className="h-3.5 w-3.5" />}
            label="Watchlist"
            value={`${watchlist.length} symbols`}
            detail="Local to this Futures Hub"
            tone="muted"
          />
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(330px,0.8fr)]">
          <div className="grid min-w-0 gap-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Core futures contracts">
              {futuresBoard.map((market) => (
                <button
                  key={market.symbol}
                  type="button"
                  onClick={() => setSelectedSymbol(market.symbol)}
                  className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    selectedSymbol === market.symbol
                      ? 'border-amber-300/30 bg-amber-300/[0.07]'
                      : 'border-[#252b33] bg-[#151a20] hover:border-[#39414b]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`font-mono text-xs font-semibold ${
                      selectedSymbol === market.symbol ? 'text-amber-200' : 'text-white'
                    }`}>{market.symbol}</span>
                    <span className="font-mono text-[10px] text-[#5f6977]">—</span>
                  </div>
                  <div className="mt-1 truncate text-[9px] text-[#707a8a]">{market.name}</div>
                </button>
              ))}
            </div>

            <React.Suspense fallback={<ChartLoadingShell />}>
              <FuturesChartPanel
                symbol={selectedMarket.symbol}
                symbolName={selectedMarket.name}
                timeframe={chartTimeframe}
                sessionMode={chartSessionMode}
                bars={chartBars}
                annotations={[]}
                dataMode={chartDataMode}
                emptyDetail={selectedSymbol === 'ES'
                  ? 'The synthetic ES preview could not be loaded. Live broker data remains disconnected.'
                  : `No synthetic fixture exists for ${selectedSymbol}. Live broker data remains disconnected.`}
                onTimeframeChange={(timeframe) => setChartTimeframe(timeframe as SyntheticChartTimeframe)}
                onSessionModeChange={setChartSessionMode}
              />
            </React.Suspense>

            <article className="rounded-lg border border-[#252b33] bg-[#11151a]">
              <PanelHeading
                icon={<BellRing className="h-4 w-4 text-amber-300" />}
                title="Attention stream"
                eyebrow="Signals requiring review"
              />
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#252b33] px-5 py-3">
                <div className="flex flex-wrap gap-2">
                  <SourceStatus
                    label={alertStatus?.public_relay_connected ? 'TradingView public' : 'TradingView local'}
                    ready={alertStatus?.state === 'ready'}
                  />
                  <SourceStatus label="Discord alerts" />
                  <SourceStatus label="Trade God workflows" ready />
                </div>
                {alertStatus?.state === 'ready' && (
                  <button
                    type="button"
                    onClick={copyTradingViewSetup}
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[#303741] bg-[#191e24] px-2.5 text-[10px] text-[#929aa5] hover:border-[#46505d] hover:text-white"
                  >
                    {setupCopied ? <Check className="h-3 w-3 text-[#0ecb81]" /> : <Copy className="h-3 w-3" />}
                    {setupCopied ? 'Copied' : 'Copy setup'}
                  </button>
                )}
              </div>
              {alerts.length > 0 ? (
                <div className="divide-y divide-[#252b33]">
                  {alerts.map((alert) => (
                    <AlertFeedRow key={alert.id} alert={alert} onAcknowledge={acknowledgeAlert} />
                  ))}
                </div>
              ) : (
                <EmptyFeed
                  icon={<Satellite className="h-5 w-5" />}
                  title={alertStatus?.state === 'ready' ? 'Receiver ready · waiting for alerts' : 'No incoming alerts yet'}
                  detail={alertStatus?.message ?? 'TradingView, Discord, and internal workflow signals will land here in one normalized feed.'}
                />
              )}
            </article>

            <article className="rounded-lg border border-[#252b33] bg-[#11151a]">
              <PanelHeading
                icon={<Newspaper className="h-4 w-4 text-amber-300" />}
                title="Market headlines"
                eyebrow="Filtered by impact + watchlist"
              />
              <EmptyFeed
                icon={<Search className="h-5 w-5" />}
                title="News intelligence is not connected"
                detail="Once a canonical news source is selected, high-impact headlines and watchlist matches will appear here."
                compact
              />
            </article>
          </div>

          <div className="grid content-start gap-4">
            <article className="rounded-lg border border-[#252b33] bg-[#11151a]">
              <PanelHeading
                icon={<AlertTriangle className="h-4 w-4 text-amber-300" />}
                title="Desk priorities"
                eyebrow="What needs attention"
              />
              <div className="divide-y divide-[#252b33]">
                <PriorityRow
                  title={gatewayReady ? 'Market-data connection is authenticated' : 'Connect IBKR Paper Gateway'}
                  detail={gatewayReady
                    ? 'Health is ready. Quote streaming and entitlements are still unverified.'
                    : 'Log in, enable socket clients, and expose read-only port 4002.'}
                  state={gatewayReady ? 'done' : 'blocked'}
                />
                <PriorityRow
                  title={receiverReady ? 'External alert receiver is ready' : 'Bring external alerts online'}
                  detail={receiverReady
                    ? `${newAlertCount} signal${newAlertCount === 1 ? '' : 's'} currently require review.`
                    : 'TradingView and future Discord signals cannot reach the desk.'}
                  state={receiverReady ? (newAlertCount > 0 ? 'attention' : 'done') : 'blocked'}
                />
                <PriorityRow
                  title="Add authoritative session + catalyst calendar"
                  detail="Until this is connected, the desk will not guess holidays, rollovers, or economic events."
                  state="pending"
                />
              </div>
            </article>

            <article className="rounded-lg border border-[#252b33] bg-[#11151a]">
              <PanelHeading
                icon={<Hash className="h-4 w-4 text-amber-300" />}
                title="Desk watchlist"
                eyebrow={`${watchlist.length}/20 symbols`}
              />
              <form
                className="flex gap-2 border-b border-[#252b33] p-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  addTicker()
                }}
              >
                <input
                  aria-label="Ticker symbol"
                  value={tickerDraft}
                  onChange={(event) => setTickerDraft(event.target.value)}
                  placeholder="Add ticker"
                  className="min-w-0 flex-1 rounded-md border border-[#303741] bg-[#191e24] px-3 py-2 text-xs font-medium uppercase text-white outline-none placeholder:normal-case placeholder:text-[#5f6977] focus:border-amber-300/50"
                />
                <button
                  type="submit"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-amber-300/25 bg-amber-300/[0.08] px-3 text-xs font-medium text-amber-100 transition-colors hover:bg-amber-300/[0.14]"
                >
                  <Plus className="h-3.5 w-3.5" /> Add
                </button>
              </form>
              <div className="p-4">
                {watchlist.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-2">
                    {watchlist.map((ticker) => (
                      <div key={ticker} className="group flex items-center justify-between rounded-md border border-[#2b3139] bg-[#191e24] px-3 py-2.5">
                        <span className="font-mono text-sm font-semibold text-white">{ticker}</span>
                        <button
                          type="button"
                          onClick={() => removeTicker(ticker)}
                          aria-label={`Remove ${ticker}`}
                          className="rounded p-1 text-[#5f6977] opacity-60 transition-colors hover:bg-white/5 hover:text-[#f6465d] group-hover:opacity-100"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="py-3 text-center text-xs text-[#707a8a]">Add the symbols you are watching today.</p>
                )}
                <p className="mt-3 text-[10px] leading-4 text-[#5f6977]">
                  Stored locally for this Futures Hub. Quotes and ticker-specific alerts activate when their feeds are connected.
                </p>
              </div>
            </article>

            <article className="rounded-lg border border-[#252b33] bg-[#11151a]">
              <PanelHeading
                icon={<CalendarClock className="h-4 w-4 text-amber-300" />}
                title="Today"
                eyebrow="Central time"
              />
              <div className="divide-y divide-[#252b33] px-4">
                {sessionSchedule.map((event) => (
                  <div key={event.time} className="grid grid-cols-[48px_1fr_auto] items-center gap-3 py-3">
                    <span className="font-mono text-xs text-amber-300">{event.time}</span>
                    <span className="text-xs text-[#d5d9df]">{event.label}</span>
                    <span className="text-[9px] uppercase tracking-[0.12em] text-[#5f6977]">{event.kind}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-[#252b33] px-4 py-3 text-[10px] leading-4 text-[#5f6977]">
                Schedule reference only. Holidays, rollovers, economic events, and earnings require the calendar adapter.
              </div>
            </article>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1fr_1fr_1.15fr]">
          <article className="rounded-lg border border-[#252b33] bg-[#11151a] p-4">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <CircleGauge className="h-4 w-4 text-amber-300" /> Market breadth
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <UnavailableMetric label="Advancers" />
              <UnavailableMetric label="Decliners" />
              <UnavailableMetric label="Up volume" />
            </div>
          </article>

          <article className="rounded-lg border border-[#252b33] bg-[#11151a] p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold">Sector pulse</span>
              <span className="text-[9px] uppercase tracking-[0.12em] text-[#5f6977]">Awaiting feed</span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {sectorEtfs.map((symbol) => (
                <div key={symbol} className="flex items-center justify-between rounded border border-[#252b33] bg-[#191e24] px-2.5 py-2">
                  <span className="font-mono text-[11px] font-medium text-[#929aa5]">{symbol}</span>
                  <span className="text-[#5f6977]">—</span>
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-lg border border-[#252b33] bg-[#11151a] p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold">Cross-asset drivers</span>
              <span className="text-[9px] uppercase tracking-[0.12em] text-[#5f6977]">Awaiting feed</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {intermarketBoard.map((market) => (
                <div key={market.symbol} className="rounded-md border border-[#252b33] bg-[#191e24] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-[#d5d9df]">{market.symbol}</span>
                    <span className="font-mono text-[#5f6977]">—</span>
                  </div>
                  <div className="mt-1.5 text-[9px] text-[#5f6977]">{market.label}</div>
                </div>
              ))}
            </div>
          </article>
        </section>
      </div>
    </div>
  )
}

const ChartLoadingShell: React.FC = () => (
  <div className="flex h-[475px] items-center justify-center rounded-lg border border-[#252b33] bg-[#11151a] text-xs text-[#707a8a]">
    Loading native chart…
  </div>
)

const DeskStateCard: React.FC<{
  icon: React.ReactNode
  label: string
  value: string
  detail: string
  tone: 'positive' | 'warning' | 'muted'
}> = ({ icon, label, value, detail, tone }) => {
  const toneClass = tone === 'positive'
    ? 'text-[#0ecb81]'
    : tone === 'warning'
      ? 'text-amber-300'
      : 'text-[#929aa5]'

  return (
    <article className="rounded-lg border border-[#252b33] bg-[#151a20] px-4 py-3.5">
      <div className="flex items-center gap-2 text-[9px] uppercase tracking-[0.13em] text-[#5f6977]">
        <span className={toneClass}>{icon}</span>
        {label}
      </div>
      <div className={`mt-2.5 text-sm font-semibold ${toneClass}`}>{value}</div>
      <div className="mt-1 text-[10px] text-[#5f6977]">{detail}</div>
    </article>
  )
}

const PriorityRow: React.FC<{
  title: string
  detail: string
  state: 'done' | 'attention' | 'blocked' | 'pending'
}> = ({ title, detail, state }) => {
  const stateLabel = {
    done: 'Ready',
    attention: 'Review',
    blocked: 'Blocked',
    pending: 'Pending',
  }[state]
  const stateClass = state === 'done'
    ? 'border-[#0ecb81]/20 bg-[#0ecb81]/[0.06] text-[#0ecb81]'
    : state === 'attention' || state === 'blocked'
      ? 'border-amber-300/20 bg-amber-300/[0.06] text-amber-300'
      : 'border-[#303741] bg-[#191e24] text-[#707a8a]'

  return (
    <div className="px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-medium leading-5 text-[#d5d9df]">{title}</span>
        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.1em] ${stateClass}`}>
          {stateLabel}
        </span>
      </div>
      <p className="mt-1 text-[10px] leading-4 text-[#707a8a]">{detail}</p>
    </div>
  )
}

const PanelHeading: React.FC<{
  icon: React.ReactNode
  title: string
  eyebrow: string
}> = ({ icon, title, eyebrow }) => (
  <div className="flex items-center justify-between gap-3 border-b border-[#252b33] px-5 py-4">
    <div className="flex items-center gap-2 text-sm font-semibold">{icon}{title}</div>
    <span className="text-[9px] uppercase tracking-[0.13em] text-[#5f6977]">{eyebrow}</span>
  </div>
)

const SourceStatus: React.FC<{ label: string; ready?: boolean }> = ({ label, ready }) => (
  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] ${
    ready
      ? 'border-[#0ecb81]/20 bg-[#0ecb81]/[0.06] text-[#0ecb81]'
      : 'border-[#303741] bg-[#191e24] text-[#707a8a]'
  }`}>
    <span className={`h-1.5 w-1.5 rounded-full ${ready ? 'bg-[#0ecb81]' : 'bg-[#5f6977]'}`} />
    {label}
  </span>
)

const AlertFeedRow: React.FC<{
  alert: TradeAlert
  onAcknowledge: (alertId: string) => void
}> = ({ alert, onAcknowledge }) => {
  const directionTone = alert.direction === 'long'
    ? 'text-[#0ecb81]'
    : alert.direction === 'short'
      ? 'text-[#f6465d]'
      : 'text-amber-200'
  const receivedTime = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(alert.received_at))

  return (
    <div className={`grid gap-3 px-5 py-4 sm:grid-cols-[86px_minmax(0,1fr)_auto] ${alert.status === 'acknowledged' ? 'opacity-55' : ''}`}>
      <div>
        <div className={`font-mono text-sm font-semibold ${directionTone}`}>{alert.symbol}</div>
        <div className="mt-1 text-[9px] uppercase tracking-[0.12em] text-[#5f6977]">{alert.source}</div>
      </div>
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-[#eaecef]">{alert.title}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[#707a8a]">
          <span>{receivedTime}</span>
          {alert.price && <span className="font-mono">@ {alert.price}</span>}
          {alert.interval && <span>{alert.interval} interval</span>}
          <span className="capitalize">{alert.severity}</span>
        </div>
      </div>
      {alert.status === 'new' ? (
        <button
          type="button"
          onClick={() => onAcknowledge(alert.id)}
          className="inline-flex h-7 items-center gap-1.5 self-center rounded-md border border-[#303741] bg-[#191e24] px-2.5 text-[10px] text-[#929aa5] hover:border-[#46505d] hover:text-white"
        >
          <Check className="h-3 w-3" /> Acknowledge
        </button>
      ) : (
        <span className="self-center text-[9px] uppercase tracking-[0.12em] text-[#5f6977]">Seen</span>
      )}
    </div>
  )
}

const EmptyFeed: React.FC<{
  icon: React.ReactNode
  title: string
  detail: string
  compact?: boolean
}> = ({ icon, title, detail, compact }) => (
  <div className={`flex flex-col items-center justify-center px-6 text-center ${compact ? 'min-h-[150px] py-7' : 'min-h-[210px] py-9'}`}>
    <div className="mb-3 rounded-full border border-[#303741] bg-[#191e24] p-3 text-[#707a8a]">{icon}</div>
    <div className="text-sm font-medium text-[#d5d9df]">{title}</div>
    <p className="mt-2 max-w-md text-xs leading-5 text-[#707a8a]">{detail}</p>
  </div>
)

const UnavailableMetric: React.FC<{ label: string }> = ({ label }) => (
  <div className="rounded-md border border-[#252b33] bg-[#191e24] p-3">
    <div className="text-[9px] uppercase tracking-[0.11em] text-[#5f6977]">{label}</div>
    <div className="mt-2 font-mono text-lg font-semibold text-[#707a8a]">—</div>
  </div>
)

export default TradeGodHomePage
