import React, { useCallback, useEffect, useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  KeyRound,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'

import type { OptionsProvider } from '@trade-god/contracts'

type ConnectionStatus = Awaited<ReturnType<typeof window.electronAPI.listOptionsConnections>>[number]

const providerCopy: Record<OptionsProvider, {
  name: string
  accountPlaceholder: string
  credentialHelp: string
}> = {
  ibkr: {
    name: 'Interactive Brokers',
    accountPlaceholder: 'DU1234567',
    credentialHelp: 'Paste the OAuth access token created for your IBKR paper account.',
  },
  webull: {
    name: 'Webull',
    accountPlaceholder: 'Sandbox account ID',
    credentialHelp: 'Use the App Key and App Secret from Webull OpenAPI Management. A 2FA token is optional in sandbox.',
  },
}

const OptionsControlCenterPage: React.FC = () => {
  const [connections, setConnections] = useState<ConnectionStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogProvider, setDialogProvider] = useState<OptionsProvider | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [authorityConnection, setAuthorityConnection] = useState<ConnectionStatus | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setConnections(await window.electronAPI.listOptionsConnections())
      setError(null)
    } catch (cause) {
      setError(readableError(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const verified = connections.filter((item) => item.provider_read_fresh).length
  const liveData = connections.filter((item) => item.provider_read_fresh && item.provider_read_proof?.option_quotes_realtime).length
  const certified = connections.filter((item) => item.certification.state === 'eligible').length
  const nextStep = connections.length === 0
    ? 'Connect a paper account'
    : verified === 0
      ? 'Verify your saved account'
      : liveData === 0
        ? 'Check live options data'
        : certified === 0
          ? 'Run the guided paper test'
          : 'Manual paper testing is available'

  const verify = async (connectionId: string) => {
    setBusyId(connectionId)
    setError(null)
    try {
      await window.electronAPI.verifyOptionsConnection(connectionId)
      await load()
    } catch (cause) {
      setError(readableError(cause))
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (connectionId: string) => {
    if (!window.confirm('Remove this options account from Trade God? Your broker account is not affected.')) return
    setBusyId(connectionId)
    try {
      await window.electronAPI.removeOptionsConnection(connectionId)
      await load()
    } catch (cause) {
      setError(readableError(cause))
    } finally {
      setBusyId(null)
    }
  }

  const revokeAuthority = async (connectionId: string) => {
    if (!window.confirm('Lock manual paper orders for this account now?')) return
    setBusyId(connectionId)
    try {
      await window.electronAPI.revokeOptionsManualAuthority(connectionId)
      await load()
    } catch (cause) { setError(readableError(cause)) } finally { setBusyId(null) }
  }

  return (
    <div className="h-full overflow-y-auto bg-[#080b0e] text-[#edf0f3]">
      <div className="mx-auto w-full max-w-[1320px] px-5 py-6 md:px-8 md:py-8">
        <header className="flex flex-wrap items-start justify-between gap-5 border-b border-white/[0.08] pb-6">
          <div className="max-w-2xl">
            <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300">
              <CircleDollarSign className="h-4 w-4" /> Options automation
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Options Desk</h1>
            <p className="mt-2 text-sm leading-6 text-[#8e98a5]">
              Connect a paper account, confirm Trade God can read it, then test the full workflow before any order is allowed.
            </p>
          </div>
          <div className="rounded-full border border-emerald-400/20 bg-emerald-400/[0.07] px-3 py-1.5 text-xs text-emerald-200">
            Read-only · no orders
          </div>
        </header>

        {error && (
          <div className="mt-5 flex items-start justify-between gap-4 rounded-xl border border-rose-400/25 bg-rose-400/[0.07] px-4 py-3 text-sm text-rose-100">
            <span>{error}</span>
            <button type="button" aria-label="Dismiss error" onClick={() => setError(null)}><X className="h-4 w-4" /></button>
          </div>
        )}

        <section className="mt-5 grid gap-3 md:grid-cols-3">
          <SummaryCard label="Accounts" value={String(connections.length)} detail="Paper and sandbox only" />
          <SummaryCard label="Verified" value={String(verified)} detail="Exact account confirmed" tone={verified > 0 ? 'positive' : 'neutral'} />
          <SummaryCard label="Next step" value={nextStep} detail="Trade God stays locked until every check passes" accent />
        </section>

        <section className="mt-5 rounded-2xl border border-white/[0.08] bg-[#101419] p-5 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold">Broker accounts</h2>
              <p className="mt-1 text-xs leading-5 text-[#7f8996]">Each Discord source will later be assigned to one exact account here.</p>
            </div>
            <div className="flex gap-2">
              <ConnectButton label="Connect IBKR" onClick={() => setDialogProvider('ibkr')} />
              <ConnectButton label="Connect Webull" onClick={() => setDialogProvider('webull')} secondary />
            </div>
          </div>

          <div className="mt-5">
            {loading ? (
              <div className="flex min-h-44 items-center justify-center text-sm text-[#77818e]"><LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Loading accounts</div>
            ) : connections.length === 0 ? (
              <div className="flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.1] bg-black/10 px-6 text-center">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-violet-400/[0.09] text-violet-200"><Link2 className="h-5 w-5" /></div>
                <h3 className="mt-4 text-sm font-medium">Connect your first paper account</h3>
                <p className="mt-2 max-w-md text-xs leading-5 text-[#737e8b]">Trade God will only check the account, positions, and open orders. Trading stays off.</p>
                <button type="button" onClick={() => setDialogProvider('ibkr')} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-black hover:bg-[#e7e9ec]">
                  <Plus className="h-3.5 w-3.5" /> Connect account
                </button>
              </div>
            ) : (
              <div className="grid gap-3">
                {connections.map((status) => (
                  <AccountCard
                    key={status.connection.connection_id}
                    status={status}
                    busy={busyId === status.connection.connection_id}
                    onVerify={() => void verify(status.connection.connection_id)}
                    onRemove={() => void remove(status.connection.connection_id)}
                    onActivate={() => setAuthorityConnection(status)}
                    onRevoke={() => void revokeAuthority(status.connection.connection_id)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="mt-5 grid gap-3 md:grid-cols-3">
          <SafetyPoint icon={<LockKeyhole className="h-4 w-4" />} title="Secrets stay on this Mac" detail="Tokens and keys are stored in the encrypted Trade God vault." />
          <SafetyPoint icon={<ShieldCheck className="h-4 w-4" />} title="Account must match" detail="A saved account is not trusted until the broker confirms its exact ID." />
          <SafetyPoint icon={<CheckCircle2 className="h-4 w-4" />} title="Paper first" detail="Real execution cannot be enabled from this screen." />
        </section>
      </div>

      {dialogProvider && (
        <ConnectAccountDialog
          provider={dialogProvider}
          onClose={() => setDialogProvider(null)}
          onSaved={async () => { setDialogProvider(null); await load() }}
        />
      )}
      {authorityConnection && (
        <ManualPaperDialog
          status={authorityConnection}
          onClose={() => setAuthorityConnection(null)}
          onActivated={async () => { setAuthorityConnection(null); await load() }}
        />
      )}
    </div>
  )
}

const ConnectAccountDialog: React.FC<{
  provider: OptionsProvider
  onClose(): void
  onSaved(): Promise<void>
}> = ({ provider, onClose, onSaved }) => {
  const copy = providerCopy[provider]
  const [accountRef, setAccountRef] = useState('')
  const [label, setLabel] = useState(provider === 'ibkr' ? 'IBKR Paper' : 'Webull Sandbox')
  const [accessToken, setAccessToken] = useState('')
  const [appKey, setAppKey] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [showDetails, setShowDetails] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSave = accountRef.trim() && label.trim() && (provider === 'ibkr' ? accessToken.trim() : appKey.trim() && appSecret.trim())

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      await window.electronAPI.saveOptionsConnection({
        provider,
        account_ref: accountRef.trim(),
        account_label: label.trim(),
        credential: JSON.stringify(provider === 'ibkr'
          ? { access_token: accessToken.trim() }
          : { app_key: appKey.trim(), app_secret: appSecret.trim(), ...(accessToken.trim() ? { access_token: accessToken.trim() } : {}) }),
      })
      await onSaved()
    } catch (cause) {
      setError(readableError(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`Connect ${copy.name}`}>
      <form onSubmit={save} className="w-full max-w-lg rounded-2xl border border-white/[0.1] bg-[#12161b] p-6 shadow-2xl shadow-black/60">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300">Paper setup</div>
            <h2 className="mt-1 text-xl font-semibold">Connect {copy.name}</h2>
            <p className="mt-2 text-xs leading-5 text-[#8993a0]">This connection starts read-only. Trade God cannot place an order.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-[#75808d] hover:bg-white/[0.06] hover:text-white"><X className="h-4 w-4" /></button>
        </div>

        <div className="mt-6 grid gap-4">
          <Field label="Account ID" value={accountRef} onChange={setAccountRef} placeholder={copy.accountPlaceholder} />
          <Field label="Nickname" value={label} onChange={setLabel} placeholder="My paper account" />
          {provider === 'ibkr' ? (
            <Field label="OAuth access token" value={accessToken} onChange={setAccessToken} placeholder="Paste token" secret />
          ) : (
            <>
              <Field label="App Key" value={appKey} onChange={setAppKey} placeholder="Paste App Key" />
              <Field label="App Secret" value={appSecret} onChange={setAppSecret} placeholder="Paste App Secret" secret />
              <Field label="2FA access token (if enabled)" value={accessToken} onChange={setAccessToken} placeholder="Optional in sandbox" secret optional />
            </>
          )}
        </div>

        <button type="button" onClick={() => setShowDetails((value) => !value)} className="mt-5 flex w-full items-center justify-between rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2.5 text-left text-xs text-[#9ba4af] hover:bg-white/[0.045]">
          Where do I find this?
          <ChevronDown className={`h-4 w-4 transition-transform ${showDetails ? 'rotate-180' : ''}`} />
        </button>
        {showDetails && <p className="mt-2 rounded-lg bg-black/20 px-3 py-3 text-xs leading-5 text-[#7f8996]">{copy.credentialHelp} Only the official paper/sandbox endpoint is accepted.</p>}

        {error && <p className="mt-4 rounded-lg border border-rose-400/20 bg-rose-400/[0.06] px-3 py-2.5 text-xs text-rose-100">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-xs text-[#9ba4af] hover:bg-white/[0.05] hover:text-white">Cancel</button>
          <button type="submit" disabled={!canSave || saving} className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-black hover:bg-[#e7e9ec] disabled:cursor-not-allowed disabled:opacity-40">
            {saving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
            Save securely
          </button>
        </div>
      </form>
    </div>
  )
}

const AccountCard: React.FC<{
  status: ConnectionStatus
  busy: boolean
  onVerify(): void
  onRemove(): void
  onActivate(): void
  onRevoke(): void
}> = ({ status, busy, onVerify, onRemove, onActivate, onRevoke }) => {
  const { connection, provider_read_proof: proof } = status
  const connected = status.provider_read_fresh
  const provider = providerCopy[connection.provider]
  return (
    <article className="rounded-xl border border-white/[0.08] bg-[#0b0f13] p-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${connected ? 'bg-emerald-400/[0.1] text-emerald-300' : 'bg-white/[0.05] text-[#8c96a3]'}`}>
            {connected ? <CheckCircle2 className="h-5 w-5" /> : <Link2 className="h-5 w-5" />}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-semibold">{connection.account_label}</h3>
              <span className="rounded-full border border-white/[0.08] px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] text-[#87919d]">{connection.environment}</span>
            </div>
            <p className="mt-1 text-xs text-[#737e8b]">{provider.name} · {connection.account_ref}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${connected ? 'bg-emerald-400/[0.09] text-emerald-200' : 'bg-amber-300/[0.08] text-amber-100'}`}>
            {connected ? 'Read-only verified' : 'Needs verification'}
          </span>
          <button type="button" onClick={onVerify} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] px-3 py-2 text-xs hover:bg-white/[0.05] disabled:opacity-40">
            {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {connected ? 'Check again' : 'Verify account'}
          </button>
          {status.manual_authority ? (
            <button type="button" onClick={onRevoke} disabled={busy} className="rounded-lg border border-rose-300/20 bg-rose-300/[0.06] px-3 py-2 text-xs text-rose-100 hover:bg-rose-300/[0.1] disabled:opacity-40">Lock now</button>
          ) : status.certification.state === 'eligible' ? (
            <button type="button" onClick={onActivate} disabled={busy} className="rounded-lg bg-violet-200 px-3 py-2 text-xs font-semibold text-black hover:bg-violet-100 disabled:opacity-40">Enable manual paper</button>
          ) : null}
          <button type="button" onClick={onRemove} disabled={busy} aria-label={`Remove ${connection.account_label}`} className="rounded-lg p-2 text-[#68727e] hover:bg-rose-400/[0.08] hover:text-rose-300"><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>
      {proof && (
        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-white/[0.07] pt-4 sm:grid-cols-5">
          <SmallFact label="Positions" value={String(proof.position_count)} />
          <SmallFact label="Open orders" value={String(proof.open_order_count)} />
          <SmallFact label="Options data" value={proof.option_quotes_realtime ? 'Live' : 'Not proven'} warn={!proof.option_quotes_realtime} />
          <SmallFact
            label="Safety test"
            value={status.certification.state === 'eligible' ? 'Passed' : status.certification.state === 'blocked' ? 'Needs attention' : 'Not run'}
            warn={status.certification.state !== 'eligible'}
          />
          <SmallFact label="Trading" value={status.manual_authority ? 'Manual paper only' : 'Locked'} />
        </div>
      )}
    </article>
  )
}

const ManualPaperDialog: React.FC<{ status: ConnectionStatus; onClose(): void; onActivated(): Promise<void> }> = ({ status, onClose, onActivated }) => {
  const [maxDebit, setMaxDebit] = useState('100')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activate = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!confirmed || !maxDebit.trim()) return
    setBusy(true); setError(null)
    try {
      const certificationExpiry = status.certification.expires_at
        ? Date.parse(status.certification.expires_at)
        : Number.NaN
      const validUntilMs = Math.min(
        Date.now() + 30 * 60 * 1000,
        Number.isFinite(certificationExpiry) ? certificationExpiry - 1_000 : Number.POSITIVE_INFINITY,
      )
      if (!Number.isFinite(validUntilMs) || validUntilMs <= Date.now()) {
        throw new Error('The paper safety test has expired. Run it again before enabling manual orders.')
      }
      const validUntil = new Date(validUntilMs).toISOString()
      await window.electronAPI.activateOptionsManualAuthority(status.connection.connection_id, maxDebit.trim(), validUntil, true)
      await onActivated()
    } catch (cause) { setError(readableError(cause)) } finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Enable manual paper testing">
      <form onSubmit={activate} className="w-full max-w-md rounded-2xl border border-white/[0.1] bg-[#12161b] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div><div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300">30-minute access</div><h2 className="mt-1 text-lg font-semibold">Enable manual paper testing</h2></div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-2 text-[#75808d] hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <p className="mt-3 text-xs leading-5 text-[#8993a0]">Only the certified contract on {status.connection.account_label} is allowed. Discord automation stays off.</p>
        <div className="mt-5"><Field label="Maximum debit per order" value={maxDebit} onChange={setMaxDebit} placeholder="100" /></div>
        <label className="mt-4 flex items-start gap-3 rounded-xl border border-white/[0.08] bg-black/20 p-3 text-xs leading-5 text-[#aab2bc]">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />
          I understand every order still requires my confirmation and uses this paper/sandbox account only.
        </label>
        {error && <p className="mt-3 text-xs text-rose-200">{error}</p>}
        <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="px-4 py-2 text-xs text-[#9ba4af]">Cancel</button><button disabled={!confirmed || busy} className="rounded-lg bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-40">{busy ? 'Enabling…' : 'Enable for 30 minutes'}</button></div>
      </form>
    </div>
  )
}

const Field: React.FC<{ label: string; value: string; onChange(value: string): void; placeholder: string; secret?: boolean; optional?: boolean }> = ({ label, value, onChange, placeholder, secret, optional }) => (
  <label className="grid gap-1.5 text-xs font-medium text-[#b7bec7]">
    <span>{label}{optional && <span className="ml-1 font-normal text-[#69737f]">optional</span>}</span>
    <input type={secret ? 'password' : 'text'} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} autoComplete="off" className="h-10 rounded-lg border border-white/[0.1] bg-[#090c10] px-3 text-sm text-white outline-none placeholder:text-[#4e5864] focus:border-violet-300/45" />
  </label>
)

const ConnectButton: React.FC<{ label: string; onClick(): void; secondary?: boolean }> = ({ label, onClick, secondary }) => (
  <button type="button" onClick={onClick} className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors ${secondary ? 'border border-white/[0.1] bg-white/[0.035] text-white hover:bg-white/[0.07]' : 'bg-white text-black hover:bg-[#e7e9ec]'}`}>
    <Plus className="h-3.5 w-3.5" /> {label}
  </button>
)

const SummaryCard: React.FC<{ label: string; value: string; detail: string; tone?: 'positive' | 'neutral'; accent?: boolean }> = ({ label, value, detail, tone, accent }) => (
  <div className={`rounded-xl border p-4 ${accent ? 'border-violet-300/20 bg-violet-300/[0.055]' : 'border-white/[0.08] bg-[#101419]'}`}>
    <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[#697481]">{label}</div>
    <div className={`mt-2 text-sm font-semibold ${tone === 'positive' ? 'text-emerald-300' : 'text-white'}`}>{value}</div>
    <div className="mt-1 text-[10px] leading-4 text-[#717c88]">{detail}</div>
  </div>
)

const SafetyPoint: React.FC<{ icon: React.ReactNode; title: string; detail: string }> = ({ icon, title, detail }) => (
  <div className="rounded-xl border border-white/[0.07] bg-[#0d1115] p-4">
    <div className="flex items-center gap-2 text-xs font-medium text-[#d9dde2]"><span className="text-violet-300">{icon}</span>{title}</div>
    <p className="mt-2 text-[11px] leading-5 text-[#717c88]">{detail}</p>
  </div>
)

const SmallFact: React.FC<{ label: string; value: string; warn?: boolean }> = ({ label, value, warn }) => (
  <div>
    <div className="text-[9px] uppercase tracking-[0.14em] text-[#5e6874]">{label}</div>
    <div className={`mt-1 text-xs font-medium ${warn ? 'text-amber-200' : 'text-[#d9dde2]'}`}>{value}</div>
  </div>
)

const readableError = (cause: unknown): string => {
  const message = cause instanceof Error ? cause.message : String(cause)
  return message.replace(/^Error invoking remote method '[^']+': Error:\s*/i, '').replace(/^Error:\s*/i, '')
}

export default OptionsControlCenterPage
