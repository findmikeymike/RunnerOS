import { getWorkspaces } from '@craft-agent/shared/config';
import { canAgentAccessContextDoc, loadAllContextDocs, type LoadedContextDoc } from '@craft-agent/shared/workspace-context';
import { ARTIST_CAREER_RESEARCH_CONTEXT_SLUG, rebuildCareerResearchProjection } from '@craft-agent/shared/artist-context';

type Workspace = { rootPath: string; artistWorkspaceScope?: string };
const IDENTITY = new Set(['artist-profile', 'artist-voice', 'artist-branding']);
const INHERITED = new Set([...IDENTITY, ARTIST_CAREER_RESEARCH_CONTEXT_SLUG]);

/** Read HQ identity in place: never copy it into a campaign or broaden its routing. */
export function withScriptwriterArtistContext(
  workspaceRootPath: string,
  agentSlug: string | null,
  localDocs: LoadedContextDoc[],
  configuredWorkspaces?: readonly Workspace[],
): LoadedContextDoc[] {
  const workspaces = configuredWorkspaces ?? getWorkspaces();
  const current = workspaces.find(workspace => workspace.rootPath === workspaceRootPath);
  if (current?.artistWorkspaceScope !== 'campaign') return localDocs;
  const wanted = agentSlug === 'scriptwriter' ? INHERITED : new Set([ARTIST_CAREER_RESEARCH_CONTEXT_SLUG]);
  const headquarters = workspaces.filter(workspace => workspace.artistWorkspaceScope === 'hq');
  // Do not choose an artist arbitrarily if configuration is ambiguous.
  if (headquarters.length !== 1) return localDocs.filter(doc => !wanted.has(doc.slug));
  rebuildCareerResearchProjection(headquarters[0]!.rootPath);
  const hqDocs = loadAllContextDocs(headquarters[0]!.rootPath).filter(doc => wanted.has(doc.slug));
  // HQ is authoritative even when a doc was disabled or made private: stale
  // campaign copies must not bypass that decision.
  return [
    ...hqDocs.filter(doc => canAgentAccessContextDoc(doc, agentSlug)).map(doc => ({
      ...doc,
      metadata: { ...doc.metadata, name: `${doc.metadata.name} (Artist HQ)` },
    })),
    ...localDocs.filter(doc => !wanted.has(doc.slug)),
  ];
}
