import type { VoiceTaskBridge, VoiceTask } from '@craft-agent/server-core/voice-tasks'
import type { VoiceWorkAPI, VoiceWorkRequest } from '../../../shared/artist-manager-voice-work'

type Snapshot = Awaited<ReturnType<VoiceTaskBridge['snapshot']>>
type Lease = NonNullable<Awaited<ReturnType<VoiceTaskBridge['claimDelivery']>>>
type Handle = { done: Promise<'delivered' | 'interrupted' | 'failed'>; cancel(): void }
type Runtime = { getExternalAssistantTurnStatus(): {supported: boolean; idle: boolean; idleForMs: number}; externalAssistantTurn(input: {origin: 'worker-result'; turnId: string; text: string}): {status: 'accepted'; delivery: Handle} | {status: 'deferred' | 'unsupported'} }
type Operation = VoiceWorkRequest['method']
type Args<K extends Operation> = Extract<VoiceWorkRequest, {method: K}>['args']
export type VoiceWorkView = { tasks: VoiceTask[]; unresolved: Snapshot['intents'] }
const correlation = (lease: Lease) => ({ deliveryId: lease.deliveryId, leaseId: lease.leaseId, bindingGeneration: lease.bindingGeneration, taskId: lease.taskId, attemptId: lease.attemptId, revision: lease.revision })

/** A call attachment only. It never owns or automatically retries execution. */
export function createVoiceWorkCall(deps: {
  api: VoiceWorkAPI; sessionId: string; runtime: Runtime
  onView(view: VoiceWorkView): void; onError(message: string): void
  now?: () => number
}) {
  const now = deps.now ?? Date.now
  let stopped = false, bindingId: string | undefined, polling = false, resync = true
  let nextRefresh = 0, cursor = 0, view: Snapshot | undefined
  let active: { lease: Lease; handle?: Handle; renewAt: number } | undefined
  const retryAfter = new Map<string, number>()
  const failedAttempts = new Map<string, number>()
  const released = new WeakSet<object>()
  let scanAfter: string | undefined
  const cancellations = new Map<string, {requestId: string; inFlight?: Promise<void>}>()
  const rpc = <K extends Operation>(method: K, ...args: Args<K>) => deps.api.invoke({sessionId: deps.sessionId, method, args} as VoiceWorkRequest) as Promise<Awaited<ReturnType<VoiceTaskBridge[K]>>>
  const report = () => { if (!stopped) deps.onError('Task status is temporarily unavailable. Your background work has not been cancelled.') }
  const release = async (entry: NonNullable<typeof active>, outcome: 'delivered' | 'interrupted' | 'failed') => {
    if (!bindingId || released.has(entry)) return
    released.add(entry)
    try { await rpc('acknowledgeDelivery', bindingId, {...correlation(entry.lease), outcome}) }
    catch { if (!stopped) report() } // Never infer acknowledgement from a lost response.
    finally { if (active === entry) active = undefined; if (outcome !== 'delivered') { const attempts = (failedAttempts.get(entry.lease.taskId) ?? 0) + 1; failedAttempts.set(entry.lease.taskId, attempts); retryAfter.set(entry.lease.taskId, attempts >= 2 ? Infinity : now() + 2000) }; resync = true }
  }
  const unsubscribe = deps.api.onEvent(event => {
    if (!stopped && event.bindingId === bindingId && event.event.streamSequence > cursor) resync = true
  })
  const ready = (async () => {
    const binding = await rpc('bind', {voiceSessionId: deps.sessionId, callId: deps.sessionId})
    bindingId = binding.bindingId
    if (stopped) { await rpc('detach', bindingId).catch(() => undefined); return }
    await refresh()
  })().catch(report)
  async function refresh() {
    if (!bindingId || stopped) return
    const snapshot = await rpc('snapshot', bindingId, cursor)
    if (stopped) return
    view = snapshot; cursor = snapshot.cursor; resync = false; nextRefresh = now() + 2000
    deps.onView({tasks: snapshot.tasks, unresolved: snapshot.intents})
    await deps.api.subscribe({sessionId: deps.sessionId, bindingId, cursor})
  }
  async function tick() {
    if (stopped || polling || !bindingId) return
    polling = true
    try {
      if (active && now() >= active.renewAt) {
        const entry = active
        const renewed = await rpc('renewDelivery', bindingId, correlation(entry.lease))
        if (stopped || active !== entry) return
        if (!renewed) { entry.handle?.cancel(); await release(entry, 'interrupted'); return }
        entry.lease = renewed; entry.renewAt = now() + 5000
      }
      if (resync || now() >= nextRefresh) await refresh()
      if (stopped || !view) return
      if (active) { offer(active); return }
      const status = deps.runtime.getExternalAssistantTurnStatus()
      if (!status.supported || !status.idle || status.idleForMs < 700) return
      // Overflow remains durable in the host. Only twenty notifications enter this call's queue.
      const start = (view.pendingDeliveries.findIndex(item => item.taskId === scanAfter) + 1) % (view.pendingDeliveries.length || 1)
      const rotated = [...view.pendingDeliveries.slice(start), ...view.pendingDeliveries.slice(0, start)]
      const pending = rotated.filter(item => now() >= (retryAfter.get(item.taskId) ?? 0)).slice(0, 20)[0]
      if (!pending) return
      scanAfter = pending.taskId
      const lease = await rpc('claimDelivery', bindingId, pending)
      if (!lease) { retryAfter.set(pending.taskId, now() + 2000); return }
      const entry = {lease, renewAt: now() + 5000, handle: undefined as Handle | undefined}; active = entry
      if (stopped) { await release(entry, 'interrupted'); return }
      offer(entry)
    } catch {
      if (active) { const entry = active; entry.handle?.cancel(); await release(entry, 'interrupted') }
      report(); nextRefresh = now() + 2000
    } finally { polling = false }
  }
  function offer(entry: NonNullable<typeof active>) {
    if (entry.handle || stopped || active !== entry) return
    if (now() >= Date.parse(entry.lease.expiresAt)) { void release(entry, 'interrupted'); return }
    const offered = deps.runtime.externalAssistantTurn({origin: 'worker-result', turnId: entry.lease.deliveryId, text: entry.lease.text})
    if (offered.status === 'accepted') {
      entry.handle = offered.delivery
      void offered.delivery.done.then(outcome => release(entry, outcome), () => release(entry, 'failed'))
    } else if (offered.status === 'unsupported') {
      retryAfter.set(entry.lease.taskId, Infinity); void release(entry, 'failed')
    }
  }
  function pulse() {
    // Local expiry remains effective even while an IPC renewal is stalled.
    if (active && now() >= Date.parse(active.lease.expiresAt)) {
      const entry = active; active = undefined; entry.handle?.cancel()
      void release(entry, 'interrupted')
    }
    return tick()
  }
  const timer = setInterval(() => { void pulse().catch(report) }, 200)
  return {
    ready,
    async retryIntent(intentId: string) {
      await ready
      if (stopped || !bindingId) return
      // Explicit UI action reuses the durable intent. No new proposal/key or auto retry.
      await rpc('launch', bindingId, intentId); resync = true; await tick()
    },
    async cancelTask(taskId: string, attemptId: string) {
      await ready
      if (stopped || !bindingId) throw new Error('This call is no longer attached.')
      const task = view?.tasks.find(task => task.taskId === taskId && task.attemptId === attemptId)
      if (!task) throw new Error('This task attempt is no longer available.')
      if (!['admitting', 'running', 'cancelling'].includes(task.state)) return
      const key = `${taskId}:${attemptId}`
      let request = cancellations.get(key)
      if (!request) { request = {requestId: crypto.randomUUID()}; cancellations.set(key, request) }
      if (request.inFlight) return request.inFlight
      const entry = request
      entry.inFlight = (async () => {
        await rpc('cancel', bindingId!, {taskId, attemptId, requestId: entry.requestId})
        // Only host snapshots may change status; a successful request is not a stopped worker.
        resync = true
        if (!stopped) await refresh()
      })().finally(() => { entry.inFlight = undefined })
      return entry.inFlight
    },
    async validateOutput(taskId: string, outputId: string) {
      await ready
      if (stopped || !bindingId) throw new Error('Reconnect the call to verify this result.')
      return rpc('validateOutputReference', bindingId, taskId, outputId)
    },
    stop() {
      if (stopped) return
      stopped = true; clearInterval(timer); unsubscribe()
      active?.handle?.cancel()
      if (bindingId) void rpc('detach', bindingId).catch(() => undefined)
    },
    tick: pulse,
  }
}
