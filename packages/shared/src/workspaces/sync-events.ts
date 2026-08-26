export type WorkspaceSyncArea =
  | 'workspace'
  | 'team'
  | 'context'
  | 'records'
  | 'outputs'
  | 'workflow-runs'
  | 'deep-research'
  | 'workflows'
  | 'agents'
  | 'automations'
  | 'pulses'
  | 'notifications'
  | 'vault'
  | 'agent-messages'
  | 'labels'
  | 'statuses'
  | 'permissions'

export interface WorkspaceSyncChange {
  workspaceId: string
  areas: WorkspaceSyncArea[]
  detectedAt: string
}

const TEMP_FILE_PATTERN = /(?:^|\/)(?:\.DS_Store|Thumbs\.db|[^/]+\.(?:tmp|temp|partial|crdownload)|~\$[^/]+)$/i

/** Classify a provider-delivered workspace-relative path into a UI refresh area. */
export function classifyWorkspaceSyncPath(relativePath: string): WorkspaceSyncArea | null {
  return classifyWorkspaceSyncAreas(relativePath)[0] ?? null
}

/** Some files affect more than one surface (record ops also affect Team health). */
export function classifyWorkspaceSyncAreas(relativePath: string): WorkspaceSyncArea[] {
  const path = relativePath.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!path || TEMP_FILE_PATTERN.test(path)) return []

  const root = path.split('/')[0]!
  if (root === 'team') {
    return /^team\/(?:record-ops|record-payloads|oplog|conflicts)(?:\/|$)/.test(path)
      ? ['team', 'records']
      : ['team']
  }
  if (root === 'context') return ['context']
  if (root === 'records') return ['records']
  if (root === 'outputs') return ['outputs']
  if (root === 'runs') return ['workflow-runs']
  if (root === 'deep-research-runs') return ['deep-research']
  if (root === 'pulses') return ['pulses']
  if (root === 'vault' || root === 'assets') return ['vault']
  if (root === 'agent-messages') return ['agent-messages']
  if (path === 'activated-workflows.json') return ['workflows']
  if (path === 'activated-agents.json') return ['agents']
  if (path === 'automations.json') return ['automations']
  if (path === 'automations-history.jsonl' || path === 'automations-retry-queue.jsonl') return ['automations']
  if (path === 'notifications.json') return ['notifications']
  if (path === 'config.json') return ['workspace']
  return []
}
