import {
  AppWindow,
  Brain,
  BriefcaseBusiness,
  ChevronRight,
  KeyRound,
  MessageCircle,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import type { SettingsSubpage } from '../../../shared/settings-registry'
import { navigate, routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'

interface SettingsPageSwitcherProps {
  activeSubpage: SettingsSubpage
}

type SettingsGroup = {
  id: string
  label: string
  description: string
  icon: LucideIcon
  landing: SettingsSubpage
  pages: Array<{ id: SettingsSubpage; label: string }>
}

const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    id: 'models',
    label: 'Models',
    description: 'AI and providers',
    icon: Sparkles,
    landing: 'ai',
    pages: [{ id: 'ai', label: 'Models' }],
  },
  {
    id: 'connections',
    label: 'Connections',
    description: 'Apps and services',
    icon: KeyRound,
    landing: 'secrets',
    pages: [{ id: 'secrets', label: 'Services' }],
  },
  {
    id: 'messaging',
    label: 'Messaging',
    description: 'Mobile connect',
    icon: MessageCircle,
    landing: 'messaging',
    pages: [{ id: 'messaging', label: 'Phone channels' }],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    description: 'Info',
    icon: BriefcaseBusiness,
    landing: 'workspace',
    pages: [
      { id: 'workspace', label: 'Workspace' },
      { id: 'permissions', label: 'Permissions' },
    ],
  },
  {
    id: 'app',
    label: 'App',
    description: 'Look',
    icon: AppWindow,
    landing: 'appearance',
    pages: [
      { id: 'appearance', label: 'Appearance' },
      { id: 'app', label: 'Behavior' },
      { id: 'input', label: 'Input' },
      { id: 'shortcuts', label: 'Shortcuts' },
      { id: 'preferences', label: 'Profile' },
    ],
  },
  {
    id: 'advanced',
    label: 'Advanced',
    description: 'Memory etc',
    icon: Brain,
    landing: 'memory',
    pages: [
      { id: 'memory', label: 'Memory' },
      { id: 'labels', label: 'Labels' },
      { id: 'server', label: 'Server' },
    ],
  },
]

export function SettingsPageSwitcher({ activeSubpage }: SettingsPageSwitcherProps) {
  const activeGroup = SETTINGS_GROUPS.find((group) => group.pages.some((page) => page.id === activeSubpage)) ?? SETTINGS_GROUPS[0]!
  const activePageLabel = activeGroup.pages.find((page) => page.id === activeSubpage)?.label ?? activeGroup.label

  return (
    <div className="w-full overflow-hidden rounded-[18px] border border-white/[0.07] bg-[#08080a]/94 p-2 shadow-middle backdrop-blur-xl">
      <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3 xl:grid-cols-6">
        {SETTINGS_GROUPS.map((group) => {
          const selected = group.id === activeGroup.id
          const Icon = group.icon
          return (
            <button
              key={group.id}
              type="button"
              onClick={() => navigate(routes.view.settings(group.landing))}
              className={cn(
                'group flex min-h-[58px] items-center gap-2.5 rounded-[13px] px-3 py-2 text-left transition-colors',
                selected
                  ? 'bg-white/[0.09] text-white shadow-minimal'
                  : 'text-white/44 hover:bg-white/[0.045] hover:text-white/78',
              )}
            >
              <span className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border transition-colors',
                selected
                  ? 'border-orange-300/20 bg-orange-400/13 text-orange-200'
                  : 'border-white/[0.055] bg-white/[0.025] text-white/36 group-hover:text-white/62',
              )}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] font-semibold leading-4">{group.label}</span>
                <span className="mt-0.5 block truncate text-[10.5px] leading-4 text-white/34">{group.description}</span>
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-white/[0.055] px-1 pt-2">
        <div className="mr-1 hidden items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-white/28 sm:flex">
          <span>{activeGroup.label}</span>
          <ChevronRight className="h-3 w-3" />
          <span className="text-white/46">{activePageLabel}</span>
        </div>
        {activeGroup.pages.map((page) => {
          const selected = page.id === activeSubpage
          return (
            <button
              key={page.id}
              type="button"
              onClick={() => navigate(routes.view.settings(page.id))}
              className={cn(
                'h-7 rounded-full px-3 text-[11px] font-medium transition-colors',
                selected
                  ? 'bg-white/[0.09] text-white'
                  : 'bg-white/[0.02] text-white/42 hover:bg-white/[0.05] hover:text-white/72',
              )}
            >
              {page.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
