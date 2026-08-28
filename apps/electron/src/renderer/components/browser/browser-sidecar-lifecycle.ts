export interface DeferredSidecarHideGate {
  generation: number
}

export function cancelDeferredSidecarHide(gate: DeferredSidecarHideGate): void {
  gate.generation += 1
}

export function deferSidecarHide(
  gate: DeferredSidecarHideGate,
  hide: () => void | Promise<void>,
): void {
  const generation = ++gate.generation
  queueMicrotask(() => {
    if (gate.generation !== generation) return
    void hide()
  })
}
