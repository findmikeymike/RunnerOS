/**
 * AppSettingsPage
 *
 * Global app-level settings that apply across all workspaces.
 *
 * Settings:
 * - Notifications
 * - Network (proxy)
 * - About (version, updates)
 *
 * Note: AI settings (connections, model, thinking) have been moved to AiSettingsPage.
 * Note: Appearance settings (theme, font) have been moved to AppearanceSettingsPage.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Spinner } from '@craft-agent/ui'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { NetworkProxySettings } from '../../../shared/types'
import electronPackage from '../../../../package.json'

import {
  SettingsSection,
  SettingsCard,
  SettingsCardFooter,
  SettingsRow,
  SettingsToggle,
  SettingsInput,
} from '@/components/settings'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'app',
}

const RUNNEROS_UPDATES_URL = 'https://github.com/findmikeymike/RunnerOS/releases'
const quietButtonClass = 'inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-white/[0.065] bg-white/[0.035] px-2.5 text-xs font-medium text-white/52 transition-colors hover:bg-white/[0.055] hover:text-white/76'

// ============================================
// Proxy form helpers
// ============================================

interface ProxyFormState {
  enabled: boolean
  httpProxy: string
  httpsProxy: string
  noProxy: string
}

const EMPTY_PROXY_FORM: ProxyFormState = {
  enabled: false,
  httpProxy: '',
  httpsProxy: '',
  noProxy: '',
}

function toProxyFormState(settings?: NetworkProxySettings): ProxyFormState {
  if (!settings) return EMPTY_PROXY_FORM
  return {
    enabled: settings.enabled,
    httpProxy: settings.httpProxy ?? '',
    httpsProxy: settings.httpsProxy ?? '',
    noProxy: settings.noProxy ?? '',
  }
}

function toNetworkProxySettings(form: ProxyFormState): NetworkProxySettings {
  return {
    enabled: form.enabled,
    httpProxy: form.httpProxy.trim() || undefined,
    httpsProxy: form.httpsProxy.trim() || undefined,
    noProxy: form.noProxy.trim() || undefined,
  }
}

function validateProxyUrl(url: string): string | undefined {
  if (!url.trim()) return undefined
  try {
    const parsed = new URL(url.trim())
    if (!['http:', 'https:', 'socks4:', 'socks5:'].includes(parsed.protocol)) {
      return 'proxyErrorProtocol'
    }
    return undefined
  } catch {
    return 'proxyErrorFormat'
  }
}

// ============================================
// Main Component
// ============================================

export default function AppSettingsPage() {
  const { t } = useTranslation()

  // Notifications state
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)

  // Power state
  const [keepAwakeEnabled, setKeepAwakeEnabled] = useState(false)

  // Tools state
  const [browserToolEnabled, setBrowserToolEnabled] = useState(true)

  // Proxy state
  const [proxyForm, setProxyForm] = useState<ProxyFormState>(EMPTY_PROXY_FORM)
  const [savedProxyForm, setSavedProxyForm] = useState<ProxyFormState>(EMPTY_PROXY_FORM)
  const [proxyError, setProxyError] = useState<string | undefined>()
  const [isSavingProxy, setIsSavingProxy] = useState(false)

  // Load settings on mount
  const loadSettings = useCallback(async () => {
    if (!window.electronAPI) return
    try {
      const [notificationsOn, keepAwakeOn, browserToolOn, proxySettings] = await Promise.all([
        window.electronAPI.getNotificationsEnabled(),
        window.electronAPI.getKeepAwakeWhileRunning(),
        window.electronAPI.getBrowserToolEnabled(),
        window.electronAPI.getNetworkProxySettings(),
      ])
      setNotificationsEnabled(notificationsOn)
      setKeepAwakeEnabled(keepAwakeOn)
      setBrowserToolEnabled(browserToolOn)
      const form = toProxyFormState(proxySettings)
      setProxyForm(form)
      setSavedProxyForm(form)
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
  }, [])

  useEffect(() => {
    loadSettings()
  }, [])

  const handleNotificationsEnabledChange = useCallback(async (enabled: boolean) => {
    setNotificationsEnabled(enabled)
    await window.electronAPI.setNotificationsEnabled(enabled)
  }, [])

  const handleKeepAwakeEnabledChange = useCallback(async (enabled: boolean) => {
    setKeepAwakeEnabled(enabled)
    await window.electronAPI.setKeepAwakeWhileRunning(enabled)
  }, [])

  const handleBrowserToolEnabledChange = useCallback(async (enabled: boolean) => {
    setBrowserToolEnabled(enabled)
    await window.electronAPI.setBrowserToolEnabled(enabled)
  }, [])

  // Proxy handlers
  const isProxyDirty = useMemo(() => {
    return JSON.stringify(proxyForm) !== JSON.stringify(savedProxyForm)
  }, [proxyForm, savedProxyForm])

  const handleSaveProxy = useCallback(async () => {
    // Validate URLs
    const httpErr = validateProxyUrl(proxyForm.httpProxy)
    const httpsErr = validateProxyUrl(proxyForm.httpsProxy)
    if (httpErr || httpsErr) {
      setProxyError(httpErr || httpsErr)
      return
    }
    setProxyError(undefined)
    setIsSavingProxy(true)
    try {
      const settings = toNetworkProxySettings(proxyForm)
      await window.electronAPI.setNetworkProxySettings(settings)
      // Re-read persisted state to confirm
      const persisted = await window.electronAPI.getNetworkProxySettings()
      const form = toProxyFormState(persisted)
      setProxyForm(form)
      setSavedProxyForm(form)
    } catch (error) {
      setProxyError(error instanceof Error ? error.message : 'Failed to save')
    } finally {
      setIsSavingProxy(false)
    }
  }, [proxyForm])

  const handleResetProxy = useCallback(() => {
    setProxyForm(savedProxyForm)
    setProxyError(undefined)
  }, [savedProxyForm])

  return (
    <div className="h-full flex flex-col">
      <PanelHeader />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-6 pt-10 pb-8 max-w-[1600px] mx-auto">
            <div className="space-y-6">
              {/* Notifications */}
              <SettingsSection title={t("settings.notifications.title")}>
                <SettingsCard>
                  <SettingsToggle
                    label={t("settings.notifications.desktopNotifications")}
                    description={t("settings.notifications.desktopNotificationsDesc")}
                    checked={notificationsEnabled}
                    onCheckedChange={handleNotificationsEnabledChange}
                  />
                </SettingsCard>
              </SettingsSection>

              {/* Power */}
              <SettingsSection title={t("settings.power.title")}>
                <SettingsCard>
                  <SettingsToggle
                    label={t("settings.power.keepScreenAwake")}
                    description={t("settings.power.keepScreenAwakeDesc")}
                    checked={keepAwakeEnabled}
                    onCheckedChange={handleKeepAwakeEnabledChange}
                  />
                </SettingsCard>
              </SettingsSection>

              {/* Tools */}
              <SettingsSection title={t("settings.tools.title")}>
                <SettingsCard>
                  <SettingsToggle
                    label={t("settings.tools.builtInBrowser")}
                    description={t("settings.tools.builtInBrowserDesc")}
                    checked={browserToolEnabled}
                    onCheckedChange={handleBrowserToolEnabledChange}
                  />
                </SettingsCard>
              </SettingsSection>

              {/* Network */}
              <SettingsSection title={t("settings.network.title")}>
                <SettingsCard>
                  <SettingsToggle
                    label={t("settings.network.httpProxy")}
                    description={t("settings.network.httpProxyDesc")}
                    checked={proxyForm.enabled}
                    onCheckedChange={(enabled) => setProxyForm(prev => ({ ...prev, enabled }))}
                  />
                  {proxyForm.enabled && (
                    <>
                      <SettingsInput
                        label={t("settings.network.httpProxyLabel")}
                        value={proxyForm.httpProxy}
                        onChange={(value) => setProxyForm(prev => ({ ...prev, httpProxy: value }))}
                        placeholder={t("settings.network.proxyPlaceholder")}
                        inCard
                      />
                      <SettingsInput
                        label={t("settings.network.httpsProxyLabel")}
                        value={proxyForm.httpsProxy}
                        onChange={(value) => setProxyForm(prev => ({ ...prev, httpsProxy: value }))}
                        placeholder={t("settings.network.proxyPlaceholder")}
                        inCard
                      />
                      <SettingsInput
                        label={t("settings.network.bypassRules")}
                        value={proxyForm.noProxy}
                        onChange={(value) => setProxyForm(prev => ({ ...prev, noProxy: value }))}
                        placeholder={t("settings.network.bypassPlaceholder")}
                        inCard
                      />
                    </>
                  )}
                  {(isProxyDirty || proxyError) && (
                    <SettingsCardFooter>
                      {proxyError && (
                        <span className="text-destructive text-sm mr-auto">{proxyError === 'proxyErrorProtocol' ? t("settings.network.proxyErrorProtocol") : proxyError === 'proxyErrorFormat' ? t("settings.network.proxyErrorFormat") : proxyError}</span>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleResetProxy}
                        disabled={!isProxyDirty || isSavingProxy}
                      >
                        {t("common.reset")}
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSaveProxy}
                        disabled={!isProxyDirty || isSavingProxy}
                      >
                        {isSavingProxy ? (
                          <>
                            <Spinner className="mr-1.5" />
                            {t("common.saving")}
                          </>
                        ) : (
                          t("common.save")
                        )}
                      </Button>
                    </SettingsCardFooter>
                  )}
                </SettingsCard>
              </SettingsSection>

              {/* About */}
              <SettingsSection title={t("settings.about.title")}>
                <SettingsCard>
                  <SettingsRow label={t("settings.about.version")}>
                    <div className="flex items-center gap-2">
                      <span className="text-white/38">
                        {electronPackage.version}
                      </span>
                    </div>
                  </SettingsRow>
                  <SettingsRow
                    label={t("settings.about.futureUpdates")}
                    description={t("settings.about.futureUpdatesDesc")}
                    action={
                      <button
                        type="button"
                        onClick={() => window.electronAPI.openUrl(RUNNEROS_UPDATES_URL)}
                        className={quietButtonClass}
                      >
                        {t("settings.about.openRunnerUpdates")}
                      </button>
                    }
                  />
                </SettingsCard>
              </SettingsSection>
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
