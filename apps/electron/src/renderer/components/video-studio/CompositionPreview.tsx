import * as React from 'react'
import type { RunnerVideoProject } from '@craft-agent/shared/video'
import { buildScenePlan, sceneAtTime, visualGeometry } from '../../../../../../tools/video-studio/lib/scene-plan.mjs'

interface Props {
  project: RunnerVideoProject
  timeMs: number
  loadMedia: (mediaId: string) => Promise<string>
}

const FRAME_TIMEOUT_MS = 10_000
const MAX_ACTIVE_LAYERS = 32

function cancelled() { return new DOMException('Preview superseded', 'AbortError') }

// IPC reads cannot be cancelled, but they must not hold up or overwrite a newer frame.
function interruptible<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(cancelled())
    if (signal.aborted) return abort()
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

function waitForMedia(element: HTMLVideoElement | HTMLImageElement, event: string, ready: () => boolean, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      element.removeEventListener(event, done)
      element.removeEventListener('error', fail)
      signal.removeEventListener('abort', abort)
    }
    const done = () => { if (ready()) { cleanup(); resolve() } }
    const fail = () => { cleanup(); reject(new Error('This media could not be decoded. Render to review it.')) }
    const abort = () => { cleanup(); reject(cancelled()) }
    element.addEventListener(event, done)
    element.addEventListener('error', fail)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    else done()
  })
}

function drawText(context: CanvasRenderingContext2D, text: string, fontSize: number, width: number, height: number, options: { y?: number; centered?: boolean; bottom?: number; boxBorder?: number }) {
  context.font = `${fontSize}px sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'top'
  const lines = text.split('\n')
  const lineHeight = fontSize * 1.2
  const textHeight = lines.length * lineHeight
  const y = options.centered ? (height - textHeight) / 2 : options.bottom !== undefined ? height - textHeight - options.bottom : options.y ?? 0
  if (options.boxBorder !== undefined) {
    const textWidth = Math.max(...lines.map(line => context.measureText(line).width))
    context.fillStyle = 'rgba(0,0,0,0.55)'
    context.fillRect((width - textWidth) / 2 - options.boxBorder, y - options.boxBorder, textWidth + options.boxBorder * 2, textHeight + options.boxBorder * 2)
  }
  context.fillStyle = '#ffffff'
  lines.forEach((line, index) => context.fillText(line, width / 2, y + index * lineHeight))
}

/** Paused, silent composition frames. Export remains the final font/color reference. */
export function CompositionPreview({ project, timeMs, loadMedia }: Props) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const [state, setState] = React.useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = React.useState('')
  const [retry, setRetry] = React.useState(0)
  const urls = React.useMemo(() => new Map<string, Promise<string>>(), [loadMedia])
  const plan = React.useMemo(() => {
    try { return { scene: buildScenePlan(project), error: '' } }
    catch (cause) { return { scene: null, error: cause instanceof Error ? cause.message : 'Invalid composition' } }
  }, [project])

  React.useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const controller = new AbortController()
    const disposers: Array<() => void> = []
    let expired = false
    let active = true
    const timer = window.setTimeout(() => { expired = true; controller.abort() }, FRAME_TIMEOUT_MS)
    const { signal } = controller
    setState('loading')
    setError('')
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    delete canvas.dataset.timeMs

    async function render() {
      const scene = plan.scene
      if (!scene) throw new Error(plan.error)
      if (scene.issues.length) throw new Error(scene.issues.map(issue => issue.message).join(' '))
      if (!Number.isFinite(scene.width) || !Number.isFinite(scene.height) || scene.width <= 0 || scene.height <= 0) throw new Error('Invalid preview dimensions')
      const frame = sceneAtTime(scene, timeMs)
      if (frame.visuals.length > MAX_ACTIVE_LAYERS) throw new Error('More than 32 active layers. Render to review this frame.')
      // Bound the browser bitmap while keeping all coordinates in export space.
      const scale = Math.min(1, 1920 / Math.max(scene.width, scene.height))
      const buffer = document.createElement('canvas')
      buffer.width = Math.max(1, Math.round(scene.width * scale))
      buffer.height = Math.max(1, Math.round(scene.height * scale))
      const context = buffer.getContext('2d')
      if (!context) throw new Error('Canvas preview is unavailable')
      context.scale(scale, scale)
      context.fillStyle = scene.background
      context.fillRect(0, 0, scene.width, scene.height)
      const sources = await Promise.all(frame.visuals.map(async layer => {
        let source = urls.get(layer.media.id)
        if (!source) {
          source = loadMedia(layer.media.id)
          if (urls.size >= MAX_ACTIVE_LAYERS) urls.delete(urls.keys().next().value!)
          urls.set(layer.media.id, source)
          source.catch(() => { if (urls.get(layer.media.id) === source) urls.delete(layer.media.id) })
        }
        const url = await interruptible(source, signal)
        if (signal.aborted) throw cancelled()
        if (layer.media.type === 'image') {
          const image = new Image()
          disposers.push(() => { image.src = '' })
          const loaded = waitForMedia(image, 'load', () => image.complete && image.naturalWidth > 0, signal)
          image.src = url
          await loaded
          return { layer, element: image, width: image.naturalWidth, height: image.naturalHeight }
        }
        const video = document.createElement('video')
        video.muted = true
        video.preload = 'auto'
        video.playsInline = true
        disposers.push(() => { video.pause(); video.removeAttribute('src'); video.load() })
        const metadata = waitForMedia(video, 'loadedmetadata', () => video.readyState >= 1, signal)
        video.src = url
        await metadata
        if (layer.sourceTimeMs / 1000 > video.duration + 0.033) throw new Error(`Source too short: ${layer.media.id}`)
        const target = Math.max(0, Math.min(layer.sourceTimeMs / 1000, Math.max(0, video.duration - 0.001)))
        if (Math.abs(video.currentTime - target) > 0.0001) {
          const seek = waitForMedia(video, 'seeked', () => !video.seeking && Math.abs(video.currentTime - target) < 0.01, signal)
          video.currentTime = target
          await seek
        }
        await waitForMedia(video, 'loadeddata', () => video.readyState >= 2, signal)
        return { layer, element: video, width: video.videoWidth, height: video.videoHeight }
      }))
      if (signal.aborted) throw cancelled()
      for (const { layer, element, width, height } of sources) {
        const geometry = visualGeometry(layer.clip, { ...layer.media, width, height }, scene.width, scene.height, timeMs)
        const crop = geometry.crop ?? { x: 0, y: 0, width, height }
        context.save()
        context.globalAlpha = geometry.opacity
        context.translate(geometry.x, geometry.y)
        context.rotate(geometry.rotateDeg * Math.PI / 180)
        context.drawImage(element, crop.x, crop.y, crop.width, crop.height, -geometry.width / 2, -geometry.height / 2, geometry.width, geometry.height)
        context.restore()
      }
      for (const title of frame.titles) drawText(context, title.text, title.fontSize, scene.width, scene.height, title)
      for (const caption of frame.captions) drawText(context, caption.text, caption.fontSize, scene.width, scene.height, caption)
      if (signal.aborted || !active) return
      canvas!.width = buffer.width
      canvas!.height = buffer.height
      canvas!.getContext('2d')?.drawImage(buffer, 0, 0)
      canvas!.dataset.timeMs = String(timeMs)
      setState('ready')
    }
    void render().catch(cause => {
      if (!active) return
      if (signal.aborted && !expired) return
      setError(expired ? 'Preview timed out. Try again or render to review.' : cause instanceof Error ? cause.message : 'Unable to preview this frame')
      setState('error')
    }).finally(() => {
      window.clearTimeout(timer)
      controller.abort()
      disposers.forEach(dispose => dispose())
    })
    return () => { active = false; controller.abort(); window.clearTimeout(timer); disposers.forEach(dispose => dispose()) }
  }, [plan, timeMs, loadMedia, urls, retry])

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center">
      <canvas ref={canvasRef} aria-label="Composition preview" data-state={state} className="h-full w-full object-contain" />
      {state === 'loading' && <div role="status" className="absolute rounded bg-black/75 px-3 py-2 text-xs text-white/70">Preparing frame…</div>}
      {state === 'error' && <div role="alert" className="absolute max-w-[90%] rounded bg-black/90 p-3 text-center text-xs text-white/80">{error}<button type="button" onClick={() => { urls.clear(); setRetry(value => value + 1) }} className="ml-2 underline">Retry preview</button></div>}
      {state === 'ready' && <div className="absolute bottom-1 rounded bg-black/75 px-2 py-1 text-[10px] text-white/60">Silent scrub preview · render for final fonts and color</div>}
    </div>
  )
}
