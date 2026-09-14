import type { DeepLinkNavigation } from '../../shared/types'
export type LlmSetupRequest = NonNullable<DeepLinkNavigation['llmSetup']>
const EVENT = 'artist-os:llm-setup-request'
let pending: LlmSetupRequest | null = null
export function queueLlmSetupRequest(request: LlmSetupRequest): void {
  pending = request
  window.dispatchEvent(new Event(EVENT))
}
export function takeLlmSetupRequest(): LlmSetupRequest | null {
  const request = pending
  pending = null
  return request
}
export function onLlmSetupRequest(listener: () => void): () => void {
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
