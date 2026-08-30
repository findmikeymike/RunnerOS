import { Mic, MicOff, RefreshCw, Volume2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { ArtistManagerVoiceState } from '@/hooks/useArtistManagerVoice'

export function ArtistManagerVoiceDialog({ voice }: { voice: ArtistManagerVoiceState }) {
  return (
    <Dialog open={voice.open} onOpenChange={(open) => {
      voice.setOpen(open)
      if (!open && voice.running) void voice.stop()
    }}>
      <DialogContent className="max-w-[560px] overflow-hidden border-white/[0.09] bg-[#0a0a0a] p-0 text-white shadow-modal-small">
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
              <ProviderState label="Hearing" ready={voice.assemblyAiReady} />
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
                    ? 'Start the conversation, then speak naturally. You can interrupt while the manager is talking.'
                    : 'Voice needs transcription and spoken-voice provider keys in Settings before it can start.'}
                </p>
              </div>
            )}

            {voice.error ? (
              <p className="mt-4 rounded-xl border border-red-400/15 bg-red-500/[0.06] px-3 py-2.5 text-[11px] leading-4 text-red-100/75">
                {voice.error}
              </p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => void (voice.running ? voice.stop() : voice.start())}
            disabled={voice.starting || (!voice.running && !voice.providerReady)}
            className={cn(
              'relative mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-35',
              voice.running
                ? 'border border-white/[0.1] bg-white/[0.045] text-white/80 hover:bg-white/[0.075]'
                : 'bg-[#ff5a0a] text-black hover:bg-[#ff6a1a]',
            )}
          >
            {voice.running ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            {voice.starting ? 'Connecting…' : voice.running ? 'End conversation' : 'Start conversation'}
          </button>

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
