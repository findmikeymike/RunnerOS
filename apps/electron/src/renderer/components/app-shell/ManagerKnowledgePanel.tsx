import * as React from 'react'
import { ChevronRight, RefreshCw } from 'lucide-react'
import type { ManagerBriefV1, ManagerSourceHealth } from '@craft-agent/shared/hq-state'
import { cn } from '@/lib/utils'

export type ManagerSourceSurface =
  | { kind: 'hq'; tab: 'home' | 'profile' | 'calendar' | 'network' | 'research' }
  | { kind: 'vault' }
  | { kind: 'outputs' }
  | { kind: 'campaign'; workspaceId: string }

export function managerSourceSurface(source: string): ManagerSourceSurface | null {
  const campaignMatch = source.match(/^([^:]+):(.+)$/)
  if (campaignMatch) {
    const [, workspaceId] = campaignMatch
    return workspaceId ? { kind: 'campaign', workspaceId } : null
  }
  if (source === 'artist-profile') return { kind: 'hq', tab: 'profile' }
  if (source === 'artist-calendar' || source === 'scheduled-work') return { kind: 'hq', tab: 'calendar' }
  if (source === 'artist-network' || source === 'artist-community') return { kind: 'hq', tab: 'network' }
  if (source.startsWith('shared-intel')) return { kind: 'hq', tab: 'research' }
  if (source === 'artist-vault') return { kind: 'vault' }
  if (source === 'outputs') return { kind: 'outputs' }
  if (source === 'artist-release-horizon' || source === 'artist-spotify-snapshot' || source === 'artist-instagram-snapshot') {
    return { kind: 'hq', tab: 'home' }
  }
  return null
}

export function managerHealthLabel(status: ManagerSourceHealth['status']): 'Fresh' | 'Stale' | 'Partial' | 'Missing' | 'Unavailable' {
  if (status === 'fresh') return 'Fresh'
  if (status === 'stale') return 'Stale'
  if (status === 'partial') return 'Partial'
  if (status === 'malformed') return 'Unavailable'
  return 'Missing'
}

export function ManagerKnowledgePanel({
  brief,
  refreshBusy,
  onRefresh,
  onOpenSource,
}: {
  brief: ManagerBriefV1
  refreshBusy: boolean
  onRefresh: () => void
  onOpenSource: (surface: ManagerSourceSurface) => void
}) {
  const healthy = brief.sourceHealth.filter((source) => source.status === 'fresh').length
  return (
    <section className="mt-7 border-t border-white/[0.06] pt-6" aria-labelledby="manager-knowledge-title">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 id="manager-knowledge-title" className="text-sm font-medium tracking-tight text-white/88">
            What your manager knows
          </h3>
          <p className="mt-1 text-[11px] text-white/34">
            Updated {formatGeneratedAt(brief.generatedAt)} · {shortRevision(brief.revision)}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshBusy}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] border border-white/[0.07] px-2.5 text-[11px] font-medium text-white/52 transition-colors hover:bg-white/[0.04] hover:text-white/82 disabled:opacity-40"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refreshBusy && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {brief.campaignFocus ? (
        <button
          type="button"
          onClick={() => onOpenSource({ kind: 'campaign', workspaceId: brief.campaignFocus!.workspaceId })}
          className="mt-5 flex w-full items-center justify-between gap-4 border-y border-white/[0.055] py-3 text-left transition-colors hover:bg-white/[0.015]"
        >
          <span className="min-w-0">
            <span className="block text-[9px] font-medium uppercase tracking-[0.15em] text-white/34">{brief.campaignFocus.label}</span>
            <span className="mt-1 block truncate text-sm font-medium text-white/76">{brief.campaignFocus.name}</span>
            <span className="mt-0.5 block truncate text-[11px] text-white/34">
              {campaignReason(brief.campaignFocus)}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-white/28" />
        </button>
      ) : (
        <div className="mt-5 border-y border-white/[0.055] py-3">
          <p className="text-[9px] font-medium uppercase tracking-[0.15em] text-white/34">Campaign focus</p>
          <p className="mt-1 text-sm text-white/48">No campaign is in focus yet.</p>
        </div>
      )}

      <p className="mt-4 text-xs leading-5 text-white/42">
        Can retrieve artist context, year plan, growth, intel, calendar, network, community, Vault, and full campaign detail when needed.
      </p>

      <div className="mt-5 flex items-center justify-between gap-3">
        <p className="text-[9px] font-medium uppercase tracking-[0.15em] text-white/34">Sources</p>
        <p className="text-[10px] text-white/30">{healthy} of {brief.sourceHealth.length} fresh</p>
      </div>
      <div className="mt-2 divide-y divide-white/[0.05] border-y border-white/[0.055]">
        {brief.sourceHealth.map((source) => {
          const surface = managerSourceSurface(source.source)
          const content = (
            <>
              <span className="flex min-w-0 items-start gap-2.5">
                <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', healthDot(source.status))} />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-white/66">{sourceLabel(source.source)}</span>
                  {source.message ? <span className="mt-0.5 block line-clamp-2 text-[10px] leading-4 text-white/30">{source.message}</span> : null}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-[10px] text-white/36">
                {managerHealthLabel(source.status)}
                {surface ? <ChevronRight className="h-3 w-3 text-white/22" /> : null}
              </span>
            </>
          )
          return surface ? (
            <button key={source.source} type="button" onClick={() => onOpenSource(surface)} className="flex w-full items-start justify-between gap-4 py-2.5 text-left transition-colors hover:bg-white/[0.015]">
              {content}
            </button>
          ) : (
            <div key={source.source} className="flex items-start justify-between gap-4 py-2.5">{content}</div>
          )
        })}
      </div>
    </section>
  )
}

function campaignReason(focus: ManagerBriefV1['campaignFocus'] & {}): string {
  const parts = [focus.releaseDate ? `Release ${formatDate(focus.releaseDate)}` : 'Release date needed']
  if (focus.readiness) parts.push(`${focus.readiness.done}/${focus.readiness.total} ready`)
  return parts.join(' · ')
}

function healthDot(status: ManagerSourceHealth['status']): string {
  if (status === 'fresh') return 'bg-white/38'
  if (status === 'stale' || status === 'partial') return 'bg-[#f97316]'
  return 'bg-red-400/75'
}

function sourceLabel(source: string): string {
  const slug = source.includes(':') ? source.slice(source.indexOf(':') + 1) : source
  return slug
    .replace(/^artist-/, '')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function shortRevision(revision: string): string {
  return revision.split(':').at(-1)?.slice(0, 8) || revision
}

function formatGeneratedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date)
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date)
}
