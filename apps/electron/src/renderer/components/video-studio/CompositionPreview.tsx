import * as React from 'react'
import { createColorPreview } from './color-preview'
import { buildColorLut } from '../../../../../../tools/video-studio/lib/color-pipeline.mjs'
import { Volume2, VolumeX } from 'lucide-react'
import type { RunnerVideoProject } from '@craft-agent/shared/video'
import { buildScenePlan, sceneAtTime, visualGeometry, clipSpeed, audioGainAtTime } from '../../../../../../tools/video-studio/lib/scene-plan.mjs'

interface Props {
  project: RunnerVideoProject
  timeMs: number
  playing: boolean
  onTimeChange: (timeMs: number) => void
  onPlaybackStop: () => void
  loadMedia: (mediaId: string) => Promise<string>
  loadMediaInfo: (mediaId: string) => Promise<{ hasAudio: boolean }>
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

function waitForMedia(element: HTMLVideoElement | HTMLImageElement, event: string, ready: () => boolean, signal: AbortSignal, checkInitial = true): Promise<void> {
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
    else if (checkInitial) done()
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

/** Composition playback with opt-in audio. Rendered view remains the final reference. */
export function CompositionPreview({ project, timeMs, playing, onTimeChange, onPlaybackStop, loadMedia, loadMediaInfo }: Props) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const [state, setState] = React.useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = React.useState('')
  const [retry, setRetry] = React.useState(0)
  const callbacks = React.useRef({ onTimeChange, onPlaybackStop })
  callbacks.current = { onTimeChange, onPlaybackStop }
  const initialized = React.useRef(false)
  const audioContextRef = React.useRef<AudioContext | null>(null)
  const masterGainRef = React.useRef<GainNode | null>(null)
  const soundEnabledRef = React.useRef(false)
  const soundRequest = React.useRef(0)
  const [soundEnabled, setSoundEnabled] = React.useState(false)
  const [soundError, setSoundError] = React.useState('')
  const silence = React.useCallback(() => {
    const gain = masterGainRef.current
    const context = audioContextRef.current
    if (gain && context) { gain.gain.cancelScheduledValues(context.currentTime); gain.gain.setValueAtTime(0, context.currentTime) }
  }, [])
  const toggleSound = () => {
    const request = ++soundRequest.current
    if (soundEnabledRef.current) {
      soundEnabledRef.current = false
      setSoundEnabled(false)
      silence()
      return
    }
    try {
      let context = audioContextRef.current
      if (!context) {
        context = new AudioContext()
        audioContextRef.current = context
        context.addEventListener('statechange', () => {
          if (audioContextRef.current === context && context?.state !== 'running' && soundEnabledRef.current) {
            soundEnabledRef.current = false
            setSoundEnabled(false)
            silence()
            setSoundError('Preview sound was suspended. Enable sound to resume.')
          }
        })
        const master = context.createGain()
        master.gain.value = 0
        master.connect(context.destination)
        masterGainRef.current = master
      }
      // resume() is invoked synchronously in the click handler, before any IPC.
      void context.resume().then(() => {
        if (audioContextRef.current !== context || request !== soundRequest.current) return
        soundEnabledRef.current = true
        setSoundEnabled(true)
        setSoundError('')
      }, cause => { if (request === soundRequest.current) setSoundError(cause instanceof Error ? cause.message : 'Unable to enable preview sound') })
    } catch (cause) { setSoundError(cause instanceof Error ? cause.message : 'Preview sound is unavailable') }
  }
  React.useEffect(() => () => {
    soundRequest.current += 1
    silence()
    const context = audioContextRef.current
    audioContextRef.current = null
    masterGainRef.current = null
    void context?.close()
  }, [silence])
  const command = React.useRef<(time: number, play: boolean) => void>(() => {})
  const currentProps = React.useRef({ timeMs, playing })
  currentProps.current = { timeMs, playing }
  const plan = React.useMemo(() => {
    try { return { scene: buildScenePlan(project), error: '' } }
    catch (cause) { return { scene: null, error: cause instanceof Error ? cause.message : 'Invalid composition' } }
  }, [project])

  React.useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    type Decoder = { element: HTMLVideoElement | HTMLImageElement; width: number; height: number; dispose: () => void; sourceNode?: MediaElementAudioSourceNode; gainNode?: GainNode }
    const decoders = new Map<string, Promise<Decoder>>()
    const decoderCancels = new Map<string, () => void>()
    const disposers = new Set<() => void>()
    const pendingPlay = new Set<HTMLVideoElement>()
    const lifecycle = new AbortController()
    let frameController: AbortController | null = null
    let frameId = 0
    let generation = 0
    let position = currentProps.current.timeMs
    let running = currentProps.current.playing
    if (initialized.current && running) { running = false; callbacks.current.onPlaybackStop() }
    initialized.current = true
    if (running && position >= (plan.scene?.durationMs ?? Infinity)) position = 0
    let lastReported: number | null = null
    let lastClock = performance.now()
    let drawing = false
    let pending = false
    let stopped = false
    const urls = new Map<string, Promise<string>>()
    const audioInfo = new Map<string, Promise<{ hasAudio: boolean }>>()
    const buffer = document.createElement('canvas')
    let colorPreview: ReturnType<typeof createColorPreview> | null = null
    disposers.add(() => colorPreview?.dispose())
    const colorLuts = new Map<string, ReturnType<typeof buildColorLut>>()

    const pauseDecoders = (force = true) => {
      silence()
      for (const decoder of decoders.values()) void decoder.then(({ element }) => {
        if (element instanceof HTMLVideoElement && (force || !pendingPlay.has(element))) element.pause()
      }, () => {})
    }
    const clearFrame = () => {
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
      delete canvas.dataset.timeMs
      setState('loading')
      setError('')
    }
    const stop = () => {
      running = false
      pauseDecoders()
      if (!stopped) { stopped = true; callbacks.current.onPlaybackStop() }
    }
    async function decoderFor(layer: { clip: ReturnType<typeof sceneAtTime>['visuals'][number]['clip']; media: ReturnType<typeof sceneAtTime>['visuals'][number]['media'] }, signal: AbortSignal): Promise<Decoder> {
      let decoder = decoders.get(layer.clip.id)
      if (!decoder) {
        silence()
        const decodeController = new AbortController()
        const abortDecode = () => decodeController.abort()
        lifecycle.signal.addEventListener('abort', abortDecode, { once: true })
        let disposeElement = () => {}
        const cancelDecoder = () => {
          decodeController.abort()
          lifecycle.signal.removeEventListener('abort', abortDecode)
          disposeElement()
          disposers.delete(disposeElement)
        }
        decoderCancels.set(layer.clip.id, cancelDecoder)
        decoder = (async () => {
          let source = urls.get(layer.media.id)
          if (!source) {
            source = loadMedia(layer.media.id)
            if (urls.size >= MAX_ACTIVE_LAYERS) urls.delete(urls.keys().next().value!)
            urls.set(layer.media.id, source)
          }
          const url = await interruptible(source, decodeController.signal)
          if (decodeController.signal.aborted) throw cancelled()
          if (layer.media.type === 'image') {
            const image = new Image()
            const dispose = () => { image.src = '' }
            disposeElement = dispose
            disposers.add(dispose)
            const loaded = waitForMedia(image, 'load', () => image.complete && image.naturalWidth > 0, decodeController.signal)
            image.src = url
            await loaded
            return { element: image, width: image.naturalWidth, height: image.naturalHeight, dispose }
          }
          const video = document.createElement('video')
          video.muted = true
          video.preload = 'auto'
          video.playsInline = true
          let result: Decoder | undefined
          const dispose = () => {
            video.muted = true
            video.pause()
            result?.gainNode?.disconnect()
            result?.sourceNode?.disconnect()
            video.removeAttribute('src')
            video.load()
          }
          disposeElement = dispose
          disposers.add(dispose)
          const metadata = waitForMedia(video, 'loadedmetadata', () => video.readyState >= 1, decodeController.signal)
          video.src = url
          await metadata
          result = { element: video, width: video.videoWidth, height: video.videoHeight, dispose }
          return result
        })()
        decoders.set(layer.clip.id, decoder)
      }
      return interruptible(decoder, signal)
    }
    async function draw(nextTime: number, forceSeek: boolean) {
      const scene = plan.scene
      if (!scene) throw new Error(plan.error)
      if (scene.issues.length) throw new Error(scene.issues.map(issue => issue.message).join(' '))
      if (!Number.isFinite(scene.width) || !Number.isFinite(scene.height) || scene.width <= 0 || scene.height <= 0) throw new Error('Invalid preview dimensions')
      const frame = sceneAtTime(scene, nextTime)
      if (frame.visuals.length > MAX_ACTIVE_LAYERS) throw new Error('More than 32 active layers. Render to review this frame.')
      const activeIds = new Set([...frame.visuals, ...(soundEnabledRef.current ? frame.audio : [])].map(layer => layer.clip.id))
      // Keep only active decoders: a long timeline must not retain every decoded source.
      for (const [id, decoder] of decoders) if (!activeIds.has(id)) {
        decoders.delete(id)
        decoderCancels.get(id)?.()
        decoderCancels.delete(id)
        void decoder.then(value => { value.dispose(); disposers.delete(value.dispose) }, () => {})
      }
      const controller = new AbortController()
      frameController = controller
      let expired = false
      const timer = window.setTimeout(() => { expired = true; controller.abort() }, FRAME_TIMEOUT_MS)
      const { signal } = controller
      try {
        const provenAudio = new Set<string>()
        if (soundEnabledRef.current) {
          await Promise.all(scene.audio.map(async layer => {
            let info = audioInfo.get(layer.media.id)
            if (!info) { info = loadMediaInfo(layer.media.id); audioInfo.set(layer.media.id, info) }
            if ((await interruptible(info, signal)).hasAudio) provenAudio.add(layer.clip.id)
          }))
        }
        const audioLayers = soundEnabledRef.current ? frame.audio.filter(layer => provenAudio.has(layer.clip.id)) : []
        const allLayers = [...frame.visuals, ...audioLayers.filter(layer => !frame.visuals.some(visual => visual.clip.id === layer.clip.id))]
        if (allLayers.length > MAX_ACTIVE_LAYERS) throw new Error('More than 32 active media layers. Render to review this frame.')
        const sources = await Promise.all(allLayers.map(async layer => {
          const decoder = await decoderFor(layer, signal)
          const video = decoder.element
          if (video instanceof HTMLVideoElement) {
            if (layer.sourceTimeMs / 1000 > video.duration + 0.033) throw new Error(`Source too short: ${layer.media.id}`)
            const target = Math.max(0, Math.min(layer.sourceTimeMs / 1000, Math.max(0, video.duration - 0.001)))
            if (forceSeek || Math.abs(video.currentTime - target) > 0.1 || video.readyState < 2) {
              silence()
              video.pause()
              if (Math.abs(video.currentTime - target) > 0.0001 || video.seeking) {
                // Tiny seeks can satisfy the tolerance before assignment; wait for the new seek event.
                const seek = waitForMedia(video, 'seeked', () => !video.seeking && Math.abs(video.currentTime - target) < 0.01, signal, false)
                video.currentTime = target
                await seek
              }
              await waitForMedia(video, 'loadeddata', () => video.readyState >= 2, signal)
            }
            if (audioLayers.some(audio => audio.clip.id === layer.clip.id) && video.readyState < 3) {
              silence()
              await waitForMedia(video, 'canplay', () => video.readyState >= 3, signal)
            }
            video.playbackRate = clipSpeed(layer.clip)
          }
          return { layer, decoder, ...decoder }
        }))
        if (signal.aborted || lifecycle.signal.aborted) throw cancelled()
        const scale = Math.min(1, 1920 / Math.max(scene.width, scene.height))
        buffer.width = Math.max(1, Math.round(scene.width * scale))
        buffer.height = Math.max(1, Math.round(scene.height * scale))
        const context = buffer.getContext('2d')
        if (!context) throw new Error('Canvas preview is unavailable')
        context.scale(scale, scale)
        context.fillStyle = scene.background
        context.fillRect(0, 0, scene.width, scene.height)
        for (const { layer, element, width, height } of sources) {
          if (layer.media.type === 'audio') continue
          const geometry = visualGeometry(layer.clip, { ...layer.media, width, height }, scene.width, scene.height, nextTime)
          const crop = geometry.crop ?? { x: 0, y: 0, width, height }
          context.save()
          context.globalAlpha = geometry.opacity
          context.translate(geometry.x, geometry.y)
          context.rotate(geometry.rotateDeg * Math.PI / 180)
          if (!colorLuts.has(layer.clip.id)) colorLuts.set(layer.clip.id, buildColorLut(layer.clip.adjustments))
          const lut = colorLuts.get(layer.clip.id)
          if (lut) {
            colorPreview ??= createColorPreview()
            const colored = colorPreview.draw(element, crop, Math.min(1920, geometry.width * scale), Math.min(1920, geometry.height * scale), lut)
            context.drawImage(colored, -geometry.width / 2, -geometry.height / 2, geometry.width, geometry.height)
          } else {
            context.drawImage(element, crop.x, crop.y, crop.width, crop.height, -geometry.width / 2, -geometry.height / 2, geometry.width, geometry.height)
          }
          context.restore()
        }
        for (const title of frame.titles) drawText(context, title.text, title.fontSize, scene.width, scene.height, title)
        for (const caption of frame.captions) drawText(context, caption.text, caption.fontSize, scene.width, scene.height, caption)
        for (const { layer, element, decoder } of sources) if (element instanceof HTMLVideoElement) {
          const audioLayer = audioLayers.find(audio => audio.clip.id === layer.clip.id)
          const audioContext = audioContextRef.current
          if (audioLayer && audioContext && masterGainRef.current) {
            if (!decoder.sourceNode) {
              decoder.sourceNode = audioContext.createMediaElementSource(element)
              decoder.gainNode = audioContext.createGain()
              decoder.gainNode.gain.value = 0
              decoder.sourceNode.connect(decoder.gainNode)
              decoder.gainNode.connect(masterGainRef.current)
              // The source node now routes the element exclusively through our graph.
              element.muted = false
              element.volume = 1
            }
            const gain = decoder.gainNode!.gain
            gain.cancelScheduledValues(audioContext.currentTime)
            gain.setValueAtTime(audioGainAtTime(scene, audioLayer, nextTime, provenAudio), audioContext.currentTime)
            const horizonMs = Math.min(20, Math.max(0, audioLayer.endMs - nextTime))
            gain.linearRampToValueAtTime(audioGainAtTime(scene, audioLayer, nextTime + horizonMs, provenAudio), audioContext.currentTime + horizonMs / 1000)
            // Even if rendering stalls, a decoder cannot sound beyond this clip.
            gain.setValueAtTime(0, audioContext.currentTime + Math.max(0, audioLayer.endMs - nextTime) / 1000)
          } else if (decoder.gainNode && audioContext) decoder.gainNode.gain.setValueAtTime(0, audioContext.currentTime)
          else element.muted = true
          if (running && !element.ended && element.paused) {
            silence()
            pendingPlay.add(element)
            try { await interruptible(element.play(), signal) }
            finally { pendingPlay.delete(element) }
          } else if (!running) element.pause()
        }
        if (signal.aborted || lifecycle.signal.aborted) throw cancelled()
        canvas!.width = buffer.width
        canvas!.height = buffer.height
        canvas!.getContext('2d')?.drawImage(buffer, 0, 0)
        canvas!.dataset.timeMs = String(nextTime)
        setState('ready')
        const audioContext = audioContextRef.current
        if (running && soundEnabledRef.current && audioContext?.state === 'running' && masterGainRef.current) {
          masterGainRef.current.gain.setValueAtTime(1, audioContext.currentTime)
        } else silence()
      } catch (cause) {
        if (expired) throw new Error('Preview timed out. Try again or render to review.')
        throw cause
      } finally { window.clearTimeout(timer); if (frameController === controller) frameController = null }
    }
    async function tick(forceSeek = false) {
      if (lifecycle.signal.aborted) return
      if (drawing) { pending = true; return }
      drawing = true
      const ticket = generation
      const now = performance.now()
      const next = Math.min(plan.scene?.durationMs ?? position, Math.max(0, position + (running && !forceSeek ? now - lastClock : 0)))
      // A visible loading state is delayed for ordinary decoded frames, immediate for user seeks.
      let stalled = false
      const loadingTimer = window.setTimeout(() => { if (ticket === generation) { stalled = true; clearFrame(); pauseDecoders(false) } }, 100)
      try {
        await draw(next, forceSeek)
        if (ticket !== generation || lifecycle.signal.aborted) return
        position = next
        lastClock = stalled ? performance.now() : now // Preserve normal draw time; exclude actual buffering.
        if (running) {
          lastReported = position
          callbacks.current.onTimeChange(position)
          if (position >= (plan.scene?.durationMs ?? 0)) stop()
        }
      } catch (cause) {
        if (ticket !== generation || lifecycle.signal.aborted) return
        clearFrame()
        setError(cause instanceof Error ? cause.message : 'Unable to preview this frame')
        setState('error')
        stop()
      } finally {
        window.clearTimeout(loadingTimer)
        drawing = false
        if (!lifecycle.signal.aborted && (pending || running)) {
          const seek = pending
          pending = false
          frameId = requestAnimationFrame(() => { void tick(seek) })
        }
      }
    }
    command.current = (next, play) => {
      const echoed = next === lastReported
      const seek = !echoed && next !== position
      const changed = play !== running
      if (!seek && !changed) return
      if (seek) position = next
      if (play && !running && position >= (plan.scene?.durationMs ?? Infinity)) position = 0
      running = play
      if (play) stopped = false
      generation += 1
      frameController?.abort()
      cancelAnimationFrame(frameId)
      lastClock = performance.now()
      pauseDecoders()
      clearFrame()
      void tick(true)
    }
    const onVisibilityChange = () => {
      if (!document.hidden) {
        // A hidden-tab abort can interrupt a cleared loading frame. Restore the
        // paused frame when visible again without restarting the transport.
        lastClock = performance.now()
        void tick(true)
        return
      }
      if (!running) return
      generation += 1
      frameController?.abort()
      cancelAnimationFrame(frameId)
      pending = false
      stop()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    clearFrame()
    void tick(true)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      silence()
      lifecycle.abort()
      frameController?.abort()
      cancelAnimationFrame(frameId)
      command.current = () => {}
      disposers.forEach(dispose => dispose())
      decoderCancels.forEach(cancel => cancel())
      decoderCancels.clear()
      decoders.clear()
      urls.clear()
    }
  }, [plan, loadMedia, loadMediaInfo, retry, silence])

  React.useLayoutEffect(() => { command.current(timeMs, playing) }, [timeMs, playing])

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col items-center justify-center gap-3">
      <div className="relative flex min-h-0 w-full flex-1 items-center justify-center">
        <canvas ref={canvasRef} aria-label="Composition preview" data-state={state} className="absolute inset-0 h-full w-full object-contain" />
        {state === 'loading' && <div role="status" className="absolute rounded-xl bg-black/70 px-4 py-2 text-xs text-white/70 backdrop-blur-xl">Preparing frame…</div>}
        {state === 'error' && <div role="alert" className="absolute max-w-[90%] rounded-xl bg-black/85 p-4 text-center text-xs leading-relaxed text-white/80">{error}<button type="button" onClick={() => setRetry(value => value + 1)} className="ml-2 underline underline-offset-4">Retry preview</button></div>}
      </div>
      <div className="flex h-8 shrink-0 items-center justify-center">
        <button type="button" onClick={toggleSound} title="Preview audio. Render for final output quality." className="inline-flex h-8 items-center gap-2 rounded-full bg-white/[0.06] px-3.5 text-[11px] font-medium text-white/65 transition-colors hover:bg-white/[0.1] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300">
          {soundEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
          {soundEnabled ? 'Mute preview' : 'Enable sound'}
        </button>
      </div>
      {soundError && <div role="alert" className="absolute bottom-11 z-10 max-w-[90%] rounded-xl bg-black/90 p-3 text-xs text-white/80">{soundError}</div>}
    </div>
  )
}
