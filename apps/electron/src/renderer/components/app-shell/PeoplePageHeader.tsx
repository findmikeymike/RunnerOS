import { pageSectionTabListClass, pageSectionTabClass, pageSectionTabSelectedClass, pageSectionTabIdleClass } from './page-section-tab-styles'
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
    <div className="space-y-4">
      <CompactPageHeader eyebrow="Artist HQ" title="People" tone="emerald" />
      <div
        role="tablist"
        aria-label="People view"
        className={pageSectionTabListClass}
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
                pageSectionTabClass, 'capitalize',
                selected
                  ? pageSectionTabSelectedClass
                  : pageSectionTabIdleClass,
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
