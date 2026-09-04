import * as React from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Globe,
  History,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Upload,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useWorkspaceSyncRefresh } from '@/hooks/useWorkspaceSyncRefresh'

interface WebsitePageProps {
  workspaceId: string
}

interface DeployEntry {
  id: string
  target: 'preview' | 'production'
  at: string
  url: string
  buildHash: string
  status: 'live' | 'superseded' | 'rolled-back' | 'failed'
  canRollBackTo: boolean
  origin?: { kind: string; agentSlug?: string; automationId?: string }
}

interface ReceiptEntry {
  id: string
  kind: string
  at: string
  summary: string
  approval: { tier: 'free' | 'one-click' | 'trusted' }
  counts?: { imported?: number; recipients?: number }
}

interface WebsiteStatus {
  ok: boolean
  error?: string
  mode?: string
  adapter?: string
  live?: boolean
  urls?: { preview?: string; production?: string }
  domain?: { name: string; state: string; steps?: string[] }
  lastBuild?: { at: string; hash: string; auditScore: number; warnings: number }
  publishPolicy?: { contentOnly: 'auto' | 'needs-you'; trustedGrantedAt?: string; cleanPublishStreak?: number }
  trustedModeEligible?: boolean
  targetApproved?: boolean
  liveDeploy?: { id: string; at: string; url: string; buildHash: string }
  hostError?: string
  routine?: RoutineConfig
  pendingBrief?: Brief
}

type Cadence = 'weekly' | 'monthly' | 'manual'

interface RoutineConfig {
  cadence: Cadence
  dayOfWeek?: number
  dayOfMonth?: number
  hour?: number
  lastRunAt?: string
}

interface Brief {
  runId: string
  weekOf: string
  cadence: Cadence
  site?: {
    buildHash: string
    summary: string
    auditScore: number
    tier: 'one-click' | 'trusted'
  }
  subscribers?: { imported: number; duplicates: number; skippedSuppressed: number }
  notes: string[]
  nothingToDo?: true
}

function relative(at: string): string {
  const diff = Date.now() - Date.parse(at)
  if (!Number.isFinite(diff)) return ''
  const days = Math.floor(diff / 86_400_000)
  if (days > 1) return `${days} days ago`
  if (days === 1) return 'yesterday'
  const hours = Math.floor(diff / 3_600_000)
  if (hours >= 1) return `${hours}h ago`
  const minutes = Math.max(1, Math.floor(diff / 60_000))
  return `${minutes}m ago`
}

const TIER_LABEL: Record<string, string> = {
  free: 'automatic',
  'one-click': 'you approved',
  trusted: 'trusted mode',
}

export function WebsitePage({ workspaceId }: WebsitePageProps) {
  const [status, setStatus] = React.useState<WebsiteStatus | null>(null)
  const [deploys, setDeploys] = React.useState<DeployEntry[]>([])
  const [receipts, setReceipts] = React.useState<ReceiptEntry[]>([])
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [domainDraft, setDomainDraft] = React.useState('')

  const refresh = React.useCallback(async (showSpinner = true) => {
    if (!workspaceId) return
    if (showSpinner) setLoading(true)
    try {
      const [next, history] = await Promise.all([
        window.electronAPI.getWebsiteStatus(workspaceId),
        window.electronAPI.getWebsiteHistory(workspaceId, 20),
      ])
      setStatus(next as unknown as WebsiteStatus)
      setDeploys(((history as unknown as { deploys?: DeployEntry[] })?.deploys) ?? [])
      setReceipts(((history as unknown as { receipts?: ReceiptEntry[] })?.receipts) ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not read the website.')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  React.useEffect(() => { void refresh() }, [refresh])
  useWorkspaceSyncRefresh(workspaceId, ['records'], () => refresh(false))

  const run = React.useCallback(async (
    key: string,
    action: () => Promise<{ ok?: boolean; error?: string; [k: string]: unknown }>,
    success: string,
  ) => {
    setBusy(key)
    try {
      const result = await action()
      if (result?.ok === false) {
        toast.error(String(result.error ?? 'That did not work.'))
        return null
      }
      toast.success(success)
      await refresh(false)
      return result
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That did not work.')
      return null
    } finally {
      setBusy(null)
    }
  }, [refresh])

  const buildHash = status?.lastBuild?.hash
  const liveHash = status?.liveDeploy?.buildHash
  const hasUnpublishedBuild = Boolean(buildHash && buildHash !== liveHash)
  const trustedOn = status?.publishPolicy?.contentOnly === 'auto' && Boolean(status?.publishPolicy?.trustedGrantedAt)

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-white/30" />
      </div>
    )
  }

  if (!status?.ok) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <Globe className="h-6 w-6 text-white/25" />
        <p className="text-[13px] text-white/50">No website in this workspace yet.</p>
        <p className="max-w-sm text-[11px] leading-5 text-white/30">
          Ask your Website Agent to build one, or say &ldquo;build me a site&rdquo; in any session.
        </p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[19px] font-semibold tracking-tight text-white/90">Website</h1>
            <p className="mt-1 text-[12px] text-white/40">
              {status.mode === 'managed' ? 'Managed by Artist OS' : `Mode: ${status.mode}`}
            </p>
          </div>
          <StatusPill live={Boolean(status.live)} hostError={status.hostError} />
        </header>

        <section className="rounded-[14px] border border-white/[0.06] bg-white/[0.02] p-4">
          <Row label="Live at">
            {status.urls?.production ? (
              <a
                href={status.urls.production}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 text-white/70 hover:text-white"
              >
                {status.domain?.state === 'active' ? status.domain.name : status.urls.production}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : <span className="text-white/30">Not published yet</span>}
          </Row>

          <Row label="Domain">
            {status.domain
              ? <DomainState domain={status.domain} />
              : <span className="text-white/30">Using the default address</span>}
          </Row>

          <Row label="Last build">
            {status.lastBuild ? (
              <span className="text-white/60">
                {relative(status.lastBuild.at)} · SEO {status.lastBuild.auditScore}/100
                {status.lastBuild.warnings > 0 ? ` · ${status.lastBuild.warnings} to fix` : ''}
              </span>
            ) : <span className="text-white/30">Never built</span>}
          </Row>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run('build', () => window.electronAPI.buildWebsite(workspaceId), 'Site rebuilt.')}
              className="h-8 rounded-[8px] border border-white/[0.08] px-3 text-[12px] text-white/70 transition-colors hover:bg-white/[0.04] disabled:opacity-40"
            >
              {busy === 'build' ? 'Building…' : 'Rebuild'}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run('preview', () => window.electronAPI.previewWebsite(workspaceId, {}), 'Preview ready.')}
              className="h-8 rounded-[8px] border border-white/[0.08] px-3 text-[12px] text-white/70 transition-colors hover:bg-white/[0.04] disabled:opacity-40"
            >
              Preview
            </button>

            {hasUnpublishedBuild && buildHash ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void run(
                  'publish',
                  () => window.electronAPI.publishWebsite(workspaceId, { buildHash, summary: 'Published from the Website page.' }),
                  'Site published.',
                )}
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-emerald-200/90 px-3 text-[12px] font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <Upload className="h-3.5 w-3.5" />
                {busy === 'publish' ? 'Publishing…' : 'Publish'}
              </button>
            ) : null}

            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run(
                'capture',
                () => window.electronAPI.syncWebsiteCapture(workspaceId, {}),
                'Signups pulled in.',
              )}
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-white/[0.08] px-3 text-[12px] text-white/60 transition-colors hover:bg-white/[0.04] disabled:opacity-40"
            >
              <Users className="h-3.5 w-3.5" />
              Pull signups
            </button>
          </div>

          {!status.targetApproved ? (
            <p className="mt-3 rounded-[9px] border border-amber-300/15 bg-amber-300/[0.05] px-3 py-2 text-[11px] leading-5 text-amber-100/70">
              The first live publish needs you to approve the destination once. Publishing will ask.
            </p>
          ) : null}
        </section>

        {status.pendingBrief ? (
          <BriefCard
            brief={status.pendingBrief}
            busy={busy}
            onPublish={(buildHash, summary) => void run(
              'publishBrief',
              () => window.electronAPI.publishWebsite(workspaceId, { buildHash, summary }),
              'Site published.',
            )}
            onDismiss={() => void run('dismissBrief', () => window.electronAPI.clearWebsiteBrief(workspaceId), 'Cleared.')}
          />
        ) : null}

        <RoutineCadence
          routine={status.routine}
          busy={busy}
          onRun={() => void run('routine', () => window.electronAPI.runWebsiteRoutine(workspaceId), 'Checked the site.')}
          onChange={(config) => void run(
            'cadence',
            () => window.electronAPI.setWebsiteRoutine(workspaceId, config),
            'Saved.',
          )}
        />

        <TrustedMode
          status={status}
          trustedOn={trustedOn}
          busy={busy}
          onToggle={(enabled) => void run(
            'trusted',
            () => window.electronAPI.setWebsiteTrustedMode(workspaceId, enabled),
            enabled ? 'Trusted mode is on for content changes.' : 'Trusted mode is off.',
          )}
        />

        {status.domain?.state !== 'active' ? (
          <section className="mt-4 rounded-[14px] border border-white/[0.06] bg-white/[0.02] p-4">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-white/40">Your own domain</h2>
            <div className="mt-3 flex items-center gap-2">
              <input
                value={domainDraft}
                onChange={(event) => setDomainDraft(event.target.value)}
                placeholder="yourname.com"
                className="h-8 flex-1 rounded-[8px] border border-white/[0.08] bg-transparent px-2.5 text-[12px] text-white/80 outline-none placeholder:text-white/25 focus:border-white/20"
              />
              <button
                type="button"
                disabled={busy !== null || domainDraft.trim().length < 3}
                onClick={() => void run(
                  'domain',
                  () => window.electronAPI.setWebsiteDomain(workspaceId, domainDraft.trim()),
                  'Domain connected. Follow the steps to finish.',
                )}
                className="h-8 rounded-[8px] border border-white/[0.08] px-3 text-[12px] text-white/70 transition-colors hover:bg-white/[0.04] disabled:opacity-40"
              >
                Connect
              </button>
            </div>
            {status.domain?.steps?.length ? (
              <ol className="mt-3 space-y-1.5 text-[11px] leading-5 text-white/45">
                {status.domain.steps.map((step, index) => (
                  <li key={step} className="flex gap-2">
                    <span className="text-white/25 tabular-nums">{index + 1}.</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            ) : null}
            {status.domain ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void run('domainCheck', () => window.electronAPI.checkWebsiteDomain(workspaceId), 'Checked.')}
                className="mt-3 text-[11px] text-white/40 underline-offset-2 hover:text-white/70 hover:underline disabled:opacity-40"
              >
                Check again
              </button>
            ) : null}
          </section>
        ) : null}

        <section className="mt-4 rounded-[14px] border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="mb-3 flex items-center gap-2">
            <History className="h-3.5 w-3.5 text-white/35" />
            <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-white/40">What changed</h2>
          </div>

          {receipts.length === 0 && deploys.length === 0 ? (
            <p className="py-4 text-center text-[11px] text-white/30">Nothing has been published yet.</p>
          ) : (
            <ul className="space-y-1">
              {receipts.slice(0, 8).map((receipt) => (
                <li key={receipt.id} className="flex items-start justify-between gap-3 rounded-[9px] px-2 py-2 hover:bg-white/[0.02]">
                  <div className="min-w-0">
                    <p className="truncate text-[12px] text-white/70">{receipt.summary}</p>
                    <p className="mt-0.5 text-[10px] uppercase tracking-[0.1em] text-white/25">
                      {relative(receipt.at)} · {TIER_LABEL[receipt.approval.tier] ?? receipt.approval.tier}
                    </p>
                  </div>
                  <RollbackButton
                    deploys={deploys}
                    receiptKind={receipt.kind}
                    busy={busy}
                    onRollback={(deployId) => void run(
                      'rollback',
                      () => window.electronAPI.rollbackWebsite(workspaceId, { deployId }),
                      'Rolled back. Trusted mode is off.',
                    )}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/[0.04] py-2 last:border-0">
      <span className="text-[11px] uppercase tracking-[0.12em] text-white/30">{label}</span>
      <span className="text-right text-[12px]">{children}</span>
    </div>
  )
}

function StatusPill({ live, hostError }: { live: boolean; hostError?: string }) {
  if (hostError) {
    return (
      <span
        title={hostError}
        className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/20 bg-amber-300/[0.06] px-2.5 py-1 text-[11px] text-amber-100/80"
      >
        <AlertTriangle className="h-3 w-3" />
        Needs setup
      </span>
    )
  }
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]',
      live
        ? 'border-emerald-300/20 bg-emerald-300/[0.06] text-emerald-100/80'
        : 'border-white/[0.08] bg-white/[0.02] text-white/40',
    )}>
      <CheckCircle2 className="h-3 w-3" />
      {live ? 'Live' : 'Not live'}
    </span>
  )
}

function DomainState({ domain }: { domain: { name: string; state: string } }) {
  const tone = domain.state === 'active' ? 'text-emerald-100/70' : domain.state === 'error' ? 'text-red-200/70' : 'text-amber-100/70'
  const label = domain.state === 'active' ? 'connected' : domain.state === 'pending-dns' ? 'waiting on DNS' : domain.state
  return <span className={tone}>{domain.name} · {label}</span>
}

/**
 * Trusted mode is offered only after the system has earned it, and the copy
 * says exactly what it does and what takes it away.
 */
function TrustedMode({
  status,
  trustedOn,
  busy,
  onToggle,
}: {
  status: WebsiteStatus
  trustedOn: boolean
  busy: string | null
  onToggle: (enabled: boolean) => void
}) {
  if (!trustedOn && !status.trustedModeEligible) {
    const streak = status.publishPolicy?.cleanPublishStreak ?? 0
    if (streak === 0) return null
    return (
      <p className="mt-4 px-1 text-[11px] text-white/30">
        {streak} of 5 publishes without a rollback. After five, Artist OS can offer to publish
        content changes on its own.
      </p>
    )
  }

  return (
    <section className="mt-4 rounded-[14px] border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className={cn('h-3.5 w-3.5', trustedOn ? 'text-emerald-200/70' : 'text-white/35')} />
            <h2 className="text-[12px] font-medium text-white/70">Publish content changes automatically</h2>
          </div>
          <p className="mt-1.5 max-w-md text-[11px] leading-5 text-white/40">
            New shows, releases, and links go live without asking. Design changes always still
            wait for you, and any rollback turns this back off.
          </p>
        </div>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => onToggle(!trustedOn)}
          className={cn(
            'h-8 shrink-0 rounded-[8px] px-3 text-[12px] font-medium transition-colors disabled:opacity-40',
            trustedOn
              ? 'border border-white/[0.08] text-white/60 hover:bg-white/[0.04]'
              : 'bg-white/90 text-black hover:opacity-90',
          )}
        >
          {trustedOn ? 'Turn off' : 'Turn on'}
        </button>
      </div>
    </section>
  )
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const CADENCE_OPTIONS: Array<{ value: Cadence; label: string; hint: string }> = [
  { value: 'weekly', label: 'Weekly', hint: 'Good if you play shows or release often.' },
  { value: 'monthly', label: 'Monthly', hint: 'Good if a few things change a year.' },
  { value: 'manual', label: 'Only when I ask', hint: 'Nothing runs on its own.' },
]

/**
 * How often the site keeps itself current.
 *
 * Manual is the default and a real choice, not a disabled state: an artist
 * who releases once a year does not want a weekly card.
 */
function RoutineCadence({
  routine,
  busy,
  onRun,
  onChange,
}: {
  routine?: RoutineConfig
  busy: string | null
  onRun: () => void
  onChange: (config: { cadence: Cadence; dayOfWeek?: number; dayOfMonth?: number; hour?: number }) => void
}) {
  const cadence = routine?.cadence ?? 'manual'
  const hour = routine?.hour ?? 9
  const active = CADENCE_OPTIONS.find(option => option.value === cadence)

  return (
    <section className="mt-4 rounded-[14px] border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[12px] font-medium text-white/70">Keep the site current</h2>
          <p className="mt-1 max-w-md text-[11px] leading-5 text-white/40">
            Adds new releases and shows, retires pre-save links once a song is out, and pulls in
            anyone who signed up. {active?.hint}
          </p>
        </div>
        <button
          type="button"
          disabled={busy !== null}
          onClick={onRun}
          className="h-8 shrink-0 rounded-[8px] border border-white/[0.08] px-3 text-[12px] text-white/70 transition-colors hover:bg-white/[0.04] disabled:opacity-40"
        >
          {busy === 'routine' ? 'Checking…' : 'Check now'}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {CADENCE_OPTIONS.map(option => (
          <button
            key={option.value}
            type="button"
            disabled={busy !== null}
            onClick={() => onChange({ cadence: option.value, hour })}
            className={cn(
              'h-7 rounded-[7px] px-2.5 text-[11px] transition-colors disabled:opacity-40',
              cadence === option.value
                ? 'bg-white/90 text-black'
                : 'border border-white/[0.08] text-white/55 hover:bg-white/[0.04]',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {cadence !== 'manual' ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-white/40">
          <span>Run</span>
          {cadence === 'weekly' ? (
            <select
              value={routine?.dayOfWeek ?? 1}
              disabled={busy !== null}
              onChange={(event) => onChange({ cadence, dayOfWeek: Number(event.target.value), hour })}
              className="h-7 rounded-[7px] border border-white/[0.08] bg-transparent px-2 text-[11px] text-white/70 outline-none focus:border-white/20"
            >
              {DAY_NAMES.map((name, index) => (
                <option key={name} value={index} className="bg-neutral-900">{name}</option>
              ))}
            </select>
          ) : (
            <select
              value={routine?.dayOfMonth ?? 1}
              disabled={busy !== null}
              onChange={(event) => onChange({ cadence, dayOfMonth: Number(event.target.value), hour })}
              className="h-7 rounded-[7px] border border-white/[0.08] bg-transparent px-2 text-[11px] text-white/70 outline-none focus:border-white/20"
            >
              {/* Capped at 28 so the routine still fires in February. */}
              {Array.from({ length: 28 }, (_, index) => index + 1).map(day => (
                <option key={day} value={day} className="bg-neutral-900">{day}</option>
              ))}
            </select>
          )}
          <span>at</span>
          <select
            value={hour}
            disabled={busy !== null}
            onChange={(event) => onChange({ cadence, dayOfWeek: routine?.dayOfWeek, dayOfMonth: routine?.dayOfMonth, hour: Number(event.target.value) })}
            className="h-7 rounded-[7px] border border-white/[0.08] bg-transparent px-2 text-[11px] text-white/70 outline-none focus:border-white/20"
          >
            {Array.from({ length: 24 }, (_, index) => index).map(value => (
              <option key={value} value={value} className="bg-neutral-900">
                {value % 12 === 0 ? 12 : value % 12}:00 {value < 12 ? 'AM' : 'PM'}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {routine?.lastRunAt ? (
        <p className="mt-3 text-[10px] uppercase tracking-[0.12em] text-white/25">
          Last checked {relative(routine.lastRunAt)}
        </p>
      ) : null}
    </section>
  )
}

/** What the last run found, and the one decision it needs. */
function BriefCard({
  brief,
  busy,
  onPublish,
  onDismiss,
}: {
  brief: Brief
  busy: string | null
  onPublish: (buildHash: string, summary: string) => void
  onDismiss: () => void
}) {
  const needsClick = brief.site && brief.site.tier === 'one-click'

  return (
    <section className={cn(
      'mt-4 rounded-[14px] border p-4',
      needsClick ? 'border-emerald-300/20 bg-emerald-300/[0.04]' : 'border-white/[0.06] bg-white/[0.02]',
    )}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[12px] font-medium text-white/75">
            {brief.nothingToDo ? 'Nothing needed' : 'From the last check'}
          </h2>

          {brief.site ? (
            <p className="mt-1.5 text-[13px] leading-5 text-white/80">{brief.site.summary}</p>
          ) : null}

          {brief.subscribers && brief.subscribers.imported > 0 ? (
            <p className="mt-1.5 text-[12px] text-white/55">
              {brief.subscribers.imported} new {brief.subscribers.imported === 1 ? 'fan' : 'fans'} from the site
            </p>
          ) : null}

          {brief.notes.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {brief.notes.map(note => (
                <li key={note} className="text-[11px] leading-5 text-white/40">{note}</li>
              ))}
            </ul>
          ) : null}

          {brief.site?.tier === 'trusted' ? (
            <p className="mt-2 text-[10px] uppercase tracking-[0.12em] text-emerald-100/50">
              Published automatically
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {needsClick && brief.site ? (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => onPublish(brief.site!.buildHash, brief.site!.summary)}
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-emerald-200/90 px-3 text-[12px] font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Upload className="h-3.5 w-3.5" />
              {busy === 'publishBrief' ? 'Publishing…' : 'Publish'}
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy !== null}
            onClick={onDismiss}
            className="text-[11px] text-white/35 underline-offset-2 hover:text-white/60 hover:underline disabled:opacity-40"
          >
            {needsClick ? 'Not now' : 'Dismiss'}
          </button>
        </div>
      </div>
    </section>
  )
}

function RollbackButton({
  deploys,
  receiptKind,
  busy,
  onRollback,
}: {
  deploys: DeployEntry[]
  receiptKind: string
  busy: string | null
  onRollback: (deployId?: string) => void
}) {
  // Only a publish can be undone, and only while its build is still retained.
  if (receiptKind !== 'site-publish') return null
  const restorable = deploys.find(entry => entry.canRollBackTo)
  if (!restorable) return null

  return (
    <button
      type="button"
      disabled={busy !== null}
      onClick={() => onRollback(restorable.id)}
      className="inline-flex shrink-0 items-center gap-1 rounded-[7px] border border-white/[0.07] px-2 py-1 text-[10px] text-white/40 transition-colors hover:bg-white/[0.04] hover:text-white/70 disabled:opacity-40"
    >
      <RotateCcw className="h-3 w-3" />
      Undo
    </button>
  )
}
