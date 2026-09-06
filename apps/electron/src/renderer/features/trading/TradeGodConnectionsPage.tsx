import React, { useState } from 'react'
import { Link2, MessageSquare, ShieldCheck, WalletCards } from 'lucide-react'

import TradingConnectionsSettingsPage from '@/pages/settings/TradingConnectionsSettingsPage'
import OptionsControlCenterPage from './OptionsControlCenterPage'
import DiscordSourcesPage from './DiscordSourcesPage'
import TradeGodPageHeader from './TradeGodPageHeader'
import {
  readTradingConnectionsMarket,
  TRADING_CONNECTIONS_MARKET_KEY,
  type TradingConnectionsMarket,
} from './trading-connections-navigation'

interface TradeGodConnectionsPageProps {
  workspaceId?: string
}

const marketCopy: Record<TradingConnectionsMarket, string> = {
  futures: 'Futures',
  options: 'Options',
}

const TradeGodConnectionsPage: React.FC<TradeGodConnectionsPageProps> = ({ workspaceId }) => {
  const [section, setSection] = useState<'accounts' | 'discords'>('accounts')
  const [market, setMarket] = useState<TradingConnectionsMarket>(readTradingConnectionsMarket)

  const chooseMarket = (next: TradingConnectionsMarket) => {
    setMarket(next)
    window.sessionStorage.setItem(TRADING_CONNECTIONS_MARKET_KEY, next)
  }

  return (
    <div className="trade-god-connections-light h-full overflow-y-auto bg-background text-foreground">
      <main className="min-h-full w-full bg-background">
        <div className="tg-page-container">
          <TradeGodPageHeader
            eyebrow="Trading setup"
            icon={<Link2 className="size-3.5" />}
            title="Connections"
            description="Keep accounts and Discords organized once. Route them together inside Futures or Options."
            actions={(
              <div className="tg-header-status">
                <ShieldCheck className="size-3.5 text-emerald-600" /> Saved locally · locked by default
              </div>
            )}
          />

          <div className="mt-6 flex w-fit rounded-lg border border-border bg-secondary p-1" role="tablist" aria-label="Connection type">
            <button type="button" role="tab" aria-selected={section === 'accounts'} onClick={() => setSection('accounts')} className={`inline-flex h-9 items-center gap-2 rounded-md px-4 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${section === 'accounts' ? 'bg-background text-foreground shadow-minimal' : 'text-muted-foreground hover:text-foreground'}`}><WalletCards className="size-3.5" /> Accounts</button>
            <button type="button" role="tab" aria-selected={section === 'discords'} onClick={() => setSection('discords')} className={`inline-flex h-9 items-center gap-2 rounded-md px-4 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${section === 'discords' ? 'bg-background text-foreground shadow-minimal' : 'text-muted-foreground hover:text-foreground'}`}><MessageSquare className="size-3.5" /> Discords</button>
          </div>

          {section === 'accounts' ? (
            <>
              <div className="mt-7">
                <p className="text-[11px] font-medium text-muted-foreground">Account type</p>
                <div className="mt-2 flex w-fit rounded-lg bg-secondary p-1" role="tablist" aria-label="Account market">
                  {(Object.keys(marketCopy) as TradingConnectionsMarket[]).map((value) => {
                    const selected = market === value
                    return (
                      <button
                        key={value}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        onClick={() => chooseMarket(value)}
                        className={`h-8 rounded-md px-4 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          selected
                            ? 'bg-foreground text-background shadow-minimal'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {marketCopy[value]}
                      </button>
                    )
                  })}
                </div>
              </div>

              <section className="mt-6 border-t border-border" role="tabpanel" aria-label={`${marketCopy[market]} accounts`}>
                {market === 'futures' ? (
                  <TradingConnectionsSettingsPage embedded workspaceId={workspaceId} showRouting={false} />
                ) : (
                  <OptionsControlCenterPage mode="connections" showSources={false} />
                )}
              </section>
            </>
          ) : (
            <div className="mt-6 border-t border-border">
              <DiscordSourcesPage workspaceId={workspaceId} />
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

export default TradeGodConnectionsPage
