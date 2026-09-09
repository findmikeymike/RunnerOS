import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SettingsCard, SettingsRow, SettingsMenuSelectRow, SettingsSection } from '@/components/settings'
import { useAppShellContext } from '@/context/AppShellContext'
import { ARTIST_MANAGER_VOICE_STYLES } from '@/lib/artist-manager-voice-style'
import { navigate, routes } from '@/lib/navigate'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { buildVoiceModelOptions, voiceModelOptionValue, voiceModelProvider, type VoiceModelCatalogEntry } from '@/lib/voice-model-options'
import { parseArtistManagerVoiceSettings, type ArtistManagerVoiceSettings } from '@craft-agent/shared/config/artist-manager-voice-settings'
import type { ArtistManagerMoonshineStatus } from '../../../shared/types'

export const meta: DetailsPageMeta = { navigator: 'settings', slug: 'conversation' }

const HEARING_OPTIONS = [
  { value: 'moonshine-small-streaming-en', label: 'Moonshine Balanced', description: 'Local transcription' },
  { value: 'assembly_ai', label: 'AssemblyAI', description: 'Cloud transcription' },
]

export default function ConversationSettingsPage() {
  const { t } = useTranslation()
  const { llmConnections, refreshLlmConnections } = useAppShellContext()
  const [draft, setDraft] = useState<ArtistManagerVoiceSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [reload, setReload] = useState(0)
  const [moonshine, setMoonshine] = useState<ArtistManagerMoonshineStatus | null>(null)
  const [cloud, setCloud] = useState<{ assemblyAi: boolean; inworld: boolean } | null>(null)
  const [hearingError, setHearingError] = useState(false)
  const [catalogs, setCatalogs] = useState<Record<string, VoiceModelCatalogEntry[]>>({})
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelError, setModelError] = useState(false)
  const [modelRetry, setModelRetry] = useState(0)
  const [refreshingConnections, setRefreshingConnections] = useState(false)
  const [connectionError, setConnectionError] = useState(false)
  const mounted = useRef(false)
  const savingRef = useRef(false)

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const refreshModels = useCallback(async () => {
    setRefreshingConnections(true); setConnectionError(false)
    try {
      await refreshLlmConnections()
      if (mounted.current) setModelRetry(value => value + 1)
    } catch {
      if (mounted.current) setConnectionError(true)
    } finally {
      if (mounted.current) setRefreshingConnections(false)
    }
  }, [refreshLlmConnections])
  useEffect(() => { void refreshModels() }, [refreshModels])
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    void window.electronAPI.artistManagerVoiceSettings.get().then(value => {
      const settings = parseArtistManagerVoiceSettings(value)
      if (!cancelled) { setDraft(settings) }
    }).catch(() => {
      if (!cancelled) setError('Conversation settings could not be loaded. Your saved settings have not been changed.')
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [reload])

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      window.electronAPI.invokeArtistManagerMoonshine({ method: 'status' }) as Promise<ArtistManagerMoonshineStatus>,
      window.electronAPI.getArtistManagerVoiceProviderStatus(),
    ]).then(([local, providers]) => {
      if (!cancelled) { setMoonshine(local); setCloud(providers); setHearingError(false) }
    }).catch(() => { if (!cancelled) setHearingError(true) })
    return () => { cancelled = true }
  }, [reload])

  const connections = useMemo(() => llmConnections.filter(connection => voiceModelProvider(connection)), [llmConnections])
  const providerKey = [...new Set(connections.map(connection => voiceModelProvider(connection)!))].sort().join(',')
  useEffect(() => {
    let cancelled = false
    const providers = providerKey ? providerKey.split(',') : []
    setCatalogs({}); setModelError(false); setModelsLoading(providers.length > 0)
    void Promise.allSettled(providers.map(async provider => ({ provider, result: await window.electronAPI.getPiProviderModels(provider) }))).then(results => {
      if (cancelled) return
      const next: Record<string, VoiceModelCatalogEntry[]> = {}
      for (const result of results) {
        if (result.status === 'fulfilled') next[result.value.provider] = result.value.result.models
      }
      setCatalogs(next); setModelError(results.some(result => result.status === 'rejected')); setModelsLoading(false)
    })
    return () => { cancelled = true }
  }, [providerKey, modelRetry])
  const models = useMemo(() => buildVoiceModelOptions(connections, catalogs), [connections, catalogs])
  const modelValue = draft?.connectionSlug && draft.model ? voiceModelOptionValue(draft.connectionSlug, draft.model) : ''
  const selectedModel = models.find(model => model.value === modelValue)
  const unavailableRoute = !selectedModel
  const disabled = loading || saving || !draft
  const change = async (patch: Partial<ArtistManagerVoiceSettings>) => {
    if (!draft || savingRef.current || loading) return
    const previous = draft
    const submitted = { ...draft, ...patch }
    savingRef.current = true; setSaving(true); setError(null); setNotice('')
    setDraft(submitted)
    try {
      const result = parseArtistManagerVoiceSettings(await window.electronAPI.artistManagerVoiceSettings.update(submitted))
      if (mounted.current) { setDraft(result); setNotice('Saved') }
    } catch (cause) {
      if (mounted.current) {
        setDraft(previous)
        setError(cause instanceof Error ? `Not saved: ${cause.message}` : 'Change could not be saved. Please try again.')
      }
    } finally {
      savingRef.current = false
      if (mounted.current) setSaving(false)
    }
  }
  const tier = moonshine?.tiers.find(item => item.modelId === draft?.sttSelection)
  const hearingStatus = hearingError ? 'Hearing status is unavailable. Check setup in the conversation window.'
    : draft?.sttSelection === 'assembly_ai' ? cloud === null ? 'Checking hearing setup…' : cloud.assemblyAi ? 'AssemblyAI is connected.' : 'Add your AssemblyAI key in Services.'
    : moonshine === null ? 'Checking hearing setup…' : !moonshine.available ? 'Local hearing is unavailable in this build.'
    : tier?.registered && tier.installState === 'ready' && !tier.hasError ? 'Installed and ready on this computer.' : 'Install this model in the conversation window’s Call settings.'

  return (
    <div className="flex h-full flex-col">
      <PanelHeader />
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-[1600px] space-y-6 px-6 pb-8 pt-10 text-white/80">
          {loading ? <p role="status" className="text-xs text-white/55">Loading…</p> : draft ? <>
            <SettingsSection title={t('settings.conversation.title')} description="Saves automatically. Applies to your next call."
              action={<div className="flex items-center gap-4">
                <button type="button" className="text-xs text-white/55 transition-colors hover:text-white" onClick={() => navigate(routes.view.settings('ai'))}>Models</button>
                <button type="button" className="text-xs text-white/55 transition-colors hover:text-white disabled:opacity-40" disabled={refreshingConnections || modelsLoading || saving} onClick={() => void refreshModels()}>{refreshingConnections || modelsLoading ? 'Refreshing…' : 'Refresh'}</button>
              </div>}>
              <SettingsCard>
                <SettingsMenuSelectRow label="Voice model" value={modelValue}
                  description={selectedModel?.description}
                  placeholder={modelsLoading ? 'Loading models…' : 'Choose a model'} disabled={disabled || modelsLoading}
                  onValueChange={value => {
                    const model = models.find(option => option.value === value)
                    if (model) change({ connectionSlug: model.connectionSlug, model: model.model })
                  }} options={models} searchable />
                <SettingsMenuSelectRow label="Reasoning" value={draft.thinking} disabled={disabled}
                  onValueChange={value => change({ thinking: value as ArtistManagerVoiceSettings['thinking'] })}
                  options={[{ value: 'low', label: 'Low', description: 'A little reasoning for practical decisions' }, { value: 'off', label: 'Off', description: 'Respond directly, when supported by the model' }]} />
                <SettingsMenuSelectRow label="Manager" value={draft.style} disabled={disabled}
                  onValueChange={value => change({ style: value as ArtistManagerVoiceSettings['style'] })}
                  options={ARTIST_MANAGER_VOICE_STYLES.map(style => ({ value: style.id, label: style.label, description: style.description }))} />
              </SettingsCard>
              {unavailableRoute && !modelsLoading && !modelError ? <p className="text-xs text-white/55">{draft.model ? 'Your saved voice model is unavailable. Choose a supported fast model.' : models.length ? 'Choose a voice model to get started.' : 'Sign in to ChatGPT or connect an API-key provider in Models to choose a fast voice model.'}</p> : null}
              {unavailableRoute && !modelsLoading && llmConnections.some(connection => connection.isAuthenticated && connection.authType === 'oauth' && (connection.providerType === 'anthropic' || connection.piAuthProvider === 'anthropic')) ? <p className="text-xs text-white/55">Claude voice requires an Anthropic API key.</p> : null}
              {modelError ? <p className="text-xs text-destructive">Some model choices could not be loaded. <button type="button" className="underline" onClick={() => setModelRetry(value => value + 1)}>Retry</button></p> : null}
              {connectionError ? <p role="alert" className="text-xs text-destructive">Connections could not be refreshed. Please try again.</p> : null}
            </SettingsSection>
            <SettingsSection title="Audio">
              <SettingsCard>
                <SettingsRow label="Speaking">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/65">
                      <span className={`size-1.5 rounded-full ${cloud?.inworld ? 'bg-emerald-400' : 'bg-white/30'}`} />
                      Inworld · {cloud === null ? hearingError ? 'Unavailable' : 'Checking…' : cloud.inworld ? 'Connected' : 'Missing key'}
                    </span>
                    <button type="button" className="text-xs text-white/65 underline underline-offset-4" onClick={() => navigate(routes.view.settings('secrets'))}>{cloud?.inworld ? 'Manage' : 'Set up'}</button>
                  </div>
                </SettingsRow>
                <SettingsMenuSelectRow label="Hearing" value={draft.sttSelection} disabled={disabled}
                  description={hearingStatus === 'Installed and ready on this computer.' || hearingStatus === 'AssemblyAI is connected.' ? undefined : hearingStatus}
                  placeholder="Choose hearing" onValueChange={value => change({ sttSelection: value })} options={HEARING_OPTIONS} />
              </SettingsCard>
            </SettingsSection>
          </> : null}
          <div className="text-xs text-white/55" role={error ? 'alert' : 'status'}>
            {error ? <span className="text-destructive">{error}</span> : saving ? 'Saving…' : notice}
            {!draft && !loading ? <button type="button" className="ml-2 underline" onClick={() => setReload(value => value + 1)}>Retry</button> : null}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
