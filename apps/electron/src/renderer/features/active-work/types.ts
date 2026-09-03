import type { ScheduledWorkInputRequest } from '@craft-agent/shared/scheduled-work'

export type ActiveWorkSection = 'running' | 'attention' | 'up-next' | 'paused'
export type ActiveWorkSource = 'session' | 'workflow-run' | 'scheduled-work' | 'automation'

export type ActiveWorkOpenTarget =
  | { kind: 'session'; id: string }
  | { kind: 'workflow-run'; id: string }
  | { kind: 'scheduled-work'; id: string }
  | { kind: 'automation'; id: string }

export interface ActiveWorkItem {
  id: string
  source: ActiveWorkSource
  sourceId: string
  workspaceId: string
  section: ActiveWorkSection
  title: string
  subtitle?: string
  statusLabel: string
  cadenceLabel?: string
  originLabel?: string
  sortAt?: string
  updatedAt?: string
  attentionReason?: string
  inputRequest?: ScheduledWorkInputRequest
  openTarget: ActiveWorkOpenTarget
}
