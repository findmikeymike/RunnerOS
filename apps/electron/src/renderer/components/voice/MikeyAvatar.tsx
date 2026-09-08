import { useEffect, useRef, useState } from 'react'
import { UserRound } from 'lucide-react'
import type { AvatarPlayback, MikeyAvatarState } from '@/lib/mikey-avatar/pose'

interface MikeyAvatarProps {
  active: boolean
  state: MikeyAvatarState
  getPlayback: () => AvatarPlayback
}

export function MikeyAvatar(props: MikeyAvatarProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const current = useRef(props)
  current.current = props
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!props.active || !canvas.current) return
    const target = canvas.current
    let cancelled = false
    let dispose: (() => void) | undefined
    setReady(false)
    // Import and asset loading are independent of voice startup and failures.
    void import('@/lib/mikey-avatar/runtime').then(({ mountMikeyAvatar }) => {
      if (cancelled) return
      dispose = mountMikeyAvatar(target, () => current.current, available => {
        if (!cancelled) setReady(available)
      })
    }).catch(() => { if (!cancelled) setReady(false) })
    return () => { cancelled = true; dispose?.() }
  }, [props.active])

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <canvas ref={canvas} className={`size-full transition-opacity motion-reduce:transition-none ${ready ? 'opacity-100' : 'opacity-0'}`} />
      {!ready ? <div className="absolute inset-0 flex items-center justify-center"><div className="flex size-28 items-center justify-center rounded-full bg-white/[0.04] text-white/25"><UserRound className="size-12" strokeWidth={1} /></div></div> : null}
    </div>
  )
}
