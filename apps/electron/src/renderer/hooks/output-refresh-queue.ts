/** Coalesce reads while retaining invalidations received during a pending read. */
export function createOutputRefreshQueue() {
  const active = new Map<string, { promise: Promise<void>; invalidated: boolean }>()
  return {
    invalidate(key: string) {
      const pending = active.get(key)
      if (pending) pending.invalidated = true
    },
    refresh(key: string, read: () => Promise<void>): Promise<void> {
      const pending = active.get(key)
      if (pending) return pending.promise
      const state = { promise: Promise.resolve(), invalidated: false }
      // Defer invocation until the state is registered, including synchronous
      // callbacks which may themselves announce another output change.
      state.promise = Promise.resolve().then(async () => {
        try {
          do {
            state.invalidated = false
            await read()
          } while (state.invalidated)
        } finally {
          active.delete(key)
        }
      })
      active.set(key, state)
      return state.promise
    },
  }
}
