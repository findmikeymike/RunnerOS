import { RefreshCw } from 'lucide-react'
import type { ArtistManagerVoiceState } from '@/hooks/useArtistManagerVoice'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '@/lib/navigate'
import { ArtistManagerVoiceTiming } from './ArtistManagerVoiceTiming'

export function ArtistManagerVoiceSetup({ voice }: { voice: ArtistManagerVoiceState }) {
  const { navigate } = useNavigation()
  const busy = voice.running || voice.starting || voice.stopping
  return (
    <div className="space-y-6 text-xs leading-5 text-white/65">
      <button type="button" disabled={busy || voice.installing} className="text-white underline underline-offset-4 disabled:opacity-40" onClick={() => {
        voice.setOpen(false)
        navigate(routes.view.settings('conversation'))
      }}>Open Conversation settings</button>
      <p className="-mt-3 text-white/40">Model, tone and hearing preferences live in Settings.</p>
      <fieldset disabled={busy || voice.installing} className="space-y-4 disabled:opacity-60">
        <p>Hearing: {voice.sttSelection === 'assembly_ai' ? 'AssemblyAI · cloud' : ({ 'moonshine-tiny-streaming-en': 'Moonshine Lightweight', 'moonshine-small-streaming-en': 'Moonshine Balanced', 'moonshine-medium-streaming-en': 'Moonshine Quality' } as Record<string, string>)[voice.sttSelection] || voice.sttSelection}</p>
        {voice.sttSelection !== 'assembly_ai' ? (
          <div className="flex items-center justify-between gap-2">
            <span>{voice.moonshineAvailable ? (voice.moonshineTiers.find((tier) => tier.modelId === voice.sttSelection)?.installState ?? 'Not installed') : 'Local hearing is unavailable in this build'}</span>
            <button type="button" disabled={!voice.moonshineAvailable || voice.hearingReady} className="rounded-lg border border-white/10 px-3 py-2 disabled:opacity-40" onClick={() => void voice.installMoonshine(voice.sttSelection)}>{voice.installing ? 'Installing…' : 'Install model'}</button>
          </div>
        ) : null}
        <label className="block">Microphone
          <select aria-label="Microphone" value={voice.inputDeviceId} onChange={(event) => voice.setInputDeviceId(event.target.value)} className="mt-1 block w-full rounded-lg border border-white/10 bg-[#171717] p-2">
            <option value="">System default microphone</option>
            {voice.devices.filter((device) => device.kind === 'audioinput').map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}
          </select>
        </label>
        <label className="block">Speaker output
          <select aria-label="Speaker output" value={voice.outputDeviceId} onChange={(event) => voice.setOutputDeviceId(event.target.value)} className="mt-1 block w-full rounded-lg border border-white/10 bg-[#171717] p-2">
            <option value="">System default output</option>
            {voice.devices.filter((device) => device.kind === 'audiooutput').map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Output ${index + 1}`}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => void voice.refreshDevices()} className="text-white/65 underline underline-offset-4">Refresh audio devices</button>
        <p>Speaking: Inworld Flash with your saved default agent voice. Provider credentials stay in Settings.</p>
      </fieldset>

      <button type="button" disabled={busy || voice.installing} onClick={() => void voice.refreshProviders()} className="inline-flex items-center gap-2 text-white/65 disabled:opacity-40">
        <RefreshCw className="size-3.5" /> Refresh audio setup
      </button>
      <ArtistManagerVoiceTiming voice={voice} />
    </div>
  )
}
