import { Mic, MicOff, RefreshCw, Volume2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { ArtistManagerVoiceState } from '@/hooks/useArtistManagerVoice'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '@/lib/navigate'
import { ARTIST_MANAGER_VOICE_STYLES } from '@/lib/artist-manager-voice-style'
import { ArtistManagerVoiceTiming } from './ArtistManagerVoiceTiming'

export function ArtistManagerVoiceDialog({ voice }: { voice: ArtistManagerVoiceState }) {
  const { navigate } = useNavigation()
  const busy = voice.running || voice.starting || voice.stopping
  return (
    <Dialog open={voice.open} onOpenChange={(open) => {
      voice.setOpen(open)
      if (!open) void voice.stop()
    }}>
      <DialogContent className="max-h-[90vh] max-w-[560px] overflow-y-auto border-white/[0.09] bg-[#0a0a0a] p-0 text-white shadow-modal-small">
        <div className="relative px-7 pb-7 pt-6">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(ellipse_at_top,rgba(255,92,0,0.14),transparent_70%)]" />
          <DialogHeader className="relative">
            <p className="text-[9px] font-medium uppercase tracking-[0.28em] text-orange-400/75">Artist HQ</p>
            <DialogTitle className="mt-2 text-2xl font-medium tracking-[-0.03em]">Talk to your manager</DialogTitle>
            <DialogDescription className="max-w-md text-[12px] leading-5 text-white/46">
              Talk through priorities and decisions using your artist brief. Agree on the next work, then confirm a handoff to Command.
            </DialogDescription>
          </DialogHeader>

          <div className="relative mt-5 flex items-center justify-between gap-3 text-xs text-white/55">
            <div>
              <p>{voice.voiceModel ? `Voice · ${voice.voiceModel.replace(/^pi\//, '')}` : 'Choose a voice model to get started'}</p>
              <p className="mt-1 text-[11px] text-white/35">{ARTIST_MANAGER_VOICE_STYLES.find(style => style.id === voice.managerStyle)?.label} · Command keeps its own model</p>
            </div>
            <button type="button" disabled={busy} className="shrink-0 text-orange-300 underline underline-offset-4 disabled:opacity-40" onClick={() => {
              voice.setOpen(false)
              navigate(routes.view.settings('conversation'))
            }}>Conversation settings</button>
          </div>

          <div className="relative mt-6 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/35">Status</p>
                <p className="mt-1 text-sm text-white/78">{voice.status}</p>
              </div>
              <button
                type="button"
                onClick={() => void voice.refreshProviders()}
                disabled={busy}
                aria-label="Refresh voice setup"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] text-white/38 transition-colors hover:bg-white/[0.05] hover:text-white/75"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <ProviderState label="Hearing" ready={voice.hearingReady} />
              <ProviderState label="Speaking" ready={voice.inworldReady} />
            </div>

            {(voice.userText || voice.assistantText) ? (
              <div className="mt-5 space-y-3 border-t border-white/[0.06] pt-4">
                {voice.userText ? <TranscriptLine label="You" text={voice.userText} /> : null}
                {voice.assistantText ? <TranscriptLine label="Manager" text={voice.assistantText} /> : null}
              </div>
            ) : (
              <div className="mt-6 flex min-h-24 items-center justify-center text-center">
                <p className="max-w-xs text-[12px] leading-5 text-white/32">
                  {voice.providerReady
                    ? 'Start the conversation, then speak naturally. Wait for the manager to finish before replying; speaking over playback is disabled to prevent echo.'
                    : !voice.voiceRouteReady ? 'Choose your separate voice connection and model in Settings → Conversation.'
                    : 'Choose an installed hearing model in Conversation settings, or install the selected model below. Speaking uses your Inworld TTS connection.'}
                </p>
              </div>
            )}

            {voice.error ? (
              <p className="mt-4 rounded-xl border border-red-400/15 bg-red-500/[0.06] px-3 py-2.5 text-[11px] leading-4 text-red-100/75">
                {voice.error}
              </p>
            ) : null}
          </div>

          <details className="relative mt-4 text-xs text-white/65">
            <summary className="cursor-pointer py-2">Audio devices and model installation</summary>
            <fieldset disabled={busy || voice.installing} className="mt-2 space-y-3 disabled:opacity-60">
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
          </details>

          <ArtistManagerVoiceTiming voice={voice} />

          <button
            type="button"
            onClick={() => void (busy ? voice.stop() : voice.start())}
            disabled={voice.stopping || (!busy && (!voice.providerReady || voice.installing))}
            className={cn(
              'relative mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-35',
              voice.running
                ? 'border border-white/[0.1] bg-white/[0.045] text-white/80 hover:bg-white/[0.075]'
                : 'bg-[#ff5a0a] text-black hover:bg-[#ff6a1a]',
            )}
          >
            {voice.running ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            {voice.stopping ? 'Stopping…' : voice.starting ? 'Cancel connection' : voice.running ? 'End conversation' : 'Start conversation'}
          </button>

          <div className="relative mt-4 flex items-center justify-center gap-2 text-[10px] text-white/24">
            <Volume2 className="h-3 w-3" />
            Focused conversation · confirmed handoff to Command · only the agreed brief carries over.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ProviderState({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-black/25 px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-white/38">
      <span className={cn('h-1.5 w-1.5 rounded-full', ready ? 'bg-emerald-400' : 'bg-white/18')} />
      {label}
    </div>
  )
}

function TranscriptLine({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-[0.2em] text-white/28">{label}</p>
      <p className="mt-1 text-[13px] leading-5 text-white/72">{text}</p>
    </div>
  )
}
