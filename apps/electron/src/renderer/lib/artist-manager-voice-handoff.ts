import type { VoiceHandoffProposal } from '../../shared/artist-manager-voice-handoff'

type VoiceHandoffDependencies = {
  stop(): Promise<void>
  isCurrent(): boolean
  open(proposal: VoiceHandoffProposal): Promise<void>
  onDiagnostic?(event: { stage: 'ready' | 'cancelled' | 'playback-finished' | 'stopping' | 'stopped' | 'opening' | 'opened' | 'failed'; proposalId?: string }): void
}

/** One coordinator per voice session. External stops must call cancel first. */
export function createVoiceHandoffCoordinator(deps: VoiceHandoffDependencies) {
  let pending: VoiceHandoffProposal | undefined
  let generation = 0
  const seen = new Set<string>()
  const diagnostic = (stage: Parameters<NonNullable<VoiceHandoffDependencies['onDiagnostic']>>[0]['stage'], proposalId?: string) => {
    try { deps.onDiagnostic?.({ stage, ...(proposalId ? { proposalId } : {}) }) } catch { /* Logging cannot break a handoff. */ }
  }

  return {
    ready(proposal: VoiceHandoffProposal): void {
      if (seen.has(proposal.id)) return
      seen.add(proposal.id)
      generation++
      pending = { ...proposal }
      diagnostic('ready', proposal.id)
    },
    cancel(): void {
      if (pending) diagnostic('cancelled', pending.id)
      generation++
      pending = undefined
    },
    async finish(): Promise<void> {
      const proposal = pending
      const ticket = generation
      // Consume before yielding: duplicate playback-complete events cannot reopen it.
      pending = undefined
      if (!proposal || !deps.isCurrent()) return
      diagnostic('playback-finished', proposal.id)
      // This internal stop must reject cleanup failures and must not call cancel.
      try {
        diagnostic('stopping', proposal.id)
        await deps.stop()
        diagnostic('stopped', proposal.id)
        if (ticket !== generation || !deps.isCurrent()) { diagnostic('cancelled', proposal.id); return }
        diagnostic('opening', proposal.id)
        await deps.open(proposal)
        diagnostic('opened', proposal.id)
      } catch (error) {
        diagnostic('failed', proposal.id)
        throw error
      }
    },
  }
}
