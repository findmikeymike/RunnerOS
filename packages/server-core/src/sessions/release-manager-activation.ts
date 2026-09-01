import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

const STATE_VERSION = 1 as const

export interface ReleaseManagerActivationWorkspace {
  id: string
  rootPath: string
  remoteServer?: unknown
  artistWorkspaceScope?: string
}

interface ReleaseManagerActivationState {
  version: typeof STATE_VERSION
  targetWorkspaceIds: string[]
  completedWorkspaceIds: string[]
}

interface ReleaseManagerActivationOptions {
  stateFile: string
  legacyMarkerFile?: string
  workspaces: ReleaseManagerActivationWorkspace[]
  agentSlug: string
  skillSlugs: readonly string[]
  isAgentActive: (workspace: ReleaseManagerActivationWorkspace) => boolean
  activateAgent: (workspace: ReleaseManagerActivationWorkspace) => void
  enabledSkillSlugs: (workspace: ReleaseManagerActivationWorkspace) => readonly string[]
  enableSkill: (workspace: ReleaseManagerActivationWorkspace, skillSlug: string) => void
  warn?: (message: string, error?: unknown) => void
}

export interface ReleaseManagerActivationResult {
  complete: boolean
  migratedLegacyMarker: boolean
  updatedWorkspaceIds: string[]
  failedWorkspaceIds: string[]
}

function eligibleWorkspaces(workspaces: ReleaseManagerActivationWorkspace[]): ReleaseManagerActivationWorkspace[] {
  return workspaces.filter(workspace => (
    !workspace.remoteServer
    && (workspace.artistWorkspaceScope === 'hq' || workspace.artistWorkspaceScope === 'campaign')
  ))
}

function parseState(value: string): ReleaseManagerActivationState | null {
  try {
    const parsed = JSON.parse(value) as Partial<ReleaseManagerActivationState>
    if (parsed.version !== STATE_VERSION) return null
    if (!Array.isArray(parsed.targetWorkspaceIds) || !parsed.targetWorkspaceIds.every(id => typeof id === 'string')) return null
    if (!Array.isArray(parsed.completedWorkspaceIds) || !parsed.completedWorkspaceIds.every(id => typeof id === 'string')) return null
    return {
      version: STATE_VERSION,
      targetWorkspaceIds: [...new Set(parsed.targetWorkspaceIds)],
      completedWorkspaceIds: [...new Set(parsed.completedWorkspaceIds)],
    }
  } catch {
    return null
  }
}

function readState(stateFile: string): ReleaseManagerActivationState | null {
  if (!existsSync(stateFile)) return null
  try {
    return parseState(readFileSync(stateFile, 'utf8'))
  } catch {
    return null
  }
}

function writeState(stateFile: string, state: ReleaseManagerActivationState): void {
  mkdirSync(dirname(stateFile), { recursive: true })
  const tempFile = `${stateFile}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(tempFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    renameSync(tempFile, stateFile)
  } catch (error) {
    try { rmSync(tempFile, { force: true }) } catch {}
    throw error
  }
}

export function releaseManagerActivationNeedsWork(stateFile: string, legacyMarkerFile?: string): boolean {
  if (legacyMarkerFile && existsSync(legacyMarkerFile) && !existsSync(stateFile)) return false
  const state = readState(stateFile)
  if (!state) return !existsSync(stateFile)
  const completed = new Set(state.completedWorkspaceIds)
  return state.targetWorkspaceIds.some(id => !completed.has(id))
}

export function preserveReleaseManagerActivationChoices(
  stateFile: string,
  workspaces: ReleaseManagerActivationWorkspace[],
): void {
  const state = readState(stateFile)
  const targetWorkspaceIds = state?.targetWorkspaceIds ?? eligibleWorkspaces(workspaces).map(workspace => workspace.id)
  writeState(stateFile, {
    version: STATE_VERSION,
    targetWorkspaceIds,
    completedWorkspaceIds: [...targetWorkspaceIds],
  })
}

export function migrateInitialReleaseManagerActivation(
  options: ReleaseManagerActivationOptions,
): ReleaseManagerActivationResult {
  const eligible = eligibleWorkspaces(options.workspaces)
  const eligibleById = new Map(eligible.map(workspace => [workspace.id, workspace]))
  let state = readState(options.stateFile)
  let migratedLegacyMarker = false

  if (!state) {
    const targetWorkspaceIds = eligible.map(workspace => workspace.id)
    const malformedExistingState = existsSync(options.stateFile)
    const legacyMarkerExists = Boolean(options.legacyMarkerFile && existsSync(options.legacyMarkerFile))
    const priorMigrationComplete = malformedExistingState || legacyMarkerExists
    state = {
      version: STATE_VERSION,
      targetWorkspaceIds,
      completedWorkspaceIds: priorMigrationComplete ? [...targetWorkspaceIds] : [],
    }
    migratedLegacyMarker = legacyMarkerExists
    writeState(options.stateFile, state)
    if (malformedExistingState) {
      options.warn?.('Malformed Release Manager activation state was replaced without reactivating workspaces')
    }
  }

  const completed = new Set(state.completedWorkspaceIds)
  const updatedWorkspaceIds: string[] = []
  const failedWorkspaceIds: string[] = []

  for (const workspaceId of state.targetWorkspaceIds) {
    if (completed.has(workspaceId)) continue
    const workspace = eligibleById.get(workspaceId)

    // A removed workspace, or one whose scope changed, must not keep this
    // one-time migration pending forever.
    if (!workspace) {
      completed.add(workspaceId)
      state.completedWorkspaceIds = [...completed]
      writeState(options.stateFile, state)
      continue
    }

    let updated = false
    try {
      if (!options.isAgentActive(workspace)) {
        options.activateAgent(workspace)
        updated = true
      }

      const enabledSkills = new Set(options.enabledSkillSlugs(workspace))
      for (const skillSlug of options.skillSlugs) {
        if (enabledSkills.has(skillSlug)) continue
        options.enableSkill(workspace, skillSlug)
        updated = true
      }
    } catch (error) {
      failedWorkspaceIds.push(workspaceId)
      options.warn?.(`${options.agentSlug} activation skipped for workspace ${workspaceId}`, error)
      continue
    }

    completed.add(workspaceId)
    state.completedWorkspaceIds = [...completed]
    writeState(options.stateFile, state)
    if (updated) updatedWorkspaceIds.push(workspaceId)
  }

  return {
    complete: state.targetWorkspaceIds.every(id => completed.has(id)),
    migratedLegacyMarker,
    updatedWorkspaceIds,
    failedWorkspaceIds,
  }
}
