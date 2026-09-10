/** Discover saved work even when no active run is currently known to this renderer. */
export function startWorkflowRunDiscovery(options: {
  refresh: () => Promise<void>
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>
  schedule?: (callback: () => void) => () => void
}): () => void {
  let disposed = false
  let running = false
  let queued = false
  const refresh = async () => {
    if (disposed) return
    if (running) { queued = true; return }
    running = true
    try {
      do {
        queued = false
        try { await options.refresh() } catch { /* The next invalidation retries discovery. */ }
      } while (queued && !disposed)
    } finally { running = false }
  }
  const invalidate = () => { void refresh() }
  const cancelTimer = (options.schedule ?? (callback => {
    const timer = setInterval(callback, 2000)
    return () => clearInterval(timer)
  }))(invalidate)
  options.target.addEventListener('focus', invalidate)
  options.target.addEventListener('online', invalidate)
  invalidate()
  return () => {
    disposed = true
    cancelTimer()
    options.target.removeEventListener('focus', invalidate)
    options.target.removeEventListener('online', invalidate)
  }
}

/** An in-flight list may predate admission; trail it once without issuing another START. */
export async function refreshAfterUncertainWorkflowStart(refresh: () => Promise<void>): Promise<void> {
  try { await refresh() } catch { /* Preserve the original start error. */ }
  try { await refresh() } catch { /* Background discovery remains available. */ }
}
