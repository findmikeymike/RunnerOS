import { useTranslation } from 'react-i18next'
import { LANGUAGES, type LanguageCode } from '@craft-agent/shared/i18n'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useTheme } from '@/context/ThemeContext'
import type { DetailsPageMeta } from '@/lib/navigation-registry'

import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsSegmentedControl,
  SettingsMenuSelect,
} from '@/components/settings'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'appearance',
}

export default function AppearanceSettingsPage() {
  const { t, i18n } = useTranslation()
  const { font, setFont } = useTheme()

  return (
    <div className="h-full flex flex-col">
      <PanelHeader />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-6 pt-10 pb-8 max-w-[1600px] mx-auto">
            <SettingsSection title={t("settings.appearance.title")}>
              <SettingsCard>
                <SettingsRow label={t("settings.appearance.font")}>
                  <SettingsSegmentedControl
                    value={font}
                    onValueChange={setFont}
                    options={[
                      { value: 'inter', label: t("settings.appearance.fontInter") },
                    ]}
                  />
                </SettingsRow>
                <SettingsRow label={t("settings.appearance.language")}>
                  <SettingsMenuSelect
                    value={(i18n.resolvedLanguage ?? i18n.language) as LanguageCode}
                    onValueChange={(value) => {
                      i18n.changeLanguage(value)
                      window.electronAPI?.changeLanguage?.(value)
                    }}
                    options={Object.entries(LANGUAGES).map(([code, config]) => ({
                      value: code,
                      label: config.nativeName,
                    }))}
                  />
                </SettingsRow>
              </SettingsCard>
            </SettingsSection>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
