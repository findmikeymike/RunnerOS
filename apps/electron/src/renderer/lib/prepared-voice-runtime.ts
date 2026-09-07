type DestroyableRuntime = { destroy(): Promise<void> }
type PreparedStt = { cancelStart?(): void; stop(): Promise<void> }

/** Own resources prepared before Voice Core starts and therefore outside its cleanup. */
export function createPreparedVoiceRuntime<T extends DestroyableRuntime>(deps: {
  runtime: T
  stt?: PreparedStt
  focus: { stop(): Promise<void> }
}): { runtime: T; destroy(): Promise<void> } {
  let destruction: Promise<void> | undefined
  return {
    runtime: deps.runtime,
    destroy() {
      if (destruction) return destruction
      let resolve!: () => void
      let reject!: (reason: unknown) => void
      // Install the barrier before cancellation, including for reentrant cleanup.
      destruction = new Promise<void>((yes, no) => { resolve = yes; reject = no })
      const failures: Array<{ stage: string; reason: unknown }> = []
      try { deps.stt?.cancelStart?.() } catch (reason) { failures.push({ stage: 'cancel STT preparation', reason }) }
      void (async () => {
        try { await deps.runtime.destroy() } catch (reason) { failures.push({ stage: 'destroy voice runtime', reason }) }
        // Runtime teardown settles first; explicit cleanup covers never-started transports.
        const cleanup = [
          ...(deps.stt ? [{ stage: 'stop prepared STT', stop: () => deps.stt!.stop() }] : []),
          { stage: 'stop prepared voice session', stop: () => deps.focus.stop() },
        ]
        const results = await Promise.allSettled(cleanup.map(item => Promise.resolve().then(item.stop)))
        results.forEach((result, index) => {
          if (result.status === 'rejected') failures.push({ stage: cleanup[index]!.stage, reason: result.reason })
        })
        if (failures.length) {
          throw new AggregateError(failures.map(failure => failure.reason), `Voice cleanup failed: ${failures.map(failure => failure.stage).join(', ')}`)
        }
      })().then(resolve, reject)
      return destruction
    },
  }
}
