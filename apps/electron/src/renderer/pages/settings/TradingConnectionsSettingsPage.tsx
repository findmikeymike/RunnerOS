import * as React from 'react'
import {
  ExternalLink,
  KeyRound,
  Loader2,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'

import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SettingsCard, SettingsCardContent, SettingsSection } from '@/components/settings'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import {
  TRADING_CONNECTION_SCHEMA_VERSION,
  type ExecutionEnvironment,
  type ExecutionTransportPreference,
  type TradingConnection,
} from '@trade-god/contracts'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'trading-connections',
}

const EMPTY_CAPABILITIES = {
  read_accounts: false,
  read_orders: false,
  read_positions: false,
  read_executions: false,
  submit_market: false,
  submit_limit: false,
  submit_stop: false,
  submit_stop_limit: false,
  native_bracket: false,
  native_oco: false,
  modify_order: false,
  cancel_order: false,
  partial_close: false,
  flatten: false,
  streaming_events: false,
}

type Draft = {
  displayName: string
  platform: 'tradovate' | 'wealthcharts'
  environment: ExecutionEnvironment
  accountRef: string
  accountLabel: string
  apiSecret: string
  authorizationEvidenceRef: string
}

const EMPTY_DRAFT: Draft = {
  displayName: '',
  platform: 'tradovate',
  environment: 'paper',
  accountRef: '',
  accountLabel: '',
  apiSecret: '',
  authorizationEvidenceRef: '',
}

export default function TradingConnectionsSettingsPage() {
  const [connections, setConnections] = React.useState<
    Awaited<ReturnType<typeof window.electronAPI.listTradingConnections>>
  >([])
  const [draft, setDraft] = React.useState<Draft>(EMPTY_DRAFT)
  const [editing, setEditing] = React.useState(false)
  const [busy, setBusy] = React.useState<string | null>('load')

  const load = React.useCallback(async () => {
    setBusy('load')
    try {
      setConnections(await window.electronAPI.listTradingConnections())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load trading connections')
    } finally {
      setBusy(null)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    const accountRef = draft.accountRef.trim()
    const displayName = draft.displayName.trim()
    const accountLabel = draft.accountLabel.trim()
    const evidenceRef = draft.authorizationEvidenceRef.trim()
    if (!displayName || !accountRef || !accountLabel || !evidenceRef) {
      toast.error('Name, account reference, account label, and authorization evidence are required')
      return
    }
    if (draft.platform === 'tradovate' && !draft.apiSecret.trim()) {
      toast.error('Tradovate credentials are required')
      return
    }
    setBusy('save')
    try {
      const now = new Date().toISOString()
      const transport: ExecutionTransportPreference = draft.platform === 'tradovate'
        ? 'api'
        : 'browser'
      const connectionId = [
        'connection',
        'apex',
        draft.platform,
        draft.environment,
        accountRef,
      ].join('-').replace(/[^A-Za-z0-9._:@-]/g, '-').slice(0, 150)
      const connection: TradingConnection = {
        connection_schema_version: TRADING_CONNECTION_SCHEMA_VERSION,
        connection_id: connectionId,
        display_name: displayName,
        firm: { slug: 'apex', name: 'Apex Trader Funding' },
        platform: draft.platform === 'tradovate'
          ? { slug: 'tradovate', name: 'Tradovate' }
          : { slug: 'wealthcharts', name: 'WealthCharts' },
        environment: draft.environment,
        environment_class: draft.environment === 'paper' ? 'rehearsal' : 'consequential',
        transport_preference: transport,
        account_ref: accountRef,
        account_display: { label: accountLabel },
        ...(transport === 'api' ? { credential_ref: 'assigned-by-trusted-runtime' } : {}),
        ...(transport === 'browser' ? { browser_session_ref: 'assigned-by-trusted-runtime' } : {}),
        risk_policy_ref: `risk-policy-${draft.environment}`,
        authorization_basis_ref: evidenceRef,
        approval_policy_ref: 'approval-policy-per-order',
        state: 'auth-required',
        capabilities: EMPTY_CAPABILITIES,
        certifications: [],
        enabled: false,
        created_at: now,
        updated_at: now,
      }
      await window.electronAPI.saveTradingConnection({
        connection,
        ...(transport === 'api' ? { api_secret: draft.apiSecret.trim() } : {}),
      })
      setDraft(EMPTY_DRAFT)
      setEditing(false)
      await load()
      toast.success('Trading connection saved disabled')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save trading connection')
    } finally {
      setBusy(null)
    }
  }

  const remove = async (connectionId: string) => {
    setBusy(`remove:${connectionId}`)
    try {
      await window.electronAPI.removeTradingConnection(connectionId)
      await load()
      toast.success('Trading connection removed')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not remove trading connection')
    } finally {
      setBusy(null)
    }
  }

  const openLogin = async (connectionId: string) => {
    setBusy(`login:${connectionId}`)
    try {
      await window.electronAPI.openTradingConnectionLogin(connectionId)
      toast.success('Isolated trading login opened')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not open trading login')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <PanelHeader
        title="Trading Connections"
        actions={(
          <Button size="sm" onClick={() => setEditing(true)}>
            <Plus className="mr-1.5 size-4" />
            Add connection
          </Button>
        )}
      />
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-4xl space-y-6 p-6">
          <SettingsSection
            title="Execution custody"
            description="Secrets stay in the encrypted desktop vault. Browser sessions use a trading-only partition."
          >
            <div className="grid gap-3 md:grid-cols-3">
              <Guardrail label="Default state" value="Disabled" />
              <Guardrail label="First API route" value="Tradovate paper" />
              <Guardrail label="First browser route" value="WealthCharts paper" />
            </div>
          </SettingsSection>

          {editing && (
            <SettingsSection
              title="Add connection"
              description="Adding credentials never enables order entry. Certification is a separate gate."
            >
              <SettingsCard>
                <SettingsCardContent className="grid gap-4 p-5 md:grid-cols-2">
                  <Field label="Display name">
                    <input
                      className={inputClass}
                      value={draft.displayName}
                      onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
                      placeholder="Apex Tradovate Paper"
                    />
                  </Field>
                  <Field label="Platform">
                    <select
                      className={inputClass}
                      value={draft.platform}
                      onChange={(event) => setDraft({
                        ...draft,
                        platform: event.target.value as Draft['platform'],
                        apiSecret: '',
                      })}
                    >
                      <option value="tradovate">Tradovate API</option>
                      <option value="wealthcharts">WealthCharts browser</option>
                    </select>
                  </Field>
                  <Field label="Environment">
                    <select
                      className={inputClass}
                      value={draft.environment}
                      onChange={(event) => setDraft({
                        ...draft,
                        environment: event.target.value as ExecutionEnvironment,
                      })}
                    >
                      <option value="paper">Paper</option>
                      <option value="evaluation">Evaluation</option>
                      <option value="performance">Performance</option>
                      <option value="live">Live</option>
                    </select>
                  </Field>
                  <Field label="Account reference">
                    <input
                      className={inputClass}
                      value={draft.accountRef}
                      onChange={(event) => setDraft({ ...draft, accountRef: event.target.value })}
                      placeholder="Stable internal account ID"
                    />
                  </Field>
                  <Field label="Account label">
                    <input
                      className={inputClass}
                      value={draft.accountLabel}
                      onChange={(event) => setDraft({ ...draft, accountLabel: event.target.value })}
                      placeholder="APEX-1234"
                    />
                  </Field>
                  <Field label="Authorization evidence reference">
                    <input
                      className={inputClass}
                      value={draft.authorizationEvidenceRef}
                      onChange={(event) => setDraft({
                        ...draft,
                        authorizationEvidenceRef: event.target.value,
                      })}
                      placeholder="evidence-apex-owner-consent"
                    />
                  </Field>
                  {draft.platform === 'tradovate' && (
                    <Field label="API credential" className="md:col-span-2">
                      <input
                        className={inputClass}
                        type="password"
                        value={draft.apiSecret}
                        onChange={(event) => setDraft({ ...draft, apiSecret: event.target.value })}
                        placeholder="Stored encrypted; never returned to the renderer"
                      />
                    </Field>
                  )}
                  <div className="flex justify-end gap-2 md:col-span-2">
                    <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                    <Button onClick={() => void save()} disabled={busy === 'save'}>
                      {busy === 'save' && <Loader2 className="mr-1.5 size-4 animate-spin" />}
                      Save disabled
                    </Button>
                  </div>
                </SettingsCardContent>
              </SettingsCard>
            </SettingsSection>
          )}

          <SettingsSection
            title="Accounts"
            description="A connection cannot execute until account identity and paper lifecycle certification are proven."
          >
            <div className="space-y-3">
              {connections.map((status) => (
                <SettingsCard key={status.connection.connection_id}>
                  <SettingsCardContent className="space-y-4 p-5">
                    <div className="flex flex-col gap-4 md:flex-row md:items-center">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
                        {status.connection.transport_preference === 'browser'
                          ? <ExternalLink className="size-4 text-cyan-300" />
                          : <KeyRound className="size-4 text-amber-300" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{status.connection.display_name}</p>
                          <Badge>{status.connection.environment}</Badge>
                          <Badge>{status.connection.state}</Badge>
                          <Badge>{status.connection.enabled ? 'enabled' : 'disabled'}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {status.connection.firm.name} · {status.connection.platform.name} · {status.connection.account_display.label}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {status.credential_configured ? 'Credential configured' : ''}
                          {status.browser_session_configured ? 'Dedicated browser session configured' : ''}
                          {' · '}{status.connection.certifications.length} certifications
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {status.connection.transport_preference !== 'api' && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy === `login:${status.connection.connection_id}`}
                            onClick={() => void openLogin(status.connection.connection_id)}
                          >
                            <ExternalLink className="mr-1.5 size-3.5" />
                            Open login
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${status.connection.display_name}`}
                          disabled={busy === `remove:${status.connection.connection_id}`}
                          onClick={() => void remove(status.connection.connection_id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                    <CertificationMatrix evidence={status.certification_evidence[0]} />
                  </SettingsCardContent>
                </SettingsCard>
              ))}
              {!connections.length && busy !== 'load' && (
                <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-muted-foreground">
                  No trading connections yet.
                </div>
              )}
            </div>
          </SettingsSection>

          <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] px-4 py-3 text-xs text-emerald-200/80">
            <ShieldCheck className="size-4 shrink-0" />
            Credentials alone cannot activate evaluation, performance, or live execution.
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}

function CertificationMatrix(props: {
  evidence?: Awaited<
    ReturnType<typeof window.electronAPI.listTradingConnections>
  >[number]['certification_evidence'][number]
}) {
  if (!props.evidence) {
    return (
      <div className="rounded-lg border border-white/10 bg-black/10 px-3 py-2 text-[11px] text-muted-foreground">
        No adapter certification evidence. Connection remains disabled.
      </div>
    )
  }
  const passed = props.evidence.scenarios.filter((scenario) => scenario.status === 'pass').length
  return (
    <div className="grid gap-2 rounded-lg border border-white/10 bg-black/10 p-3 text-[11px] md:grid-cols-4">
      <div>
        <p className="text-muted-foreground">Adapter evidence</p>
        <p className="mt-1 font-mono">{props.evidence.adapter_id} {props.evidence.adapter_version}</p>
      </div>
      <div>
        <p className="text-muted-foreground">Forced failures</p>
        <p className="mt-1">{passed}/{props.evidence.scenarios.length} passed</p>
      </div>
      <div>
        <p className="text-muted-foreground">Paper lifecycle soak</p>
        <p className="mt-1">
          {props.evidence.soak.completed_lifecycles}/50 attempted · {
            props.evidence.soak.duplicate_submissions
            + props.evidence.soak.unprotected_positions
            + props.evidence.soak.unresolved_divergences
            + props.evidence.soak.incomplete_closes
          } critical defects
        </p>
      </div>
      <div>
        <p className="text-muted-foreground">Gate</p>
        <p className="mt-1">
          {props.evidence.eligible_certifications.includes('paper-lifecycle-certified')
            ? 'Paper lifecycle certified'
            : `${props.evidence.blockers.length} blockers`}
        </p>
      </div>
    </div>
  )
}

function Field(props: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <label className={props.className}>
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{props.label}</span>
      {props.children}
    </label>
  )
}

function Guardrail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  )
}

const inputClass = 'h-9 w-full rounded-lg border border-white/10 bg-black/20 px-3 text-sm outline-none transition focus:border-amber-400/50'
