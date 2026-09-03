import {
  AppWindow,
  Brain,
  BriefcaseBusiness,
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

const CONNECTION_PAGES: Array<{ id: SettingsSubpage; label: string }> = [
  { id: 'secrets', label: 'Services' },
  { id: 'social-accounts', label: 'Social Accounts' },
  { id: 'spotify', label: 'Spotify' },
  { id: 'ad-accounts', label: 'Ad Accounts' },
]

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
    pages: CONNECTION_PAGES,
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
      { id: 'team', label: 'Team' },
      { id: 'permissions', label: 'Permissions' },
    ],
  },
  {
    id: 'app',
    label: 'App',
    description: 'Look',
    icon: AppWindow,
    landing: 'preferences',
    pages: [
      { id: 'preferences', label: 'Profile' },
      { id: 'appearance', label: 'Appearance' },
      { id: 'app', label: 'Behavior' },
      { id: 'input', label: 'Input' },
      { id: 'shortcuts', label: 'Shortcuts' },
      { id: 'about', label: 'About' },
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
                  ? 'border-[#f05a28]/45 bg-[#e65320]/38 text-[#ffc0a3]'
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

    </div>
  )
}

export function SettingsGroupTabs({ activeSubpage }: SettingsPageSwitcherProps) {
  const activeGroup = SETTINGS_GROUPS.find((group) => group.pages.some((page) => page.id === activeSubpage)) ?? SETTINGS_GROUPS[0]!
  if (activeGroup.pages.length <= 1) return null

  return (
    <div className="relative z-[100] mt-8 -mb-12 pointer-events-auto">
      <div className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-[11px] bg-white/[0.035] p-1 font-sans normal-case tracking-normal">
        {activeGroup.pages.map((page) => {
          const selected = page.id === activeSubpage
          return (
            <button
              key={page.id}
              type="button"
              onClick={() => navigate(routes.view.settings(page.id))}
              className={cn(
                'h-8 rounded-[8px] px-3 text-[12px] font-semibold transition-colors',
                selected
                  ? 'bg-[#e65320]/45 text-white shadow-minimal'
                  : 'text-white/52 hover:bg-white/[0.05] hover:text-white/82',
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
