import type { SignalEntryReference, SignalLookupResult, SignalRetrievedEntry } from '@craft-agent/shared/shared-intel'
import type { SessionDraft } from '@craft-agent/shared/config'

export function sameSignalReference(a: SignalEntryReference, b: SignalEntryReference): boolean {
  return a.hqWorkspaceId === b.hqWorkspaceId && a.outputId === b.outputId
    && a.contentHash === b.contentHash && a.entryId === b.entryId
}

export function resolvedSignalIdea(result: SignalLookupResult, reference: SignalEntryReference): SignalRetrievedEntry {
  const entry = result.entries[0]
  if (!result.ok || result.entries.length !== 1 || !entry
    || entry.kind !== 'idea' || !sameSignalReference(entry.reference, reference)) {
    throw new Error(result.error || 'This idea changed or is no longer available. Reopen its report before developing it.')
  }
  return entry
}

export function signalIdeaDraft(idea: SignalRetrievedEntry): string {
  return [
    `Develop this idea into a specific content concept. Keep research separate from my beliefs; do not create or publish assets yet.`,
    '', `Idea: ${idea.title}`, idea.excerpt,
    '', 'Supporting research:',
    ...(idea.supportingFindings ?? []).map(finding => `- ${finding.id} [sources: ${finding.sourceRefs.join(', ')}]: ${finding.excerpt}${finding.excerptTruncated ? ' [Excerpt shortened; read this finding in the referenced report for full context.]' : ''}`),
    ...(idea.supportingFindingsOmitted ? [`${idea.supportingFindingsOmitted} additional supporting findings are not included in this brief.`] : []),
    ...(idea.supportingFindingIds?.length ? [`Supporting finding IDs: ${idea.supportingFindingIds.join(', ')}.`] : []),
    ...(idea.supportingFindingsOmitted || idea.supportingFindings?.some(finding => finding.excerptTruncated)
      ? ['Use find_signal_ideas with the report reference and supporting finding ID to read shortened or omitted evidence before relying on it.'] : []),
    '', `Report: ${idea.reference.outputId} (${idea.createdAt})`,
    `Source HQ: ${idea.reference.hqWorkspaceId}; idea: ${idea.reference.entryId}; revision: ${idea.reference.contentHash}.`,
    `Track: ${idea.track}; mode: ${idea.mode}; timing: ${idea.temporalKind}; event date: ${idea.eventDate ?? 'unknown'}.`,
    ...idea.sources.map(source => `- ${source.sourceId}: ${source.sourceUrl}${source.timestampSeconds !== undefined ? ` (timestamp ${source.timestampSeconds}s)` : ''}; published: ${source.sourcePublishedAt ?? 'unknown'}`),
  ].join('\n')
}

/** Disk text may fill an unhydrated draft, never a deliberate local edit or clear. */
export async function focusSignalDraft(deps: {
  hasLocalDraft: () => boolean
  load: () => Promise<SessionDraft | undefined>
  restoreMissing: (draft: SessionDraft) => void
  isCurrent: () => boolean
  focus: (restore: () => void) => Promise<void>
}): Promise<void> {
  const stored = deps.hasLocalDraft() ? undefined : await deps.load()
  if (!deps.isCurrent()) throw new Error('Idea handoff cancelled.')
  await deps.focus(() => {
    if (stored && !deps.hasLocalDraft()) deps.restoreMissing(stored)
  })
}

export interface SignalHandoffLaunchDependencies {
  resolve: () => Promise<SignalLookupResult>
  find: () => Promise<string | null>
  create: () => Promise<string>
  bind: (sessionId: string) => Promise<string>
  discardBlank: (sessionId: string) => Promise<void>
  seed: (sessionId: string, text: string) => Promise<void>
  focus: (sessionId: string) => Promise<void>
  isCurrent: () => boolean
}

export class SignalDraftSaveError extends Error {
  constructor(readonly sessionId: string, readonly draft: string) {
    super('The research draft could not be saved. Retry saving it, or open the existing draft without replacing its text.')
  }
}

/** Binding precedes draft text/navigation; a concurrent winner retains its edits. */
export async function launchSignalIdea(reference: SignalEntryReference, deps: SignalHandoffLaunchDependencies): Promise<string> {
  const current = () => { if (!deps.isCurrent()) throw new Error('Idea handoff cancelled.') }
  const idea = resolvedSignalIdea(await deps.resolve(), reference)
  current()
  const existing = await deps.find()
  current()
  if (existing) { await deps.focus(existing); return existing }
  const created = await deps.create()
  if (!deps.isCurrent()) { await deps.discardBlank(created); current() }
  let canonical: string
  try { canonical = await deps.bind(created) }
  catch (error) { await deps.discardBlank(created); throw error }
  if (canonical !== created) await deps.discardBlank(created)
  // A valid bound draft may survive closing the dialog; never navigate late.
  if (canonical === created) {
    const draft = signalIdeaDraft(idea)
    try { await deps.seed(canonical, draft) }
    catch { throw new SignalDraftSaveError(canonical, draft) }
  }
  current()
  await deps.focus(canonical)
  return canonical
}

export function signalCampaignChoices<T extends { id: string; artistWorkspaceScope?: string; remoteServer?: unknown }>(workspaces: T[], hqId: string): T[] {
  const hqs = workspaces.filter(workspace => !workspace.remoteServer && workspace.artistWorkspaceScope === 'hq')
  if (hqs.length !== 1 || hqs[0]?.id !== hqId) return []
  return workspaces.filter(workspace => !workspace.remoteServer && workspace.artistWorkspaceScope === 'campaign')
}
