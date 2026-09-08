interface VoiceCallReadiness {
  open: boolean
  prepared: boolean
  preparing: boolean
  running: boolean
  starting: boolean
  stopping: boolean
  installing: boolean
  providerReady: boolean
  error: string | null
  status: string
}

/** Prepared means local speech/session warmup finished, not guaranteed provider response latency. */
export function getVoiceCallPresentation(voice: VoiceCallReadiness) {
  const showReady = voice.open && voice.prepared && voice.providerReady
    && !voice.preparing && !voice.running && !voice.starting && !voice.stopping
    && !voice.installing && !voice.error
  const status = voice.stopping ? 'Ending call…' : voice.error ? 'Connection needs attention'
    : voice.starting ? 'Connecting…' : voice.installing ? 'Preparing audio…'
    : voice.preparing ? 'Warming up…'
    : voice.running ? (voice.status === 'Working…' ? 'One moment…' : voice.status)
    : showReady ? 'Ready when you are'
    : voice.providerReady ? 'Ready to connect' : 'Set up your conversation'
  return { status, showReady }
}
