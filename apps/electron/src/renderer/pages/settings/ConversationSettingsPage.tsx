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
import { getModelShortName } from '@config/models'
import { getModelsForProviderType } from '@config/llm-connections'
import { parseArtistManagerVoiceSettings, type ArtistManagerVoiceSettings } from '@craft-agent/shared/config/artist-manager-voice-settings'
import type { ArtistManagerMoonshineStatus, LlmConnectionWithStatus } from '../../../shared/types'

export const meta: DetailsPageMeta = { navigator: 'settings', slug: 'conversation' }

type ModelOption = { value: string; label: string; description?: string }
const modelIdentity = (value: string) => value.replace(/^pi\//, '')

function connectionModels(connection: LlmConnectionWithStatus | undefined): ModelOption[] {
  if (!connection) return []
  const models = connection.models?.length ? connection.models : getModelsForProviderType(connection.providerType, connection.piAuthProvider)
  return models.map(model => typeof model === 'string'
    ? { value: model, label: getModelShortName(model) }
    : { value: model.id, label: model.name, description: model.description })
    .filter(model => !['default', 'fast'].includes(modelIdentity(model.value)))
}

const HEARING_OPTIONS = [
  { value: 'moonshine-small-streaming-en', label: 'Moonshine Balanced', description: 'Local transcription' },
  { value: 'moonshine-tiny-streaming-en', label: 'Moonshine Lightweight', description: 'Local transcription' },
  { value: 'moonshine-medium-streaming-en', label: 'Moonshine Quality', description: 'Local transcription' },
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
  const [remoteModels, setRemoteModels] = useState<{ slug: string; options: ModelOption[] } | null>(null)
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

  const connections = useMemo(() => llmConnections.filter(connection =>
    connection.authType === 'api_key' || connection.authType === 'api_key_with_endpoint'), [llmConnections])
  const selectedConnection = connections.find(connection => connection.slug === draft?.connectionSlug)
  const localModels = useMemo(() => connectionModels(selectedConnection), [selectedConnection])
  useEffect(() => {
    let cancelled = false
    setRemoteModels(null); setModelError(false); setModelsLoading(false)
    if (!selectedConnection?.piAuthProvider) return
    setModelsLoading(true)
    void window.electronAPI.getPiProviderModels(selectedConnection.piAuthProvider).then(result => {
      if (!cancelled) setRemoteModels({ slug: selectedConnection.slug, options: result.models.map(model => ({ value: model.id, label: model.name })) })
    }).catch(() => { if (!cancelled) setModelError(true) })
      .finally(() => { if (!cancelled) setModelsLoading(false) })
    return () => { cancelled = true }
  }, [selectedConnection, modelRetry])
  const models = useMemo(() => {
    // A connection's curated tiers are not the full provider catalog. Once we
    // have a catalog, retain curated labels only for IDs the provider includes.
    const catalog = selectedConnection?.piAuthProvider
      ? remoteModels?.slug === selectedConnection.slug ? remoteModels.options : []
      : localModels
    const curated = new Map(localModels.map(model => [modelIdentity(model.value), model]))
    const seen = new Set<string>()
    return catalog.flatMap(model => {
      const id = modelIdentity(model.value)
      if (!id || ['default', 'fast'].includes(id) || seen.has(id)) return []
      seen.add(id)
      return [{
        ...model, ...curated.get(id),
        // Both bare and pi-prefixed IDs resolve to the same exact SDK model.
        // Keep the saved spelling selected without silently rewriting it.
        value: draft?.model && modelIdentity(draft.model) === id ? draft.model : model.value,
      }]
    })
  }, [selectedConnection, remoteModels, localModels, draft?.model])
  const dirty = Boolean(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved))
  const incompleteRoute = Boolean(draft?.connectionSlug) !== Boolean(draft?.model)
  const unavailableRoute = Boolean(draft?.connectionSlug && (!selectedConnection || !models.some(model => model.value === draft.model)))
  const disabled = loading || saving || !draft
  const change = (patch: Partial<ArtistManagerVoiceSettings>) => {
    if (savingRef.current || loading) return
    setDraft(current => current ? { ...current, ...patch } : current)
    setNotice(''); setError(null)
  }
  const save = async () => {
    if (!draft || savingRef.current || !dirty || incompleteRoute || unavailableRoute) return
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
        <div className="mx-auto max-w-4xl space-y-8 px-6 pb-8 pt-10">
          <div>
            <h1 className="text-xl font-medium tracking-tight">{t('settings.conversation.title')}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Talk through priorities with your artist brief. Confirm agreed work to carry it into Command as an unsent draft.</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">These settings are independent of Command’s Artist Manager model and permissions.</p>
          </div>
          {loading ? <p role="status" className="text-sm text-muted-foreground">Loading conversation settings…</p> : draft ? <>
            <SettingsSection title="Voice model" description="Choose a model for fast conversation. Short replies and low reasoning keep the conversation moving.">
              <div className="divide-y divide-white/[0.06]">
                <SettingsMenuSelectRow inCard={false} label="Connection" value={draft.connectionSlug ?? ''} disabled={disabled}
                  placeholder="Choose a connection" onValueChange={value => change({ connectionSlug: value || null, model: null })}
                  options={[{ value: '', label: 'Not configured' }, ...connections.map(connection => ({ value: connection.slug, label: connection.name, description: connection.isAuthenticated ? undefined : 'API key setup required' }))]} />
                <SettingsMenuSelectRow inCard={false} label="Voice model (fast conversation)" value={draft.model ?? ''}
                  placeholder={modelsLoading ? 'Loading models…' : 'Choose a model'} disabled={disabled || !selectedConnection || modelsLoading}
                  onValueChange={value => change({ model: value })} options={models} searchable />
                <SettingsMenuSelectRow inCard={false} label="Reasoning" value={draft.thinking} disabled={disabled}
                  onValueChange={value => change({ thinking: value as ArtistManagerVoiceSettings['thinking'] })}
                  options={[{ value: 'low', label: 'Low', description: 'A little reasoning for practical decisions' }, { value: 'off', label: 'Off', description: 'Respond directly, when supported by the model' }]} />
              </div>
              {incompleteRoute ? <p className="text-xs text-muted-foreground">Choose a model for this connection before saving.</p> : unavailableRoute && !modelsLoading && !modelError ? <p className="text-xs text-muted-foreground">The saved connection or model is unavailable. Choose an available route before saving.</p> : null}
              {modelError ? <p className="text-xs text-destructive">Models could not be loaded. <button type="button" className="underline" onClick={() => setModelRetry(value => value + 1)}>Retry loading models</button></p> : null}
              <Button variant="link" className="h-auto p-0 text-xs" onClick={() => navigate(routes.view.settings('ai'))}>Manage model connections</Button>
            </SettingsSection>
            <SettingsSection title="Speaking style">
              <SettingsMenuSelectRow inCard={false} label="Tone" value={draft.style} disabled={disabled}
                onValueChange={value => change({ style: value as ArtistManagerVoiceSettings['style'] })}
                options={ARTIST_MANAGER_VOICE_STYLES.map(style => ({ value: style.id, label: style.label, description: style.description }))} />
            </SettingsSection>
            <SettingsSection title="Hearing" description="Choose how your speech becomes text.">
              <SettingsMenuSelectRow inCard={false} label="Transcription" value={draft.sttSelection} disabled={disabled}
                onValueChange={value => change({ sttSelection: value })} options={HEARING_OPTIONS} />
              <p className="text-xs leading-5 text-muted-foreground">{hearingStatus}</p>
              <p className="text-xs leading-5 text-muted-foreground">Microphone, speaker, and local model installation controls are in the conversation window’s Call settings.</p>
              <p className="text-xs leading-5 text-muted-foreground">{cloud?.inworld === false ? 'Add your Inworld key in Services for spoken replies.' : 'Inworld provides the spoken voice.'}</p>
              <Button variant="link" className="h-auto p-0 text-xs" onClick={() => navigate(routes.view.settings('secrets'))}>Manage voice service keys</Button>
            </SettingsSection>
          </> : null}
        </div>
      </ScrollArea>
      <div className="flex items-center justify-between gap-4 border-t border-white/[0.06] px-6 py-4">
        <div className="min-w-0 text-xs leading-5">
          {error ? <p role="alert" className="text-destructive">{error}</p> : <p role="status" className="text-muted-foreground">{saving ? 'Saving…' : notice || (dirty ? 'Unsaved changes' : draft ? 'Changes apply to your next conversation.' : '')}</p>}
          {!draft && !loading ? <button type="button" className="mt-1 underline" onClick={() => setReload(value => value + 1)}>Retry loading settings</button> : null}
        </div>
        <Button disabled={disabled || !dirty || incompleteRoute || unavailableRoute || modelsLoading} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </div>
  )
}
