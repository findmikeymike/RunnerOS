import * as React from 'react'
import { CheckCircle2, Star } from 'lucide-react'
import type { OutputFinalPointerDTO, OutputSummaryDTO } from '@/hooks/useOutputs'
import { cn } from '@/lib/utils'

interface FinalsWidgetProps {
  title: string
  outputs: OutputSummaryDTO[]
  scope: 'hq' | 'campaign'
  campaignId?: string
  loading?: boolean
  limit?: number
  onOpenOutput?: (outputId: string) => void
}

export function FinalsWidget({
  title,
  outputs,
  scope,
  campaignId,
  loading = false,
  limit = 5,
  onOpenOutput,
}: FinalsWidgetProps) {
  const finals = React.useMemo(
    () => collectFinalRows(outputs, scope, campaignId).slice(0, limit),
    [campaignId, limit, outputs, scope],
  )
  return (
    <div className="runneros-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300/70" />
          <h3 className="truncate text-[10px] font-medium uppercase tracking-[0.16em] text-white/62">{title}</h3>
        </div>
        <span className="shrink-0 text-[10px] text-white/32">{loading ? 'loading' : finals.length}</span>
      </div>
      {loading ? (
        <p className="text-xs text-white/38">Loading Finals</p>
      ) : finals.length === 0 ? (
        <p className="text-xs text-white/38">No Finals yet</p>
      ) : (
        <div className="space-y-2">
          {finals.map(({ output, final }) => (
            <button
              key={final.id}
              type="button"
              onClick={() => onOpenOutput?.(output.id)}
              className="flex w-full min-w-0 items-start justify-between gap-3 rounded-[8px] border border-white/[0.04] bg-white/[0.018] px-3 py-2 text-left hover:bg-white/[0.04]"
            >
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-white/76">{output.title}</span>
                <span className="mt-0.5 block truncate text-[11px] text-white/38">{formatSlot(final.slot)}</span>
              </span>
              <span className={cn(
                'inline-flex h-5 shrink-0 items-center gap-1 rounded-[4px] px-1.5 text-[10px] font-medium',
                final.isPrimary ? 'bg-sky-500/12 text-sky-300' : 'bg-emerald-500/10 text-emerald-300',
              )}>
                {final.isPrimary ? <Star className="h-3 w-3" /> : null}
                {final.isPrimary ? 'Primary' : 'Final'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function collectFinalRows(
  outputs: OutputSummaryDTO[],
  scope: 'hq' | 'campaign',
  campaignId?: string,
): Array<{ output: OutputSummaryDTO; final: OutputFinalPointerDTO }> {
  if (scope === 'campaign' && !campaignId) return []
  const rows: Array<{ output: OutputSummaryDTO; final: OutputFinalPointerDTO }> = []
  for (const output of outputs) {
    for (const final of output.finals ?? []) {
      if (final.scope !== scope) continue
      if (scope === 'campaign' && final.campaignId !== campaignId) continue
      rows.push({ output, final })
    }
  }
  rows.sort((a, b) => {
    if (a.final.isPrimary !== b.final.isPrimary) return a.final.isPrimary ? -1 : 1
    return b.final.promotedAt.localeCompare(a.final.promotedAt)
  })
  return rows
}

function formatSlot(slot: string): string {
  return slot.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}
