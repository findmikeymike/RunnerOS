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
    <CompactPageHeader
      eyebrow="Artist HQ"
      title="People"
      tone="emerald"
      actions={
        <div
          role="tablist"
          aria-label="People view"
          className="flex shrink-0 items-center rounded-[8px] border border-white/[0.10] bg-black/20 p-1"
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
                    : 'text-white/52 hover:bg-white/[0.06] hover:text-white/82',
                )}
              >
                {view}
              </button>
            )
          })}
        </div>
      }
    />
  )
}
