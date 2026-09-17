import * as React from 'react'
import { Loader2, Pause, Play } from 'lucide-react'
import { releaseKitAudioUrl } from '@/lib/release-kit-media'

export function ReleaseKitAudioPlayer({ path, title }: { path?: string; title: string }) {
  if (!path) return <span role="status" className="text-xs text-white/45">Audio unavailable.</span>
  let src: string
  try { src = releaseKitAudioUrl(path) } catch { return <span role="alert" className="text-xs text-amber-200">Audio path is unavailable.</span> }
  return <AudioControls key={src} src={src} title={title} />
}

function time(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
}

function AudioControls({ src, title }: { src: string; title: string }) {
  const ref = React.useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = React.useState(false)
  const [waiting, setWaiting] = React.useState(false)
  const [position, setPosition] = React.useState(0)
  const [duration, setDuration] = React.useState(0)
  const [failed, setFailed] = React.useState(false)
  const progress = duration > 0 ? Math.min(100, position / duration * 100) : 0
  const toggle = async () => {
    const audio = ref.current
    if (!audio) return
    if (!audio.paused) { audio.pause(); return }
    setFailed(false)
    setWaiting(true)
    try {
      if (audio.error) audio.load()
      await audio.play()
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setFailed(true)
    } finally { setWaiting(false) }
  }
  return <div className="w-full min-w-0">
    <audio ref={ref} data-release-kit-audio src={src} preload="metadata" className="hidden"
      onLoadedMetadata={event => setDuration(event.currentTarget.duration)}
      onDurationChange={event => setDuration(event.currentTarget.duration)}
      onTimeUpdate={event => setPosition(event.currentTarget.currentTime)}
      onPlay={event => {
        document.querySelectorAll<HTMLAudioElement>('audio[data-release-kit-audio]').forEach(audio => { if (audio !== event.currentTarget) audio.pause() })
        setPlaying(true)
      }}
      onPlaying={() => setWaiting(false)} onWaiting={() => setWaiting(true)}
      onPause={() => { setPlaying(false); setWaiting(false) }}
      onEnded={() => { setPlaying(false); setWaiting(false) }}
      onError={() => { setFailed(true); setPlaying(false); setWaiting(false) }} />
    <div className="flex h-9 items-center gap-3">
      <button type="button" onClick={() => void toggle()} aria-label={`${playing ? 'Pause' : 'Play'} ${title}`} aria-pressed={playing}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f97316] text-neutral-950 shadow-xs transition-colors hover:bg-[#fb923c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300 focus-visible:ring-offset-2 focus-visible:ring-offset-black">
        {waiting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : playing ? <Pause className="h-3.5 w-3.5 fill-current" /> : <Play className="ml-0.5 h-3.5 w-3.5 fill-current" />}
      </button>
      <input type="range" aria-label={`Seek ${title}`} aria-valuetext={`${time(position)} of ${time(duration)}`}
        min={0} max={Number.isFinite(duration) && duration > 0 ? duration : 0} step={0.1} value={position}
        disabled={!Number.isFinite(duration) || duration <= 0}
        onChange={event => { const next = Number(event.target.value); if (ref.current) ref.current.currentTime = next; setPosition(next) }}
        className="h-6 min-w-6 flex-1 cursor-pointer appearance-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70 disabled:cursor-default [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#f97316]"
        style={{ backgroundImage: `linear-gradient(to right, #f97316 ${progress}%, rgba(255,255,255,0.12) ${progress}%)`, backgroundSize: '100% 3px', backgroundPosition: 'center', backgroundRepeat: 'no-repeat', backgroundColor: 'transparent' }} />
      <span className="shrink-0 text-[10px] tabular-nums text-white/45">{time(position)} <span className="text-white/20">/</span> {time(duration)}</span>
    </div>
    {failed && <p role="alert" className="mt-1 text-xs text-amber-200">Could not play audio. Try again or open the file from Details.</p>}
  </div>
}
