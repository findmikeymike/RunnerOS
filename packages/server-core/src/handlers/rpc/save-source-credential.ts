import { getSourceCredentialManager, type LoadedSource } from '@craft-agent/shared/sources'
import { assertTeamPermission } from '@craft-agent/shared/workspaces'
import { syncGoogleAdsCredentialCache } from './google-ads-credential-cache'
import { syncYouTubeResearchCredentialCache } from './youtube-research-credential-cache'

/** The same credential write for Settings and the agent's secure input form. */
export async function saveSourceCredential(
  workspaceRootPath: string,
  source: LoadedSource,
  credential: string,
): Promise<void> {
  assertTeamPermission(workspaceRootPath, 'secrets.update')
  if (typeof credential !== 'string' || !credential.trim()) throw new Error('A credential is required.')
  await getSourceCredentialManager().save(source, { value: credential })
  await syncGoogleAdsCredentialCache(source)
  await syncYouTubeResearchCredentialCache(source)
}
