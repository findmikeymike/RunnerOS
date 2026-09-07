import * as React from 'react'
import { Headphones, Loader2, FileText, X } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { isFinalSignalReport, parseSignalBriefing } from '@craft-agent/shared/shared-intel'

interface Props {
  workspaceId: string
  output: Parameters<typeof isFinalSignalReport>[0] & { id: string }
  content: string
}

export function SignalBriefingPlayer({ workspaceId, output, content }: Props) {
  const briefing = parseSignalBriefing(content)
  if (!isFinalSignalReport(output) || !briefing) return null
  // Remount on report/voice text changes so pending responses cannot play another report.
  return <BriefingPlayer key={`${workspaceId}:${output.id}:${content}`} workspaceId={workspaceId} outputId={output.id} briefing={briefing} />
}

export function BriefingPlayer({ workspaceId, outputId, briefing }: { workspaceId: string; outputId: string; briefing: string }) {
  const [expanded, setExpanded] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [audioUrl, setAudioUrl] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [speed, setSpeed] = React.useState(1)
  const audioRef = React.useRef<HTMLAudioElement | null>(null)
  const attachAudio = React.useCallback((element: HTMLAudioElement | null) => {
    if (audioRef.current && audioRef.current !== element) audioRef.current.pause()
    audioRef.current = element
  }, [])
  const request = React.useRef(0)
  const pending = React.useRef(false)
  const textId = React.useId()

  React.useEffect(() => () => {
    request.current += 1
    audioRef.current?.pause()
  }, [])

  async function listen() {
    if (pending.current) return
    pending.current = true
    const generation = ++request.current
    setBusy(true)
    setError(null)
    try {
      const result = await window.electronAPI.readSignalBriefingAudio(workspaceId, outputId, briefing)
      if (generation !== request.current) return
      setAudioUrl(result.audioDataUrl)
    } catch (err) {
      if (generation !== request.current) return
      setError(err instanceof Error ? err.message : 'Could not prepare the briefing. Try again.')
    } finally {
      if (generation === request.current) {
        pending.current = false
        setBusy(false)
      }
    }
  }

  function close() {
    request.current += 1
    pending.current = false
    audioRef.current?.pause()
    setAudioUrl(null)
    setBusy(false)
    setError(null)
  }

  return (
    <section aria-label="Your Briefing" className="border-b border-white/[0.055] px-5 py-3 text-xs text-white/70">
      <div className="flex flex-wrap items-center gap-2">
        {!audioUrl ? (
          <button type="button" onClick={() => { void listen() }} disabled={busy}
            className="inline-flex h-8 items-center gap-2 rounded-md bg-white/[0.065] px-3 font-medium text-white/90 hover:bg-white/10 disabled:opacity-60">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Headphones className="h-3.5 w-3.5" />}
            {busy ? 'Preparing audio' : 'Listen'}
            {!busy && <span className="font-normal text-white/40">~1 min</span>}
          </button>
        ) : (
          <>
            <audio ref={attachAudio} src={audioUrl} controls autoPlay preload="auto" aria-label="Briefing audio"
              className="h-9 w-full min-w-0 max-w-[380px]" style={{ colorScheme: 'dark' }}
              onLoadedMetadata={() => { if (audioRef.current) audioRef.current.playbackRate = speed }}
              onError={() => { setAudioUrl(null); setError('Audio could not be played. Try again.') }} />
            <select aria-label="Playback speed" value={speed}
              onChange={(event) => { const value = Number(event.target.value); setSpeed(value); if (audioRef.current) audioRef.current.playbackRate = value }}
              className="h-8 rounded-md border border-white/10 bg-[#17181b] px-2 text-xs text-white/80">
              {[0.75, 1, 1.25, 1.5, 2].map(value => <option key={value} value={value}>{value}x</option>)}
            </select>
          </>
        )}
        <Tooltip><TooltipTrigger asChild>
          <button type="button" aria-label="Read briefing" aria-expanded={expanded} aria-controls={textId}
            onClick={() => setExpanded(!expanded)} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-white/60 hover:bg-white/[0.06] hover:text-white">
            <FileText className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger><TooltipContent>Read briefing</TooltipContent></Tooltip>
        {(busy || audioUrl) && <Tooltip><TooltipTrigger asChild>
          <button type="button" aria-label="Close briefing audio" onClick={close}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-white/50 hover:bg-white/[0.06] hover:text-white">
            <X className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger><TooltipContent>Close audio</TooltipContent></Tooltip>}
      </div>
      {error && <p role="alert" className="mt-2 max-w-2xl text-xs leading-5 text-red-300">{error}</p>}
      {expanded && <p id={textId} className="mt-3 max-w-3xl whitespace-pre-line text-sm leading-6 text-white/75">{briefing}</p>}
    </section>
  )
}
