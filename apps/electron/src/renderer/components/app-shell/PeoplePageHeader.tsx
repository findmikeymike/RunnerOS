import * as React from 'react'
import { cn } from '@/lib/utils'
import { CompactPageHeader } from './CompactPageHeader'

export type PeopleView = 'network' | 'community'

export function PeoplePageHeader({
  activeView,
  onSelectView,
}: {
  activeView: PeopleView
  onSelectView: (view: PeopleView) => void
}) {
  return (
    <div className="space-y-3">
      <CompactPageHeader eyebrow="Artist HQ" title="People" tone="emerald" />
      <div
        role="tablist"
        aria-label="People view"
        className="inline-flex items-center rounded-[9px] border border-white/[0.07] bg-white/[0.03] p-1 backdrop-blur-xl"
      >
        {(['network', 'community'] as const).map((view) => {
          const selected = activeView === view
          return (
            <button
              key={view}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onSelectView(view)}
              className={cn(
                'h-7 rounded-[6px] px-3 text-[10px] font-medium capitalize transition-colors',
                selected
                  ? 'bg-white/90 text-black'
                  : 'text-white/46 hover:bg-white/[0.05] hover:text-white/78',
              )}
            >
              {view}
            </button>
          )
        })}
      </div>
    </div>
  )
}
