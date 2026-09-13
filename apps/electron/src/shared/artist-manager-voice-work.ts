import type { VoiceTaskBridge } from '@craft-agent/server-core/voice-tasks'
type Operation = 'bind' | 'reserveIntent' | 'lookupIntent' | 'launch' | 'snapshot' | 'cancel' | 'detach' | 'validateOutputReference' | 'claimDelivery' | 'renewDelivery' | 'acknowledgeDelivery'
type Tail<T extends unknown[]> = T extends [unknown, ...infer Rest] ? Rest : never
export type VoiceWorkRequest = { [K in Operation]: { sessionId: string; method: K; args: Tail<Parameters<VoiceTaskBridge[K]>> } }[Operation]
export type VoiceWorkResult = Awaited<ReturnType<VoiceTaskBridge[Operation]>>
export type VoiceWorkEvent = { bindingId: string; event: Parameters<Parameters<VoiceTaskBridge['subscribe']>[3]>[0] }
export type VoiceWorkSubscribe = { sessionId: string; bindingId: string; cursor?: number }
export type VoiceWorkAPI = {
  invoke(request: VoiceWorkRequest): Promise<VoiceWorkResult>
  subscribe(request: VoiceWorkSubscribe): Promise<void>
  onEvent(callback: (event: VoiceWorkEvent) => void): () => void
}
