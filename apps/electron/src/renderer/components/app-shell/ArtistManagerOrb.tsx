import * as React from 'react'
import { motion, useReducedMotion } from 'motion/react'
import './artist-manager-orb.css'

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

// A small, self-contained light field. No textures, network requests, or audio input.
const fragmentShader = `
  precision highp float;
  varying vec2 vUv;
  uniform float time;
  uniform float attention;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    float a = atan(p.y, p.x);
    float t = time * 0.85;
    // The silhouette is always a true circle; only light moves inside and around it.
    float radius = 0.69;
    float pulse = 0.5 + 0.5 * sin(time * 1.6);
    float warmth = 0.5 + 0.5 * sin(a * 2.0 + sin(a - t) * 0.5 - t);
    float shift = 0.5 + 0.5 * sin(t * 0.9 + a * 2.0);
    vec3 silver = vec3(0.94, 0.93, 0.91);
    vec3 ember = mix(vec3(1.0, 0.10, 0.02), vec3(1.0, 0.36, 0.04), shift);
    vec3 lightColor = mix(silver, ember, smoothstep(0.18, 0.88, warmth));
    float distanceToRing = r - radius;
    float rim = exp(-pow(distanceToRing / 0.009, 2.0)) * (0.52 + attention * 0.10);
    float halo = exp(-pow(distanceToRing / 0.055, 2.0)) * 0.11;
    float outside = smoothstep(radius - 0.005, radius + 0.015, r);
    float aura = exp(-pow(distanceToRing / (0.09 + pulse * 0.04), 2.0))
      * outside * (0.08 + pulse * 0.08);
    vec3 color = lightColor * (rim + halo + aura);
    float alpha = rim + halo + aura;
    // Diffuse overlapping fields carry mist inward and fill the center softly.
    float flowEnvelope = smoothstep(0.10, 0.24, r) * (1.0 - smoothstep(0.32, 0.97, r));
    float phase = a * 2.0 + r * 12.0 + time * 1.4
      + sin(a * 3.0 - t * 0.6 + r * 5.0) * 0.65;
    float curl = 0.5 + 0.5 * cos(phase);
    float mist = pow(curl, 1.5);
    float veil = 0.5 + 0.5 * cos(a * 3.0 + r * 9.0 + time * 1.1);
    float wave = 0.7 + 0.3 * sin(r * 10.0 + time * 1.4);
    float flowLight = (mist * 0.17 + veil * 0.05) * flowEnvelope * wave;
    float innerShift = 0.5 + 0.5 * sin(a + r * 7.0 - t * 0.7);
    float innerWarmth = 0.5 + 0.5 * sin(a * 2.0 + r * 10.0 + time * 1.15
      + sin(a * 3.0 - r * 6.0 - t * 0.6) * 0.65);
    vec3 innerEmber = mix(vec3(1.0, 0.08, 0.015), vec3(1.0, 0.36, 0.035), innerShift);
    vec3 mistColor = mix(innerEmber, silver, 0.08 + (1.0 - innerWarmth) * 0.16);
    float centerEnvelope = 1.0 - smoothstep(0.24, 0.72, r);
    float centerMotion = mix(0.45, mist * 0.65 + veil * 0.35, smoothstep(0.04, 0.22, r));
    float whiteMist = mist * veil * flowEnvelope * 0.065
      + centerEnvelope * (0.025 + centerMotion * 0.075);
    color += (mistColor * flowLight + silver * whiteMist) * 0.70;
    alpha += (flowLight + whiteMist) * 0.70;
    float inside = 1.0 - smoothstep(0.55, radius, r);
    color += vec3(0.014) * inside;
    alpha = max(alpha, inside * 0.15);
    float fade = 1.0 - smoothstep(0.86, 0.99, r);
    color *= fade;
    alpha = clamp(alpha * fade, 0.0, 1.0);
    gl_FragColor = vec4(color / max(alpha, 0.001), alpha);
  }
`

export function ArtistManagerOrb({ onOpen }: { onOpen: () => void }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const attentionRef = React.useRef(false)
  const [ready, setReady] = React.useState(false)
  const reduceMotion = useReducedMotion()

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let disposed = false
    let release: (() => void) | undefined
    setReady(false)
    void import('three').then(THREE => {
      if (disposed) return
      let renderer: InstanceType<typeof THREE.WebGLRenderer>
      try {
        renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' })
      } catch {
        return // The CSS ring remains a usable, fully labeled button without WebGL.
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
      const uniforms = { time: { value: 0 }, attention: { value: 0 } }
      const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, transparent: true, depthTest: false })
      const geometry = new THREE.PlaneGeometry(2, 2)
      const scene = new THREE.Scene()
      scene.add(new THREE.Mesh(geometry, material))
      const camera = new THREE.Camera()
      let frame = 0
      let previous = 0
      let visible = true
      let lost = false
      const paint = () => renderer.render(scene, camera)
      const tick = (now: number) => {
        frame = 0
        if (disposed || lost || !visible || document.hidden) return
        if (now - previous >= 1000 / 30) {
          const delta = Math.min((now - previous) / 1000, 0.1)
          uniforms.time.value += delta
          uniforms.attention.value += ((attentionRef.current ? 1 : 0) - uniforms.attention.value) * (1 - Math.exp(-7 * delta))
          previous = now
          paint()
        }
        frame = requestAnimationFrame(tick)
      }
      const resume = () => {
        cancelAnimationFrame(frame)
        if (lost || !visible || document.hidden) return
        previous = performance.now()
        if (reduceMotion) paint()
        else frame = requestAnimationFrame(tick)
      }
      const resize = new ResizeObserver(() => {
        renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)
        if (!lost) paint()
      })
      const observer = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? false; resume() })
      const onLost = (event: Event) => { event.preventDefault(); lost = true; cancelAnimationFrame(frame); setReady(false) }
      const onRestored = () => { lost = false; setReady(true); resume() }
      canvas.addEventListener('webglcontextlost', onLost)
      canvas.addEventListener('webglcontextrestored', onRestored)
      document.addEventListener('visibilitychange', resume)
      resize.observe(canvas)
      observer.observe(canvas)
      renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)
      paint()
      setReady(true)
      resume()
      release = () => {
        cancelAnimationFrame(frame)
        resize.disconnect()
        observer.disconnect()
        document.removeEventListener('visibilitychange', resume)
        canvas.removeEventListener('webglcontextlost', onLost)
        canvas.removeEventListener('webglcontextrestored', onRestored)
        geometry.dispose()
        material.dispose()
        renderer.dispose()
      }
    }).catch(() => { /* Keep the local CSS fallback if the renderer cannot load. */ })
    return () => { disposed = true; release?.() }
  }, [reduceMotion])

  return (
    <section className="artist-manager-orb-stage" aria-label="Your Artist Manager">
      <motion.button
        type="button"
        className="artist-manager-orb-button"
        aria-label="Talk to your Artist Manager"
        aria-haspopup="dialog"
        onClick={onOpen}
        onPointerEnter={() => { attentionRef.current = true }}
        onPointerLeave={() => { attentionRef.current = false }}
        onFocus={() => { attentionRef.current = true }}
        onBlur={() => { attentionRef.current = false }}
        whileTap={reduceMotion ? undefined : { scale: 0.975 }}
        transition={{ duration: 0.18 }}
      >
        <span className="artist-manager-orb-art" aria-hidden="true">
          <span className="artist-manager-orb-fallback" style={{ opacity: ready ? 0 : 1 }} />
          <canvas ref={canvasRef} className="artist-manager-orb-canvas" style={{ opacity: ready ? 1 : 0 }} />
          <svg className="artist-manager-orb-voice" viewBox="0 0 40 32" fill="none">
            <path d="M8 14v4M14 9v14M20 5v22M26 10v12M32 14v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
        <span className="artist-manager-orb-label">Talk to your Manager<span aria-hidden="true">↗</span></span>
      </motion.button>
    </section>
  )
}
