import { LabInspirationHome } from './LabInspirationHome'

interface LabWorkspaceHomeProps {
  workspaceId?: string
  workspaceName?: string
}

export function LabWorkspaceHome({ workspaceId }: LabWorkspaceHomeProps) {
  return <LabInspirationHome workspaceId={workspaceId} />
}
