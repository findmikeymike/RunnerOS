import { useEffect, useState } from 'react'
import { ArrowLeft, Captions, CircleCheck, Phone, PhoneOff, Settings2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { ArtistManagerVoiceState } from '@/hooks/useArtistManagerVoice'
import { ArtistManagerVoiceSetup } from './ArtistManagerVoiceSetup'
import { MikeyAvatar } from '@/components/voice/MikeyAvatar'
import { getVoiceCallPresentation } from '@/components/voice/voice-call-readiness'

export function ArtistManagerVoiceDialog({ voice }: { voice: ArtistManagerVoiceState }) {
  const [showSetup, setShowSetup] = useState(false)
  const [showCaptions, setShowCaptions] = useState(false)
  const busy = voice.running || voice.starting || voice.stopping
  useEffect(() => {
    if (!voice.open) { setShowSetup(false); setShowCaptions(false) }
  }, [voice.open])
  const { status, showReady } = getVoiceCallPresentation(voice)
  const callLabel = voice.stopping ? 'Ending call' : voice.starting ? 'Cancel connection' : voice.running ? 'End call' : 'Start call'
  const iconButton = 'inline-flex size-10 items-center justify-center rounded-full bg-white/[0.07] text-white/60 transition-colors hover:bg-white/[0.12] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70'

  return (
    <Dialog open={voice.open} onOpenChange={voice.setOpen}>
      <DialogContent className="flex h-[min(600px,90dvh)] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-3xl border-white/[0.08] bg-[#0a0a0a] p-0 text-white shadow-modal-small sm:max-w-[440px]">
        <header className="relative shrink-0 px-6 pb-3 pt-6 text-center">
          {showSetup ? <button type="button" aria-label="Back to call" onClick={() => setShowSetup(false)} className="absolute left-5 top-5 rounded-full p-2 text-white/60 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70"><ArrowLeft className="size-4" /></button> : null}
          <DialogTitle className="text-sm font-medium tracking-tight">{showSetup ? 'Call settings' : 'Artist Manager'}</DialogTitle>
          <DialogDescription className="sr-only">A voice call with your artist manager. Start or end the call below. Captions and audio settings are optional.</DialogDescription>
          {!showSetup ? <p role="status" aria-live="polite" className="mt-1.5 flex items-center justify-center gap-1.5 text-xs text-white/45">{showReady ? <CircleCheck data-voice-ready aria-hidden="true" className="size-3.5 text-emerald-400" /> : null}{status}</p> : null}
        </header>

        {showSetup ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5"><ArtistManagerVoiceSetup voice={voice} /></div>
        ) : (
          <div data-voice-avatar-stage className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
            <MikeyAvatar active={voice.open} state={voice.avatarState} getPlayback={voice.getAvatarPlayback} />
            {showCaptions && (voice.userText || voice.assistantText) ? (
              <div role="log" aria-label="Call captions" aria-live="polite" className="absolute inset-x-5 bottom-2 max-h-[45%] space-y-2 overflow-y-auto rounded-2xl bg-black/80 px-4 py-3 text-sm leading-5">
                {voice.userText ? <p className="text-white/55"><span className="sr-only">You: </span>{voice.userText}</p> : null}
                {voice.assistantText ? <p className="text-white/90"><span className="sr-only">Manager: </span>{voice.assistantText}</p> : null}
              </div>
            ) : null}
          </div>
        )}

        {voice.error ? <p role="alert" className="mx-5 mb-3 max-h-20 shrink-0 overflow-y-auto rounded-xl bg-red-500/10 px-3 py-2 text-center text-xs leading-5 text-red-200">{voice.error}</p> : null}
        {!busy && !voice.providerReady && !showSetup ? <button type="button" onClick={() => setShowSetup(true)} className="mx-auto mb-3 text-xs text-white/65 underline underline-offset-4">Set up conversation</button> : null}

        <footer className="flex shrink-0 items-center justify-center gap-6 px-6 pb-6 pt-3">
          <button type="button" aria-label={showCaptions ? 'Hide captions' : 'Show captions'} aria-pressed={showCaptions} title="Captions" onClick={() => { setShowCaptions(value => !value); setShowSetup(false) }} className={cn(iconButton, showCaptions && 'bg-white/15 text-white')}><Captions className="size-4" /></button>
          <button type="button" aria-label={callLabel} title={callLabel} onClick={() => { if (!busy) setShowSetup(false); void (busy ? voice.stop() : voice.start()) }} disabled={voice.stopping || (!busy && (!voice.providerReady || voice.installing))} className={cn('inline-flex size-14 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-4 focus-visible:ring-offset-[#0a0a0a] disabled:cursor-not-allowed disabled:opacity-35', busy ? 'bg-red-500 text-white hover:bg-red-400' : 'bg-white text-black hover:bg-white/85')}>
            {busy ? <PhoneOff className="size-5" /> : <Phone className="size-5" />}
          </button>
          <button type="button" aria-label={showSetup ? 'Back to call' : 'Call settings'} aria-pressed={showSetup} title="Call settings" onClick={() => setShowSetup(value => !value)} className={cn(iconButton, showSetup && 'bg-white/15 text-white')}><Settings2 className="size-4" /></button>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
