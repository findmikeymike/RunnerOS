import * as React from 'react'
import { CheckCircle2, ChevronDown, ExternalLink, KeyRound, Loader2, Mail, RefreshCcw } from 'lucide-react'
import type { ComposioStatus } from '@craft-agent/shared/composio'
import { SettingsCard } from '@/components/settings'
import { composioErrorMessage } from '@/lib/composio-errors'

const controlClass = 'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[8px] border border-white/[0.065] bg-white/[0.035] px-2.5 text-xs font-medium text-white/60 transition-colors hover:bg-white/[0.07] hover:text-white/85 disabled:opacity-40'
const statusLabels: Record<ComposioStatus['state'], string> = {
  not_configured: 'Optional · Gmail',
  not_connected: 'Key verified · Connect Gmail next',
  pending: 'Waiting for Google sign-in',
  connected: 'Gmail connected',
  expired: 'Gmail needs reconnecting',
  error: 'Connection needs attention',
}

export function ComposioConnectionCard({ workspaceId, onReadyChange }: {
  workspaceId: string
  onReadyChange: (ready: boolean) => void
}) {
  const [status, setStatus] = React.useState<ComposioStatus | null>(null)
  const [keyDraft, setKeyDraft] = React.useState('')
  const [detailsOpen, setDetailsOpen] = React.useState(false)
  const [forgetOpen, setForgetOpen] = React.useState(false)
  const [busy, setBusy] = React.useState<string | null>('status')
  const [error, setError] = React.useState<string | null>(null)
  const [pollExpired, setPollExpired] = React.useState(false)
  const generation = React.useRef(0)
  const pollDeadline = React.useRef(0)
  const onReadyRef = React.useRef(onReadyChange)
  onReadyRef.current = onReadyChange

  const acceptStatus = React.useCallback((next: ComposioStatus) => {
    setStatus(next)
    onReadyRef.current(next.state === 'connected')
  }, [])

  React.useEffect(() => {
    const request = ++generation.current
    setKeyDraft('')
    setStatus(null)
    setError(null)
    setBusy('status')
    setPollExpired(false)
    pollDeadline.current = Date.now() + 120_000
    onReadyRef.current(false)
    void window.electronAPI.composioRefresh(workspaceId).then(next => {
      if (request === generation.current) acceptStatus(next)
    }).catch(error => {
      if (request === generation.current) setError(composioErrorMessage(error, 'status'))
    }).finally(() => {
      if (request === generation.current) setBusy(null)
    })
    return () => { generation.current++ }
  }, [workspaceId, acceptStatus])

  React.useEffect(() => {
    if (status?.state !== 'pending' || busy || pollExpired) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const request = generation.current
    const poll = async () => {
      if (cancelled || request !== generation.current) return
      if (Date.now() >= pollDeadline.current) {
        setPollExpired(true)
        return
      }
      try {
        const next = await window.electronAPI.composioRefresh(workspaceId)
        if (cancelled || request !== generation.current) return
        acceptStatus(next)
        if (next.state === 'pending') timer = setTimeout(poll, 3000)
      } catch {
        if (!cancelled && request === generation.current) {
          setPollExpired(true)
          setError('Could not check sign-in. Finish in your browser, then refresh here.')
        }
      }
    }
    timer = setTimeout(poll, 3000)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [workspaceId, status?.state, busy, pollExpired, acceptStatus])

  const run = async (action: string, operation: () => Promise<void>) => {
    if (busy) return
    const request = ++generation.current
    setBusy(action)
    setError(null)
    try {
      await operation()
    } catch (error) {
      if (request === generation.current) {
        setError(composioErrorMessage(error, action))
      }
    } finally {
      if (request === generation.current) setBusy(null)
    }
  }

  const refresh = () => run('refresh', async () => {
    const request = generation.current
    const next = await window.electronAPI.composioRefresh(workspaceId)
    if (request !== generation.current) return
    acceptStatus(next)
    pollDeadline.current = Date.now() + 120_000
    setPollExpired(false)
  })

  const save = () => run('save', async () => {
    const request = generation.current
    const key = keyDraft.trim()
    setKeyDraft('')
    const next = await window.electronAPI.composioSaveKey(workspaceId, key)
    if (request === generation.current) acceptStatus(next)
  })

  const connect = () => run('connect', async () => {
    const request = generation.current
    const result = await window.electronAPI.composioConnect(workspaceId)
    if (request !== generation.current) return
    acceptStatus({ configured: true, state: 'pending' })
    pollDeadline.current = Date.now() + 120_000
    setPollExpired(false)
    await window.electronAPI.openUrl(result.redirectUrl)
  })

  const forget = () => run('forget', async () => {
    const request = generation.current
    const next = await window.electronAPI.composioDisconnect(workspaceId)
    if (request !== generation.current) return
    acceptStatus(next)
    setForgetOpen(false)
    setKeyDraft('')
  })

  return (
    <SettingsCard className="!border-0 bg-[#111113] shadow-none">
      <div className="space-y-3 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-[#f68245]" />
              <h3 className="text-sm font-semibold text-white/90">Composio</h3>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-white/40" aria-label="Updating Composio" />
                : status?.state === 'connected' ? <CheckCircle2 className="h-4 w-4 text-emerald-400/80" /> : null}
            </div>
            <p className="mt-1 text-xs text-white/45" role="status">{status ? statusLabels[status.state] : busy ? 'Checking connection…' : 'Connection unavailable'}</p>
            {status?.accountLabel ? <p className="mt-1 truncate text-xs text-white/50">{status.accountLabel}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={controlClass} onClick={() => void refresh()} disabled={Boolean(busy)} aria-label="Refresh Composio connection">
              <RefreshCcw className="h-3.5 w-3.5" /> Refresh
            </button>
            {status?.configured && status.state !== 'connected' ? (
              <button type="button" className={controlClass} onClick={() => void connect()} disabled={Boolean(busy)}>
                <ExternalLink className="h-3.5 w-3.5" />{status.state === 'pending' ? 'Reopen sign-in' : status.state === 'expired' ? 'Reconnect Gmail' : 'Connect Gmail'}
              </button>
            ) : null}
            <button type="button" className={controlClass} aria-expanded={detailsOpen} aria-controls="composio-setup" onClick={() => { setDetailsOpen(open => !open); setKeyDraft('') }}>
              {status?.configured ? 'Manage' : 'Set up'}<ChevronDown className={`h-3.5 w-3.5 transition-transform ${detailsOpen ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>
        {status?.state === 'pending' ? <p className="text-xs text-white/55">{pollExpired ? 'Automatic checking paused. Finish Google sign-in in your browser, then click Refresh.' : 'Finish Google sign-in in your browser. This page checks for up to two minutes.'}</p> : null}
        {error || status?.error ? <p className="text-xs text-amber-300/80" role="alert">{error || status?.error}</p> : null}
        {detailsOpen ? (
          <div id="composio-setup" className="space-y-3 border-t border-white/[0.06] pt-3 text-xs text-white/55">
            <p>Connect Gmail without creating your own Google OAuth app. Composio hosts sign-in and stores your Google access tokens; Gmail requests pass through Composio. Its account usage limits apply.</p>
            <ol className="list-decimal space-y-1.5 pl-4">
              <li><button type="button" className="text-[#ff9a62] hover:underline" onClick={() => void window.electronAPI.openUrl('https://dashboard.composio.dev').catch(() => setError('Could not open the browser. Visit dashboard.composio.dev to get your key.'))}>Open Composio <ExternalLink className="inline h-3 w-3" /></button>, create an account, then go to Platform and select your project.</li>
              <li>Open Settings → API Keys → Create API Key. Copy the key below; Artist OS saves it securely on this host.</li>
              <li>Save and verify, then choose Connect Gmail and approve Google sign-in. Return here to confirm the connection.</li>
            </ol>
            <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); if (keyDraft.trim()) void save() }}>
              <label className="sr-only" htmlFor="composio-api-key">Composio project API key</label>
              <input id="composio-api-key" type="password" autoComplete="off" spellCheck={false} value={keyDraft} onChange={event => setKeyDraft(event.target.value)} placeholder={status?.configured ? 'Replace project API key' : 'Project API key'} disabled={Boolean(busy)} className="h-8 min-w-48 flex-1 rounded-[8px] border border-white/[0.07] bg-black/20 px-2.5 text-sm text-white/80 outline-none focus:border-[#fb923c]/45" />
              <button type="submit" className={controlClass} disabled={Boolean(busy) || !keyDraft.trim()}><KeyRound className="h-3.5 w-3.5" />Save and verify</button>
            </form>
            <p>Gmail search, reading, and drafts are available through this connection. Sending still requires approval. Existing Google connections stay separate.</p>
            {status?.configured ? <div className="space-y-2">
              {forgetOpen ? <>
                <p>Forget the saved Composio key and Gmail link in Artist OS? To revoke Google access too, remove the connected account in Composio or revoke Composio in your Google account.</p>
                <div className="flex gap-2"><button type="button" className={controlClass} disabled={Boolean(busy)} onClick={() => void forget()}>Forget integration</button><button type="button" className={controlClass} disabled={Boolean(busy)} onClick={() => setForgetOpen(false)}>Cancel</button></div>
              </> : <button type="button" className="text-white/45 underline underline-offset-2 hover:text-white/75" onClick={() => setForgetOpen(true)}>Forget integration…</button>}
            </div> : null}
          </div>
        ) : null}
      </div>
    </SettingsCard>
  )
}
