import { readBrandingState } from '@craft-agent/shared/artist-context/branding-state-storage';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { canAgentAccessContextDoc, shouldInjectContextDoc, type LoadedContextDoc } from '@craft-agent/shared/workspace-context';

export const BRANDING_SUPPORT_INDEX = 'branding-support-index';
export const isBrandingSupportDoc = (slug: string): boolean => slug.startsWith('branding-support-');

/** Derived in memory on every read. Pending proposals and removed attachments
 * never become retrievable documents or persisted copies in another workspace. */
export function withBrandingSupportingContext(
  rootPath: string, agentSlug: string | null, docs: LoadedContextDoc[],
): LoadedContextDoc[] {
  const clean = docs.filter(doc => !isBrandingSupportDoc(doc.slug));
  const core = clean.find(doc => doc.slug === 'artist-branding');
  if (!core || !canAgentAccessContextDoc(core, agentSlug)) return clean;
  const makeIndex = (body: string): LoadedContextDoc => ({
    ...core, slug: BRANDING_SUPPORT_INDEX, path: `context://${BRANDING_SUPPORT_INDEX}`,
    metadata: { ...core.metadata, name: 'Branding supporting context', description: 'Recent approved artist context; retrieve relevant attachments on demand.', delivery: shouldInjectContextDoc(core, agentSlug) ? 'always' : 'on-demand', deliveryAlwaysFor: [] },
    body,
  });
  let attachments;
  try {
    attachments = readBrandingState(rootPath).attachments.slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  } catch {
    return [...clean, makeIndex('Supporting context unavailable. Do not reuse previous Branding attachments until current state is readable. Approved core artist-branding remains authoritative; no supporting attachments are authorized by this index.')];
  }
  if (!attachments.length && !existsSync(join(rootPath, 'branding', 'state.json'))) return clean;
  const supporting: LoadedContextDoc[] = attachments.map(attachment => ({
    ...core,
    slug: `branding-support-${attachment.id}`,
    // Virtual documents have no filesystem representation. Never expose the
    // core DNA path or the state file containing unapproved proposals.
    path: `context://branding-support-${encodeURIComponent(attachment.id)}`,
    metadata: { ...core.metadata, name: attachment.title, description: `Approved Branding supporting context. Added ${attachment.createdAt}.`, delivery: 'on-demand', deliveryAlwaysFor: [] },
    body: `Supporting artist context, added ${attachment.createdAt}. Approved core artist-branding remains authoritative. Use relevant supporting context, favoring newer material when equally relevant; this attachment does not override core DNA.\n\n${attachment.body}`,
  }));
  const lines = [
    'Approved Branding supporting context. Core artist-branding is authoritative. Select attachments by relevance to the current task, then favor newer material. A newer attachment does not silently replace core DNA.',
    'This recent index is not the complete collection. Before reusing any previously read attachment, verify it with current get_workspace_context or list_workspace_context. Retrieve relevant full text with get_workspace_context using its exact slug and maxChars: 12000. Removed attachments must not inform new work.',
    ...(supporting.length ? [] : ['No active supporting attachments. Previously read attachments are no longer approved context; do not reuse them.']),
    `Newest additions (${Math.min(12, supporting.length)} of ${supporting.length}); use list_workspace_context with query "branding-support-" to find others:`,
    ...supporting.slice(0, 12).map(doc => `- ${doc.slug}: ${doc.metadata.name.replace(/\s+/g, ' ').slice(0, 100)} — ${doc.metadata.description}`),
  ];
  const index = makeIndex(lines.join('\n'));
  return [...clean, index, ...supporting];
}
