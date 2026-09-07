import type { VoiceHandoffProposal } from '../../shared/artist-manager-voice-handoff'

type VoiceHandoffDependencies = {
  stop(): Promise<void>
  isCurrent(): boolean
  open(proposal: VoiceHandoffProposal): Promise<void>
}

/** One coordinator per voice session. External stops must call cancel first. */
export function createVoiceHandoffCoordinator(deps: VoiceHandoffDependencies) {
  let pending: VoiceHandoffProposal | undefined
  let generation = 0
  const seen = new Set<string>()

  return {
    ready(proposal: VoiceHandoffProposal): void {
      if (seen.has(proposal.id)) return
      seen.add(proposal.id)
      generation++
      pending = { ...proposal }
    },
    cancel(): void {
      generation++
      pending = undefined
    },
    async finish(): Promise<void> {
      const proposal = pending
      const ticket = generation
      // Consume before yielding: duplicate playback-complete events cannot reopen it.
      pending = undefined
      if (!proposal || !deps.isCurrent()) return
      // This internal stop must reject cleanup failures and must not call cancel.
      await deps.stop()
      if (ticket !== generation || !deps.isCurrent()) return
      await deps.open(proposal)
    },
  }
}
