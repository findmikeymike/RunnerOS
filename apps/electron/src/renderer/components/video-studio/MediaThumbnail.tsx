import * as React from 'react'
import { Film, ImageIcon, Music2, FileText } from 'lucide-react'
import type { VideoMediaAsset } from '@craft-agent/shared/video'

interface Props {
  media: VideoMediaAsset
  loadMedia: (mediaId: string) => Promise<string>
  className?: string
}

// Visible shelves can contain many cards. Bound concurrent IPC reads/decoders.
let activeLoads = 0
const waiting: Array<() => void> = []
function schedule(task: () => Promise<void>) {
  const run = () => {
    activeLoads += 1
    void task().finally(() => {
      activeLoads -= 1
      waiting.shift()?.()
    })
  }
  if (activeLoads < 3) run()
  else waiting.push(run)
  return () => {
    const index = waiting.indexOf(run)
    if (index >= 0) waiting.splice(index, 1)
  }
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Thumbnail cancelled', 'AbortError'))
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

function ready(element: HTMLVideoElement | HTMLImageElement, event: string, check: () => boolean, signal: AbortSignal, checkInitially = true): Promise<void> {
  return new Promise((resolve, reject) => {
    const clean = () => {
      element.removeEventListener(event, done)
      element.removeEventListener('error', fail)
      signal.removeEventListener('abort', fail)
    }
    const done = () => { if (check()) { clean(); resolve() } }
    const fail = () => { clean(); reject(new Error('Thumbnail unavailable')) }
    element.addEventListener(event, done)
    element.addEventListener('error', fail)
    signal.addEventListener('abort', fail, { once: true })
    if (signal.aborted) fail()
    else if (checkInitially) done()
  })
}

/** Small decoded stills only; never starts playback or opens an audio output. */
export function MediaThumbnail({ media, loadMedia, className = '' }: Props) {
  const host = React.useRef<HTMLDivElement>(null)
  const canvas = React.useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = React.useState(false)
  const [loaded, setLoaded] = React.useState(false)

  React.useEffect(() => {
    if (!host.current) return
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '80px' })
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [])

  React.useEffect(() => {
    setLoaded(false)
    if (!visible || !['video', 'image'].includes(media.type)) return
    const controller = new AbortController()
    const { signal } = controller
    const cancelQueued = schedule(async () => {
      if (signal.aborted) return
      const timeout = window.setTimeout(() => controller.abort(), 8_000)
      let dispose = () => {}
      try {
        const url = await abortable(loadMedia(media.id), signal)
        if (signal.aborted) return
        let source: HTMLImageElement | HTMLVideoElement
        let width: number
        let height: number
        if (media.type === 'image') {
          const image = new Image()
          dispose = () => { image.src = '' }
          const loading = ready(image, 'load', () => image.complete && image.naturalWidth > 0, signal)
          image.src = url
          await loading
          source = image
          width = image.naturalWidth
          height = image.naturalHeight
        } else {
          const video = document.createElement('video')
          video.muted = true
          video.volume = 0
          video.preload = 'metadata'
          video.playsInline = true
          dispose = () => { video.pause(); video.removeAttribute('src'); video.load() }
          const metadata = ready(video, 'loadedmetadata', () => video.readyState >= 1, signal)
          video.src = url
          await metadata
          // Seek within the first frame to request decode even with metadata preload.
          const target = Number.isFinite(video.duration) ? Math.min(0.001, video.duration / 2) : 0
          video.preload = 'auto'
          if (target > 0) {
            const seeked = ready(video, 'seeked', () => !video.seeking && Math.abs(video.currentTime - target) < 0.01, signal, false)
            video.currentTime = target
            await seeked
          }
          await ready(video, 'loadeddata', () => video.readyState >= 2, signal)
          source = video
          width = video.videoWidth
          height = video.videoHeight
        }
        if (signal.aborted || !canvas.current || width <= 0 || height <= 0) return
        const scale = Math.min(1, 320 / Math.max(width, height))
        canvas.current.width = Math.max(1, Math.round(width * scale))
        canvas.current.height = Math.max(1, Math.round(height * scale))
        const context = canvas.current.getContext('2d')
        if (!context) return
        context.drawImage(source, 0, 0, canvas.current.width, canvas.current.height)
        setLoaded(true)
      } catch {
        // Broken or unsupported media keeps the type icon; the editor can still open it.
      } finally {
        window.clearTimeout(timeout)
        dispose()
      }
    })
    return () => { controller.abort(); cancelQueued() }
  }, [visible, media.id, media.path, media.type, loadMedia])

  const Icon = media.type === 'audio' ? Music2 : media.type === 'image' ? ImageIcon : media.type === 'caption' ? FileText : Film
  return (
    <div ref={host} aria-hidden="true" className={`relative h-full w-full overflow-hidden bg-[#11151b] ${className}`}>
      <div className={`absolute inset-0 flex items-center justify-center ${media.type === 'audio' ? 'bg-gradient-to-br from-cyan-400/15 via-slate-900 to-indigo-500/15 text-cyan-200/65' : 'text-white/25'}`}>
        <Icon className="h-7 w-7" strokeWidth={1.4} />
      </div>
      <canvas ref={canvas} className={`relative h-full w-full object-cover transition-opacity ${loaded ? 'opacity-100' : 'opacity-0'}`} />
    </div>
  )
}
