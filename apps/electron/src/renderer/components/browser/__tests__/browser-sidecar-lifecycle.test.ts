import { describe, expect, it } from 'bun:test'
import {
  cancelDeferredSidecarHide,
  deferSidecarHide,
  type DeferredSidecarHideGate,
} from '../browser-sidecar-lifecycle'

describe('browser sidecar lifecycle', () => {
  it('cancels the development StrictMode cleanup when the effect immediately remounts', async () => {
    const gate: DeferredSidecarHideGate = { generation: 0 }
    let hideCount = 0

    deferSidecarHide(gate, () => { hideCount += 1 })
    cancelDeferredSidecarHide(gate)
    await Promise.resolve()

    expect(hideCount).toBe(0)
  })

  it('hides the native browser after a real unmount', async () => {
    const gate: DeferredSidecarHideGate = { generation: 0 }
    let hideCount = 0

    deferSidecarHide(gate, () => { hideCount += 1 })
    await Promise.resolve()

    expect(hideCount).toBe(1)
  })
})
