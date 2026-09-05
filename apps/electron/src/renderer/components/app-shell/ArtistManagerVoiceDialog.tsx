import { useRef } from 'react'
import { Mic, MicOff, RefreshCw, Volume2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { ArtistManagerVoiceState } from '@/hooks/useArtistManagerVoice'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '@/lib/navigate'
import { handVoiceSessionToChat } from '@/lib/voice-managed-sessions'
import { useAppShellContext, usePendingPermission, usePendingCredential } from '@/context/AppShellContext'
import { StructuredInput } from './input/StructuredInput'
import type { StructuredInputState, StructuredResponse } from './input/structured/types'

export function ArtistManagerVoiceDialog({ voice }: { voice: ArtistManagerVoiceState }) {
  const { navigate } = useNavigation()
  const { onRespondToPermission, onRespondToCredential } = useAppShellContext()
  const permission = usePendingPermission(voice.sessionId ?? '')
  const credential = usePendingCredential(voice.sessionId ?? '')
  const pendingPermission = permission?.sessionId === voice.sessionId ? permission : undefined
  const pendingCredential = credential?.sessionId === voice.sessionId ? credential : undefined
  const structured: StructuredInputState | undefined = pendingPermission
    ? pendingPermission.type === 'admin_approval'
      ? { type: 'admin_approval', data: {
          appName: pendingPermission.appName || pendingPermission.toolName || 'System action',
          reason: pendingPermission.reason || pendingPermission.description,
          impact: pendingPermission.impact,
          command: pendingPermission.command || '',
          requiresSystemPrompt: pendingPermission.requiresSystemPrompt ?? true,
          rememberForMinutes: pendingPermission.rememberForMinutes ?? 10,
        } }
      : { type: 'permission', data: pendingPermission }
    : pendingCredential ? { type: 'credential', data: pendingCredential } : undefined
  const requestKey = voice.open && structured ? `${voice.sessionId}:${structured.type}:${pendingPermission?.requestId ?? pendingCredential?.requestId}` : null
  const currentRequest = useRef(requestKey)
  currentRequest.current = requestKey
  const respondedRequest = useRef<string | null>(null)
  const respond = (response: StructuredResponse) => {
    // Only the visible request in this voice session can receive a response.
    // An async credential response from an unmounted request must not submit.
    if (!voice.open || !voice.sessionId || !requestKey || currentRequest.current !== requestKey || respondedRequest.current === requestKey || response.type !== structured?.type) return
    if (response.type === 'permission' && pendingPermission) {
      if (!onRespondToPermission) return
      respondedRequest.current = requestKey
      onRespondToPermission?.(voice.sessionId, pendingPermission.requestId, response.allowed, response.alwaysAllow)
    } else if (response.type === 'admin_approval' && pendingPermission) {
      if (!onRespondToPermission) return
      respondedRequest.current = requestKey
      onRespondToPermission?.(voice.sessionId, pendingPermission.requestId, response.approved, false, { rememberForMinutes: response.rememberForMinutes })
    } else if (response.type === 'credential' && pendingCredential) {
      if (!onRespondToCredential) return
      respondedRequest.current = requestKey
      onRespondToCredential?.(voice.sessionId, pendingCredential.requestId, response)
    }
  }
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
              A private voice conversation with the same manager that knows your artist context, release horizon, campaigns, and weekly signals.
            </DialogDescription>
          </DialogHeader>

          <div className="relative mt-6 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/35">Status</p>
                <p className="mt-1 text-sm text-white/78">{voice.status}</p>
              </div>
              <button
                type="button"
                onClick={() => void voice.refreshProviders()}
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
                    : 'Choose an installed local hearing model below, or configure AssemblyAI. Speaking requires an Inworld key in Settings.'}
                </p>
              </div>
            )}

            {voice.error ? (
              <p className="mt-4 rounded-xl border border-red-400/15 bg-red-500/[0.06] px-3 py-2.5 text-[11px] leading-4 text-red-100/75">
                {voice.error}
              </p>
            ) : null}
          </div>

          {structured ? (
            <div className="relative mt-4" role="region" aria-label="Manager action requires your input">
              <p className="mb-2 text-xs text-orange-200">Your manager needs your approval or credentials. Respond here, not by voice.</p>
              <StructuredInput key={`${voice.sessionId}:${pendingPermission?.requestId ?? pendingCredential?.requestId}`} state={structured} onResponse={respond} />
            </div>
          ) : null}

          <details className="relative mt-4 text-xs text-white/65">
            <summary className="cursor-pointer py-2">Voice settings</summary>
            <fieldset disabled={busy || voice.installing} className="mt-2 space-y-3 disabled:opacity-60">
              <label className="block">Hearing
                <select aria-label="Hearing provider and model" value={voice.sttSelection} onChange={(event) => voice.setSttSelection(event.target.value)} className="mt-1 block w-full rounded-lg border border-white/10 bg-[#171717] p-2">
                  <option value="moonshine-small-streaming-en" disabled={!voice.moonshineAvailable}>Moonshine Balanced · local</option>
                  <option value="moonshine-tiny-streaming-en" disabled={!voice.moonshineAvailable}>Moonshine Lightweight · local</option>
                  <option value="moonshine-medium-streaming-en" disabled={!voice.moonshineAvailable}>Moonshine Quality · local</option>
                  <option value="assembly_ai">AssemblyAI · cloud</option>
                </select>
              </label>
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
              <p>Speaking: Inworld Flash. Provider credentials stay in Settings.</p>
            </fieldset>
          </details>

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

          {voice.conversationSessionId ? <button type="button" disabled={voice.stopping} className="relative mt-3 w-full text-xs text-white/60 underline underline-offset-4" onClick={async () => {
            const id = voice.conversationSessionId!
            await voice.stop()
            handVoiceSessionToChat(id)
            voice.setOpen(false)
            navigate(routes.view.allSessions(id))
          }}>Open this conversation in chat · tools, connections and history</button> : null}
          <div className="relative mt-4 flex items-center justify-center gap-2 text-[10px] text-white/24">
            <Volume2 className="h-3 w-3" />
            Voice uses the private HQ manager session. It does not create a second AI brain.
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
