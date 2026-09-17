import { existsSync } from 'node:fs';
import { saveReleaseCreativeBriefSchema, type SaveReleaseCreativeBriefInput } from '@craft-agent/session-tools-core';
import { canAgentAccessContextDoc, getContextDocFile, loadContextDoc, upsertContextDoc } from '@craft-agent/shared/workspace-context';
import { assertTeamPermission } from '@craft-agent/shared/workspaces';
import { withWorkspaceContextLock } from '../scheduled-work/workspace-context-lock';

export const RELEASE_CREATIVE_BRIEF_SLUG = 'campaign-creative-direction';

/** Save only the current campaign's direction, never HQ artist identity. */
export async function saveReleaseCreativeBrief(
  root: string,
  raw: SaveReleaseCreativeBriefInput,
  actor: { agentSlug: string | null; workspaceScope?: string },
) {
  if (actor.workspaceScope !== 'campaign' || actor.agentSlug !== 'branding-agent') {
    throw new Error('Only Creative Direction in the current campaign can save this brief.');
  }
  const input = saveReleaseCreativeBriefSchema.parse(raw);
  assertTeamPermission(root, 'files.write');
  return withWorkspaceContextLock(root, async () => {
    const doc = loadContextDoc(root, RELEASE_CREATIVE_BRIEF_SLUG);
    if ((!doc && existsSync(getContextDocFile(root, RELEASE_CREATIVE_BRIEF_SLUG))) || doc?.parseWarnings?.length) {
      throw new Error('The saved brief could not be read safely. Nothing was changed.');
    }
    if (doc && !canAgentAccessContextDoc(doc, actor.agentSlug)) {
      throw new Error('This brief is disabled or not available to this agent. Nothing was changed.');
    }
    if ((doc?.body ?? null) !== input.expectedBody) {
      throw new Error('CONTEXT_DOC_CONFLICT: The creative brief changed. Read campaign-creative-direction again and reconcile before saving.');
    }
    const content = input.body.replace(/^Direction status: (?:proposed|accepted)\s*\n+/i, '').trim();
    if (!content) throw new Error('The creative brief must contain direction beyond its status.');
    const body = `Direction status: ${input.status}\n\n${content}`;
    upsertContextDoc(root, {
      slug: RELEASE_CREATIVE_BRIEF_SLUG,
      metadata: doc?.metadata ?? { name: 'Release Creative Direction', enabled: true, routing: { mode: 'broadcast' }, delivery: 'on-demand' },
      body,
    });
    return { saved: true, slug: RELEASE_CREATIVE_BRIEF_SLUG, status: input.status, body };
  });
}
