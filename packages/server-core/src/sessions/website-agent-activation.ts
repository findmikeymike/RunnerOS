import { constants, copyFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getGlobalAgentDir, loadGlobalAgent, readActivatedAgents, setAgentActive, type AgentStorageOptions } from '@craft-agent/shared/agent-definitions'
import { getActivatedAgentsManifestPath } from '@craft-agent/shared/workspaces'
import { migrateInitialArtistAgentActivation, type ReleaseManagerActivationWorkspace } from './release-manager-activation'

/** One explicit HQ transition, never a recurring default or a campaign rewrite. */
export function activateHqWebsiteAgentOnce(
  workspaces: ReleaseManagerActivationWorkspace[],
  options?: AgentStorageOptions,
  warn?: (message: string, error?: unknown) => void,
) {
  return migrateInitialArtistAgentActivation({
    stateFile: join(dirname(getGlobalAgentDir('website-agent', options)), '.migrations', 'hq-website-agent-activation-v1.json'),
    workspaces: workspaces.filter(workspace => !workspace.remoteServer && workspace.artistWorkspaceScope === 'hq'),
    agentSlug: 'website-agent',
    skillSlugs: [],
    isAgentActive: workspace => {
      // Definition recovery handles tombstones. Missing/deleted definitions must
      // not leave a latent activation that becomes active after a later install.
      if (!loadGlobalAgent('website-agent', options)) return true
      const path = getActivatedAgentsManifestPath(workspace.rootPath)
      if (existsSync(path)) {
        const parsed = JSON.parse(readFileSync(path, 'utf8'))
        if (parsed?.version !== 1 || !Array.isArray(parsed.active)
          || !parsed.active.every((slug: unknown) => typeof slug === 'string')
          || (parsed.deactivated !== undefined && (!Array.isArray(parsed.deactivated)
            || !parsed.deactivated.every((slug: unknown) => typeof slug === 'string')))) {
          throw new Error('Activation manifest is malformed; preserving saved choices')
        }
      }
      const manifest = readActivatedAgents(workspace.rootPath)
      return manifest.active.includes('website-agent') || Boolean(manifest.deactivated?.includes('website-agent'))
    },
    activateAgent: workspace => {
      const path = getActivatedAgentsManifestPath(workspace.rootPath)
      const backup = `${path}.before-hq-website-agent`
      if (existsSync(path) && !existsSync(backup)) copyFileSync(path, backup, constants.COPYFILE_EXCL)
      setAgentActive(workspace.rootPath, 'website-agent', true)
    },
    enabledSkillSlugs: () => [],
    enableSkill: () => {},
    warn,
  })
}
