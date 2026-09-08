import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import assetUrl from './assets/mikey.glb?url'
import { bindAvatar } from './bind-avatar.mjs'
import { disposeAvatarModel } from './resources'
import { sampleMikeyPose } from './pose'
import type { AvatarPlayback, MikeyAvatarState } from './pose'

interface AvatarInputs { active: boolean; state: MikeyAvatarState; getPlayback: () => AvatarPlayback }

export function mountMikeyAvatar(canvas: HTMLCanvasElement, inputs: () => AvatarInputs, onReady: (ready: boolean) => void): () => void {
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' })
  } catch { onReady(false); return () => {} }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.58
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 20)
  scene.add(new THREE.HemisphereLight(0xf4eee6, 0x555a67, 1.05))
  const key = new THREE.DirectionalLight(0xffeee0, 1.85)
  key.position.set(2, 3, 4); scene.add(key)
  const fill = new THREE.DirectionalLight(0xdce8ff, 0.65)
  fill.position.set(-3, 1, 2); scene.add(fill)
  const rim = new THREE.DirectionalLight(0xffdfb8, 0.6)
  rim.position.set(1, 2, -2); scene.add(rim)
  const abort = new AbortController()
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  let disposed = false
  let model: THREE.Object3D | undefined
  let rig: ReturnType<typeof bindAvatar> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let animation = 0
  let renderable = false
  const rest = new THREE.Euler()

  function stopFrames() {
    clearTimeout(timer); timer = undefined
    cancelAnimationFrame(animation); animation = 0
  }

  function schedule() {
    if (disposed || document.hidden || !renderable || !model || !inputs().active) return
    // At most 30 rendered frames/sec; reduced motion also lowers the render rate.
    timer = setTimeout(() => { animation = requestAnimationFrame(draw) }, motion.matches ? 100 : 1000 / 30)
  }

  function draw(_frameTime: number) {
    animation = 0; timer = undefined
    if (disposed || !model || !rig || document.hidden || !renderable) return
    try {
      const props = inputs()
      if (!props.active) { rig.reset(); renderer.render(scene, camera); return }
      const playback = props.getPlayback()
      const pose = sampleMikeyPose(props.state, playback, performance.now(), motion.matches)
      rig.apply(pose)
      model.rotation.set(rest.x, rest.y + pose.turn, rest.z + pose.tilt, rest.order)
      renderer.render(scene, camera)
      schedule()
    } catch { onReady(false); dispose() }
  }

  function resize() {
    if (disposed) return
    const { width, height } = canvas.getBoundingClientRect()
    renderable = width > 0 && height > 0
    stopFrames()
    if (!renderable) return
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    if (model) {
      model.rotation.copy(rest)
      const bounds = new THREE.Box3().setFromObject(model)
      const size = bounds.getSize(new THREE.Vector3())
      const center = bounds.getCenter(new THREE.Vector3())
      // Same measured bust framing as the supplied rig review, fitted on resize.
      const target = new THREE.Vector3(center.x, bounds.max.y - size.y * 0.34, center.z)
      const framedHeight = Math.max(size.y * 0.72, size.x * 0.9 / camera.aspect)
      const distance = framedHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) + size.z * 0.5
      camera.position.copy(target).add(new THREE.Vector3(0, 0, distance))
      camera.lookAt(target)
    }
    camera.updateProjectionMatrix()
    draw(performance.now())
  }

  function visibilityChanged() {
    stopFrames()
    rig?.reset()
    if (!document.hidden) draw(performance.now())
  }
  function contextLost(event: Event) {
    event.preventDefault()
    onReady(false)
    dispose()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  document.addEventListener('visibilitychange', visibilityChanged)
  canvas.addEventListener('webglcontextlost', contextLost)
  motion.addEventListener('change', visibilityChanged)

  function dispose() {
    if (disposed) return
    disposed = true
    abort.abort(); stopFrames(); observer.disconnect()
    document.removeEventListener('visibilitychange', visibilityChanged)
    canvas.removeEventListener('webglcontextlost', contextLost)
    motion.removeEventListener('change', visibilityChanged)
    rig?.dispose()
    if (model) { scene.remove(model); disposeAvatarModel(model); model = undefined }
    renderer.dispose()
    renderer.forceContextLoss()
  }

  void (async () => {
    const response = await fetch(assetUrl, { signal: abort.signal })
    if (!response.ok) throw new Error('Avatar asset unavailable')
    const bytes = await response.arrayBuffer()
    if (disposed) return
    const gltf = await new GLTFLoader().parseAsync(bytes, '')
    if (disposed) { disposeAvatarModel(gltf.scene); return }
    model = gltf.scene
    rest.copy(model.rotation)
    rig = bindAvatar(model)
    scene.add(model)
    resize()
    if (!disposed) onReady(true)
  })().catch(() => {
    if (!disposed) { onReady(false); dispose() }
  })
  return dispose
}
