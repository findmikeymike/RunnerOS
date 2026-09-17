import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, mkdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteFileSync } from '@craft-agent/shared/utils'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { assertTeamPermission } from '@craft-agent/shared/workspaces'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { BRANDING_FIELDS, artistBrandingDoc, type BrandingState, type BrandingAttachmentInput, type BrandingAttachment, type ProposeBrandingUpdateInput, type BrandingProposalActionInput, type AddBrandingAttachmentInput, type RemoveBrandingAttachmentInput } from '@craft-agent/shared/artist-context'
import { isBrandingState, readBrandingState, writeBrandingState } from '@craft-agent/shared/artist-context/branding-state-storage'
import { getContextDocFile, loadContextDoc, loadAllContextDocs, upsertContextDoc, type UpsertContextDocInput } from '@craft-agent/shared/workspace-context'
import { withWorkspaceContextLock } from '../../scheduled-work/workspace-context-lock'
import { refreshArtistManagerStateForWorkspaceBestEffort } from '../../hq-state/refresh'
import type { RpcServer } from '../../transport'
import type { HandlerDeps } from '../handler-deps'

function rootFor(workspaceId: string, write = false): string {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace || workspace.artistWorkspaceScope !== 'hq') throw new Error('Artist Branding changes belong in Artist HQ.')
  if (write) assertTeamPermission(workspace.rootPath, 'files.write')
  return workspace.rootPath
}
function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${label}.`)
  return value.trim()
}
function attachment(value: BrandingAttachmentInput): BrandingAttachment {
  return { id: randomUUID(), createdAt: new Date().toISOString(), title: text(value.title, 'attachment title', 200), body: text(value.body, 'attachment body', 11000), ...(value.sourceOutputId ? { sourceOutputId: text(value.sourceOutputId, 'source output', 200) } : {}) }
}
function current(root: string) {
  const doc = loadContextDoc(root, artistBrandingDoc.slug)
  if ((!doc && existsSync(getContextDocFile(root, artistBrandingDoc.slug))) || doc?.parseWarnings?.length) throw new Error('Existing Branding document needs repair; it was preserved.')
  const parsed = artistBrandingDoc.parse(doc ?? undefined)
  if (!parsed.ok) throw new Error(parsed.error)
  return { doc, value: parsed.value }
}
function revision(state: BrandingState, expected: string) {
  if (state.revision !== expected) throw new Error('BRANDING_CONFLICT: Branding changed. Refresh and review again.')
}
interface Journal { beforeBody: string | null; update: UpsertContextDocInput; state: BrandingState }
function recover(root: string) {
  const path = join(root, 'branding', 'apply-journal.json')
  if (!existsSync(path)) return
  assertTeamPermission(root, 'files.write')
  const journal = JSON.parse(readFileSync(path, 'utf8')) as Journal
  if (journal.update?.slug !== artistBrandingDoc.slug || typeof journal.update.body !== 'string' || !isBrandingState(journal.state) || !journal.update.metadata || (journal.beforeBody !== null && typeof journal.beforeBody !== 'string')) throw new Error('Branding recovery data is invalid; existing data was preserved.')
  const existingDoc = loadContextDoc(root, artistBrandingDoc.slug)
  if ((!existingDoc && existsSync(getContextDocFile(root, artistBrandingDoc.slug))) || existingDoc?.parseWarnings?.length) throw new Error('Existing Branding needs repair before approval recovery; it was preserved.')
  const body = existingDoc?.body ?? null
  if (body !== journal.beforeBody && body !== journal.update.body) throw new Error('BRANDING_CONFLICT: An interrupted approval needs recovery before further changes.')
  if (body !== journal.update.body) upsertContextDoc(root, {...journal.update, metadata: existingDoc?.metadata ?? journal.update.metadata})
  writeBrandingState(root, journal.state)
  unlinkSync(path)
}
export async function getBrandingState(workspaceId: string): Promise<BrandingState> {
  const root = rootFor(workspaceId)
  return withWorkspaceContextLock(root, async () => { recover(root); return readBrandingState(root) })
}
async function mutate(workspaceId: string, expected: string, change: (state: BrandingState, root: string) => void): Promise<BrandingState> {
  const root = rootFor(workspaceId, true)
  return withWorkspaceContextLock(root, async () => {
    recover(root)
    const state = readBrandingState(root)
    revision(state, expected)
    change(state, root)
    state.revision = randomUUID()
    writeBrandingState(root, state)
    return state
  })
}
export async function proposeBrandingUpdate(workspaceId: string, input: ProposeBrandingUpdateInput): Promise<BrandingState> {
  return mutate(workspaceId, input.expectedRevision, (state, root) => {
    const title = text(input.title, 'proposal title', 200)
    if (!Array.isArray(input.patches) || input.patches.length > 8 || !Array.isArray(input.additions ?? []) || (input.additions?.length ?? 0) > 5 || (!input.patches.length && !input.additions?.length)) throw new Error('Choose up to eight changes or five supporting documents.')
    const { value } = current(root)
    const seen = new Set<string>()
    for (const patch of input.patches) {
      if (!BRANDING_FIELDS.includes(patch.field) || seen.has(patch.field) || typeof patch.before !== 'string' || typeof patch.after !== 'string' || patch.after.length > 20000) throw new Error('Invalid Branding field change.')
      seen.add(patch.field)
      if ((value[patch.field] ?? '') !== patch.before) throw new Error(`BRANDING_CONFLICT: ${patch.field} changed. Read its current value and propose again.`)
    }
    const patches = input.patches.filter(p => p.before !== p.after)
    if (!patches.length && !input.additions?.length) throw new Error('This proposal has no changes.')
    const additions = (input.additions ?? []).map(attachment)
    const signature = (p: { title: string; patches: unknown; additions: BrandingAttachmentInput[] }) => JSON.stringify({ title: p.title, patches: p.patches, additions: p.additions.map(a => ({title: a.title, body: a.body, sourceOutputId: a.sourceOutputId})) })
    const proposal = { id: randomUUID(), title, createdAt: new Date().toISOString(), patches: structuredClone(patches), additions, status: 'pending' as const, ...(input.sourceSessionId ? {sourceSessionId: text(input.sourceSessionId, 'session', 200)} : {}) }
    if (!state.proposals.some(p => p.status === 'pending' && signature(p) === signature(proposal))) state.proposals.push(proposal)
  })
}

/** Preserve authored prose and every unselected raw JSON value. */
export function patchBrandingBody(body: string, patches: ProposeBrandingUpdateInput['patches']): string {
  const fences = [...body.matchAll(/(```json[^\S\r\n]*\r?\n)([\s\S]*?)(```)/gi)]
  if (fences.length !== 1) throw new Error('Existing Branding needs one readable JSON section before applying changes; it was preserved.')
  const fence = fences[0]!
  let record: unknown
  try { record = JSON.parse(fence[2]!) } catch { throw new Error('Existing Branding JSON needs repair; it was preserved.') }
  if (!record || typeof record !== 'object' || Array.isArray(record) || (record as Record<string, unknown>).version !== 1) throw new Error('Existing Branding JSON has an unsupported shape; it was preserved.')
  const updated = {...record} as Record<string, unknown>
  for (const patch of patches) updated[patch.field] = patch.after
  updated.updatedAt = new Date().toISOString()
  const json = fence[2]!
  const leading = json.match(/^\s*/)?.[0] ?? ''
  const trailing = json.match(/\s*$/)?.[0] ?? ''
  const start = fence.index! + fence[1]!.length
  return body.slice(0, start) + leading + JSON.stringify(updated, null, 2) + trailing + body.slice(start + json.length)
}

export async function applyBrandingProposal(workspaceId: string, input: BrandingProposalActionInput): Promise<BrandingState> {
  const root = rootFor(workspaceId, true)
  return withWorkspaceContextLock(root, async () => {
    recover(root)
    const state = readBrandingState(root)
    revision(state, input.expectedRevision)
    const proposal = state.proposals.find(p => p.id === input.proposalId && p.status === 'pending')
    if (!proposal) throw new Error('This proposal is no longer pending.')
    const { doc, value } = current(root)
    for (const patch of proposal.patches) {
      if ((value[patch.field] ?? '') !== patch.before) throw new Error(`BRANDING_CONFLICT: ${patch.field} changed. Review a new proposal.`)
      value[patch.field] = patch.after
    }
    proposal.status = 'applied'
    state.attachments.push(...proposal.additions)
    state.history.push({ id: randomUUID(), action: 'applied', proposalId: proposal.id, createdAt: new Date().toISOString(), previousBody: doc?.body ?? null })
    state.revision = randomUUID()
    if (proposal.patches.length || !doc) {
      const update = { slug: artistBrandingDoc.slug, metadata: doc?.metadata ?? artistBrandingDoc.metadata(), body: doc ? patchBrandingBody(doc.body, proposal.patches) : artistBrandingDoc.serialize(value) }
      mkdirSync(join(root, 'branding'), {recursive: true})
      if (!isBrandingState(state)) throw new Error('Invalid Branding approval; existing data was preserved.')
      atomicWriteFileSync(join(root, 'branding', 'apply-journal.json'), JSON.stringify({beforeBody: doc?.body ?? null, update, state}))
      recover(root)
    } else writeBrandingState(root, state)
    refreshArtistManagerStateForWorkspaceBestEffort(root)
    return state
  })
}
export async function dismissBrandingProposal(workspaceId: string, input: BrandingProposalActionInput): Promise<BrandingState> {
  return mutate(workspaceId, input.expectedRevision, state => {
    const p = state.proposals.find(p => p.id === input.proposalId && p.status === 'pending')
    if (!p) throw new Error('This proposal is no longer pending.')
    p.status = 'dismissed'
    state.history.push({id: randomUUID(), action: 'dismissed', proposalId: p.id, createdAt: new Date().toISOString()})
  })
}
export async function addBrandingAttachment(workspaceId: string, input: AddBrandingAttachmentInput): Promise<BrandingState> {
  return mutate(workspaceId, input.expectedRevision, (state, root) => {
    const {doc, value} = current(root)
    const added = attachment(input)
    if (!doc) upsertContextDoc(root, {slug: artistBrandingDoc.slug, metadata: artistBrandingDoc.metadata(), body: artistBrandingDoc.serialize(value)})
    state.attachments.push(added)
    state.history.push({id: randomUUID(), action: 'attachment-added', attachment: added, createdAt: new Date().toISOString()})
  })
}
export async function removeBrandingAttachment(workspaceId: string, input: RemoveBrandingAttachmentInput): Promise<BrandingState> {
  return mutate(workspaceId, input.expectedRevision, state => {
    const removed = state.attachments.find(a => a.id === input.attachmentId)
    if (!removed) throw new Error('Attachment no longer exists.')
    state.attachments = state.attachments.filter(a => a.id !== removed.id)
    state.history.push({id: randomUUID(), action: 'attachment-removed', attachment: removed, createdAt: new Date().toISOString()})
  })
}
export const HANDLED_CHANNELS = [RPC_CHANNELS.brandingState.GET, RPC_CHANNELS.brandingState.PROPOSE, RPC_CHANNELS.brandingState.APPLY, RPC_CHANNELS.brandingState.DISMISS, RPC_CHANNELS.brandingState.ADD_ATTACHMENT, RPC_CHANNELS.brandingState.REMOVE_ATTACHMENT] as const
export function registerBrandingStateHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.brandingState.GET, (_ctx, workspaceId: string) => getBrandingState(workspaceId))
  const mutations = [[RPC_CHANNELS.brandingState.PROPOSE, proposeBrandingUpdate], [RPC_CHANNELS.brandingState.APPLY, applyBrandingProposal], [RPC_CHANNELS.brandingState.DISMISS, dismissBrandingProposal], [RPC_CHANNELS.brandingState.ADD_ATTACHMENT, addBrandingAttachment], [RPC_CHANNELS.brandingState.REMOVE_ATTACHMENT, removeBrandingAttachment]] as const
  for (const [channel, fn] of mutations) server.handle(channel, async (_ctx, workspaceId: string, input: unknown) => {
    const state = await fn(workspaceId, input as never)
    ;(deps as unknown as {wsServer?: {push: (...args: unknown[]) => void}}).wsServer?.push(RPC_CHANNELS.brandingState.CHANGED, {to: 'all'}, workspaceId, state)
    ;(deps as unknown as {wsServer?: {push: (...args: unknown[]) => void}}).wsServer?.push(RPC_CHANNELS.workspaceContext.CHANGED, {to: 'all'}, workspaceId, loadAllContextDocs(rootFor(workspaceId)))
    return state
  })
}
