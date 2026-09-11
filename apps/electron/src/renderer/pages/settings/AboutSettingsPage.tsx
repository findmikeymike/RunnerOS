import { useTranslation } from 'react-i18next'
import { useEffect, useState } from 'react'
import { describeBuildAgreement, getEmbeddedBuildInfo, type DesktopBuildInfo } from '@craft-agent/shared/build-info'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SettingsCard, SettingsRow, SettingsSection } from '@/components/settings'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { PRODUCT_NAME, RENDERER_PRODUCT_VARIANT } from '@/lib/product-identity'
import electronPackage from '../../../../package.json'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'about',
}

const MAGIC_CO_URLS = {
  website: 'https://itsthemagic.io',
  privacy: 'https://itsthemagic.io/privacy',
  terms: 'https://itsthemagic.io/terms',
} as const

const RUNNER_UPDATES_URL = 'https://github.com/findmikeymike/RunnerOS/releases'
const quietButtonClass = 'inline-flex h-8 items-center rounded-[8px] border border-white/[0.065] bg-white/[0.035] px-2.5 text-xs font-medium text-white/52 transition-colors hover:bg-white/[0.055] hover:text-white/76'

export default function AboutSettingsPage() {
  const { t } = useTranslation()
  const isArtistOs = RENDERER_PRODUCT_VARIANT === 'artist-os'
  const [desktopBuild, setDesktopBuild] = useState<DesktopBuildInfo>({ main: null, preload: null, isPackaged: null })
  const rendererBuild = getEmbeddedBuildInfo()
  useEffect(() => {
    let active = true
    if (typeof window.electronAPI.getBuildInfo === 'function') {
      void window.electronAPI.getBuildInfo().then(info => { if (active) setDesktopBuild(info) }).catch(() => {})
    }
    return () => { active = false }
  }, [])

  const openUrl = (url: string) => {
    void window.electronAPI.openUrl(url)
  }

  return (
    <div className="flex h-full flex-col">
      <PanelHeader />
      <div className="min-h-0 flex-1 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="mx-auto max-w-[1600px] px-6 pb-8 pt-10">
            <SettingsSection title={`About ${PRODUCT_NAME}`}>
              <SettingsCard>
                <div className="px-4 py-5">
                  <h2 className="text-lg font-semibold tracking-[-0.02em] text-white/92">{PRODUCT_NAME}</h2>
                  {isArtistOs && <p className="mt-1 text-sm text-white/48">A Magic Co product</p>}
                </div>

                <SettingsRow label={t('settings.about.version')}>
                  <span className="text-white/38">{electronPackage.version}</span>
                </SettingsRow>

                {isArtistOs ? (
                  <>
                    <SettingsRow
                      label="Website"
                      description="itsthemagic.io"
                      action={<button type="button" onClick={() => openUrl(MAGIC_CO_URLS.website)} className={quietButtonClass}>Open</button>}
                    />
                    <SettingsRow
                      label="Privacy Policy"
                      description="itsthemagic.io/privacy"
                      action={<button type="button" onClick={() => openUrl(MAGIC_CO_URLS.privacy)} className={quietButtonClass}>Open</button>}
                    />
                    <SettingsRow
                      label="Terms of Use"
                      description="itsthemagic.io/terms"
                      action={<button type="button" onClick={() => openUrl(MAGIC_CO_URLS.terms)} className={quietButtonClass}>Open</button>}
                    />
                  </>
                ) : (
                  <SettingsRow
                    label={t('settings.about.futureUpdates')}
                    description={t('settings.about.futureUpdatesDesc')}
                    action={<button type="button" onClick={() => openUrl(RUNNER_UPDATES_URL)} className={quietButtonClass}>Open updates</button>}
                  />
                )}
              </SettingsCard>
            </SettingsSection>
            <SettingsSection title="Build details">
              <SettingsCard>
                <div className="px-4 py-3 text-xs text-white/48">
                  {describeBuildAgreement([desktopBuild.main, desktopBuild.preload, rendererBuild])}
                  {desktopBuild.isPackaged !== null && <span> {desktopBuild.isPackaged ? 'Packaged app.' : 'Development app.'}</span>}
                </div>
                {([
                  ['Main', desktopBuild.main], ['Preload', desktopBuild.preload], ['Renderer', rendererBuild],
                ] as const).map(([label, info]) => (
                  <SettingsRow key={label} label={label}>
                    {info ? (
                      <div className="min-w-0 text-right text-xs text-white/48">
                        <div className="break-all font-mono" title={`Commit: ${info.commit ?? 'unavailable'}\nSource: ${info.sourceHash}`}>
                          {info.commit?.slice(0, 12) ?? 'Commit unavailable'} · {info.sourceHash.slice(0, 12)}{info.dirty ? ' · modified' : ''}
                        </div>
                        <div className="mt-1">{info.product} · {info.builtAt}</div>
                      </div>
                    ) : <span className="text-xs text-white/38">Unavailable in this component</span>}
                  </SettingsRow>
                ))}
              </SettingsCard>
            </SettingsSection>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
