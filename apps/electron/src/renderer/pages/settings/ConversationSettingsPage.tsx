import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { SettingsMenuSelectRow, SettingsSection } from '@/components/settings'
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
  const { llmConnections } = useAppShellContext()
  const [saved, setSaved] = useState<ArtistManagerVoiceSettings | null>(null)
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
  const mounted = useRef(false)
  const savingRef = useRef(false)

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    void window.electronAPI.artistManagerVoiceSettings.get().then(value => {
      const settings = parseArtistManagerVoiceSettings(value)
      if (!cancelled) { setSaved(settings); setDraft(settings) }
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
  const dirty = Boolean(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved))
  const unavailableRoute = !selectedModel
  const hearingSupported = HEARING_OPTIONS.some(option => option.value === draft?.sttSelection)
  const disabled = loading || saving || !draft
  const change = (patch: Partial<ArtistManagerVoiceSettings>) => {
    if (savingRef.current || loading) return
    setDraft(current => current ? { ...current, ...patch } : current)
    setNotice(''); setError(null)
  }
  const save = async () => {
    if (!draft || savingRef.current || !dirty || !hearingSupported || unavailableRoute) return
    const submitted = { ...draft }
    savingRef.current = true; setSaving(true); setError(null); setNotice('')
    try {
      const result = parseArtistManagerVoiceSettings(await window.electronAPI.artistManagerVoiceSettings.update(submitted))
      if (mounted.current) { setSaved(result); setDraft(result); setNotice('Saved. Applies to your next conversation.') }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Conversation settings could not be saved. Please try again.')
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
        <div className="mx-auto max-w-4xl space-y-6 px-6 pb-8 pt-10">
          <div>
            <h1 className="text-base font-medium tracking-tight">{t('settings.conversation.title')}</h1>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">Talk music, career, and what’s on your mind. Move agreed work to Command when you’re ready.</p>
          </div>
          {loading ? <p role="status" className="text-sm text-muted-foreground">Loading conversation settings…</p> : draft ? <>
            <SettingsSection title="Conversation" description="Separate from Command’s model and permissions.">
              <div className="divide-y divide-white/[0.06]">
                <SettingsMenuSelectRow inCard={false} label="Voice model" value={modelValue}
                  description={selectedModel?.description ?? 'Fast models from your connected providers'}
                  placeholder={modelsLoading ? 'Loading models…' : 'Choose a supported model'} disabled={disabled || modelsLoading}
                  onValueChange={value => {
                    const model = models.find(option => option.value === value)
                    if (model) change({ connectionSlug: model.connectionSlug, model: model.model })
                  }} options={models} searchable />
                <SettingsMenuSelectRow inCard={false} label="Reasoning" value={draft.thinking} disabled={disabled}
                  onValueChange={value => change({ thinking: value as ArtistManagerVoiceSettings['thinking'] })}
                  options={[{ value: 'low', label: 'Low', description: 'A little reasoning for practical decisions' }, { value: 'off', label: 'Off', description: 'Respond directly, when supported by the model' }]} />
                <SettingsMenuSelectRow inCard={false} label="Manager" value={draft.style} disabled={disabled}
                  description={ARTIST_MANAGER_VOICE_STYLES.find(style => style.id === draft.style)?.description}
                  onValueChange={value => change({ style: value as ArtistManagerVoiceSettings['style'] })}
                  options={ARTIST_MANAGER_VOICE_STYLES.map(style => ({ value: style.id, label: style.label, description: style.description }))} />
              </div>
              {unavailableRoute && !modelsLoading && !modelError ? <p className="text-xs text-muted-foreground">{draft.model ? 'Choose a supported fast model before saving. Your saved model has not been changed.' : models.length ? 'Choose a voice model to get started.' : 'Connect an API-key provider in Models to choose a fast voice model.'}</p> : null}
              {modelError ? <p className="text-xs text-destructive">Some model choices could not be loaded. <button type="button" className="underline" onClick={() => setModelRetry(value => value + 1)}>Retry</button></p> : null}
              <Button variant="link" className="h-auto p-0 text-xs" onClick={() => navigate(routes.view.settings('ai'))}>Manage models</Button>
            </SettingsSection>
            <SettingsSection title="Audio">
              <div className="divide-y divide-white/[0.06]">
                <div className="flex items-center justify-between gap-4 py-3">
                  <span className="text-[13px] text-white/80">Speaking</span>
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/65">
                      <span className={`size-1.5 rounded-full ${cloud?.inworld ? 'bg-emerald-400' : 'bg-white/30'}`} />
                      Inworld · {cloud === null ? hearingError ? 'Unavailable' : 'Checking…' : cloud.inworld ? 'Connected' : 'Missing key'}
                    </span>
                    <button type="button" className="text-xs text-white/65 underline underline-offset-4" onClick={() => navigate(routes.view.settings('secrets'))}>{cloud?.inworld ? 'Manage' : 'Set up'}</button>
                  </div>
                </div>
                <SettingsMenuSelectRow inCard={false} label="Hearing" value={draft.sttSelection} disabled={disabled}
                  placeholder="Choose hearing" onValueChange={value => change({ sttSelection: value })} options={HEARING_OPTIONS} />
              </div>
              <p className="text-xs leading-5 text-muted-foreground">{hearingSupported ? hearingStatus : 'Choose Moonshine Balanced or AssemblyAI before saving.'}</p>
              <p className="text-xs leading-5 text-muted-foreground">Microphone and speaker controls are in Call settings.</p>
            </SettingsSection>
          </> : null}
        </div>
      </ScrollArea>
      <div className="flex items-center justify-between gap-4 border-t border-white/[0.06] px-6 py-4">
        <div className="min-w-0 text-xs leading-5">
          {error ? <p role="alert" className="text-destructive">{error}</p> : <p role="status" className="text-muted-foreground">{saving ? 'Saving…' : notice || (dirty ? 'Unsaved changes' : draft ? 'Changes apply to your next conversation.' : '')}</p>}
          {!draft && !loading ? <button type="button" className="mt-1 underline" onClick={() => setReload(value => value + 1)}>Retry loading settings</button> : null}
        </div>
        <Button disabled={disabled || !dirty || !hearingSupported || unavailableRoute || modelsLoading} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </div>
  )
}
