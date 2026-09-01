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
    <div className="inline-flex items-center rounded-[10px] border border-white/[0.08] bg-white/[0.025] p-1" role="tablist">
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
              'h-8 rounded-[7px] px-3.5 text-xs font-medium transition-colors',
              selected
                ? 'bg-white/[0.10] text-white shadow-minimal'
                : 'text-white/42 hover:bg-white/[0.05] hover:text-white/72',
            )}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  </nav>
)
