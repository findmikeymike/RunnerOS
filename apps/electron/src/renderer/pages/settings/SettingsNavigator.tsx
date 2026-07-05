/**
 * SettingsNavigator
 *
 * Navigator panel content for settings. Displays a list of settings sections
 * (App, Workspace, Shortcuts, Preferences) that can be selected to show in the details panel.
 *
 * Styling follows SessionList/SourcesListPanel patterns for visual consistency.
 */

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { SettingsSubpage } from '../../../shared/types'
import { SETTINGS_ITEMS } from '../../../shared/menu-schema'
import { SETTINGS_ICONS } from '@/components/icons/SettingsIcons'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'navigator',
}

interface SettingsNavigatorProps {
  /** Currently selected settings subpage */
  selectedSubpage: SettingsSubpage
  /** Called when a subpage is selected */
  onSelectSubpage: (subpage: SettingsSubpage) => void
}

interface SettingsItem {
  id: SettingsSubpage
  label: string
  icon: React.ComponentType<{ className?: string }>
  description: string
}

interface SettingsItemRowProps {
  item: SettingsItem
  isSelected: boolean
  onSelect: () => void
}

function SettingsItemRow({ item, isSelected, onSelect }: SettingsItemRowProps) {
  const Icon = item.icon

  return (
    <div data-selected={isSelected || undefined}>
      <div className="relative group select-none">
        <div className="absolute left-[13px] top-[9px] z-10">
          <Icon
            className={cn(
              'w-3.5 h-3.5 shrink-0',
              isSelected ? 'text-white/82' : 'text-white/30'
            )}
          />
        </div>
        <button
          type="button"
          onClick={onSelect}
          className={cn(
            'flex w-full items-start gap-2 rounded-[11px] py-2 pl-9 pr-3 text-left outline-none',
            'border transition-[background-color,border-color] duration-100',
            isSelected
              ? 'border-white/[0.085] bg-white/[0.055]'
              : 'border-transparent hover:border-white/[0.045] hover:bg-white/[0.03]'
          )}
        >
          <div className="flex flex-col min-w-0 flex-1">
            <span
              className={cn(
                'text-[12.5px] font-medium leading-4',
                isSelected ? 'text-white/86' : 'text-white/58'
              )}
            >
              {item.label}
            </span>
            <span className="mt-0.5 line-clamp-1 text-[10.5px] leading-3 text-white/28">
              {item.description}
            </span>
          </div>
        </button>
      </div>
    </div>
  )
}

export default function SettingsNavigator({
  selectedSubpage,
  onSelectSubpage,
}: SettingsNavigatorProps) {
  const { t } = useTranslation()

  const settingsItems: SettingsItem[] = useMemo(() =>
    SETTINGS_ITEMS.map((item) => ({
      id: item.id,
      label: t(item.labelKey),
      icon: SETTINGS_ICONS[item.id],
      description: t(item.descriptionKey),
    })),
    [t]
  )

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-1 px-2 pt-5">
          {settingsItems.map((item) => (
            <SettingsItemRow
              key={item.id}
              item={item}
              isSelected={selectedSubpage === item.id}
              onSelect={() => onSelectSubpage(item.id)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
