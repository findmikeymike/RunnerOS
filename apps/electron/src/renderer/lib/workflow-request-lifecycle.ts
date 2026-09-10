/** One mounted owner: newer requests, local decisions, and disposal fence older replies. */
export function createWorkflowRequestLifecycle() {
  let generation = 0
  let disposed = false
  return {
    invalidate() { generation++ },
    dispose() { disposed = true; generation++ },
    async run<T>(load: () => Promise<T>, accept: (value: T) => void, reject: (error: unknown) => void) {
      const request = ++generation
      try { const value = await load(); if (!disposed && request === generation) accept(value) }
      catch (error) { if (!disposed && request === generation) reject(error) }
    },
  }
}

/** Poll ticks queue one follow-up rather than cancelling a slow authoritative read. */
export function createWorkflowRefreshLifecycle<T>(load: () => Promise<T>, accept: (value: T) => void, reject: (error: unknown) => void) {
  const requests = createWorkflowRequestLifecycle()
  let disposed = false
  let pending = false
  let active: Promise<void> | undefined
  const refresh = (): Promise<void> => {
    if (disposed) return Promise.resolve()
    pending = true
    if (active) return active
    active = (async () => {
      while (pending && !disposed) {
        pending = false
        await requests.run(load, accept, reject)
      }
    })().finally(() => { active = undefined; if (pending && !disposed) void refresh() })
    return active
  }
  return {
    refresh,
    invalidate() { requests.invalidate(); void refresh() },
    dispose() { disposed = true; pending = false; requests.dispose() },
  }
}
