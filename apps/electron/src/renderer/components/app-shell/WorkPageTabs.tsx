import { pageSectionTabListClass, pageSectionTabClass, pageSectionTabSelectedClass, pageSectionTabIdleClass } from './page-section-tab-styles'
import * as React from 'react'
import { cn } from '@/lib/utils'
import { navigate, routes, type Route } from '@/lib/navigate'

export type WorkPageTab = 'workers' | 'workflows' | 'active'

interface WorkPageTabsProps {
  active: WorkPageTab
  className?: string
}

const TABS: Array<{ id: WorkPageTab; label: string; route: () => Route }> = [
  { id: 'workers', label: 'Workers', route: () => routes.view.agents() },
  { id: 'workflows', label: 'Workflows', route: () => routes.view.workflows() },
  { id: 'active', label: 'Active', route: () => routes.view.automations() },
]

export const WorkPageTabs: React.FC<WorkPageTabsProps> = ({ active, className }) => (
  <nav aria-label="Work sections" className={cn('flex justify-start', className)}>
    <div className={pageSectionTabListClass} role="tablist">
      {TABS.map((tab) => {
        const selected = tab.id === active
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => navigate(tab.route())}
            className={cn(
              pageSectionTabClass,
              selected
                ? pageSectionTabSelectedClass
                : pageSectionTabIdleClass,
            )}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  </nav>
)
