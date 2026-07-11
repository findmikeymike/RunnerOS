import * as React from 'react'
import { History } from 'lucide-react'
import type { HqRecommendationEvent, HqRecommendationOutcome } from '@craft-agent/shared/hq-state'
import { cn } from '@/lib/utils'

export function StateOfPlayHistory({ events, open, onToggle, formatDate }: {
  events: HqRecommendationEvent[]
  open: boolean
  onToggle: () => void
  formatDate: (value: string) => string
}) {
  return (
    <>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex h-8 w-full items-center justify-between text-xs text-white/48 hover:text-white/72">
        <span className="inline-flex items-center gap-2"><History className="h-3.5 w-3.5" />History</span>
        <span>{events.length}</span>
      </button>
      {open ? (
        <div className="mt-1 space-y-2 border-l border-white/[0.06] pl-3">
          {events.slice(0, 6).map((event) => (
            <div key={event.id} className="text-[11px] leading-4 text-white/42">
              <span className="font-medium text-white/62">{event.to.replaceAll('_', ' ')}</span>
              <span> / {formatDate(event.createdAt)}</span>
              {event.reason ? <div className="line-clamp-2 text-white/32">{event.reason}</div> : null}
            </div>
          ))}
        </div>
      ) : null}
    </>
  )
}

export function StateOfPlayOutcomeFeedback({ selected, onRate }: {
  selected?: HqRecommendationOutcome['userUsefulness']
  onRate: (value: 'useful' | 'not_useful') => void | Promise<void>
}) {
  return (
    <div className="mt-2 flex items-center gap-2">
      <span className="mr-auto text-[10px] uppercase tracking-[0.12em] text-white/30">Was this useful?</span>
      {(['useful', 'not_useful'] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={selected === value}
          onClick={() => void onRate(value)}
          className={cn(
            'h-7 rounded-[8px] border px-2 text-[10px] transition-colors',
            selected === value
              ? 'border-orange-300/25 bg-orange-300/10 text-orange-100/80'
              : 'border-white/[0.06] text-white/42 hover:bg-white/[0.04]',
          )}
        >
          {value === 'useful' ? 'Useful' : 'Not useful'}
        </button>
      ))}
    </div>
  )
}
