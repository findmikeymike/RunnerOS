import { CONCIERGE_SLUG } from '@craft-agent/shared/agent-definitions/types'
import type { ContextDocDTO, WorkflowDTO } from '../../shared/types'

const WORKFLOW_LAUNCH_CONTEXT_SLUG = 'workflow-launch-context'

function workflowScopeLabel(workspaceKind: 'hq' | 'campaign', workspaceName: string): string {
  return workspaceKind === 'hq'
    ? `Artist HQ workspace "${workspaceName}"`
    : `campaign workspace "${workspaceName}"`
}

function formatInputList(workflow: WorkflowDTO): string[] {
  const inputs = workflow.metadata.trigger.inputs ?? []
  const required = inputs.filter((input) => input.required)
  const optional = inputs.filter((input) => !input.required)
  const lines: string[] = []

  if (required.length > 0) {
    lines.push(`Required inputs: ${required.map((input) => input.name).join(', ')}.`)
  }
  if (optional.length > 0) {
    lines.push(`Optional inputs: ${optional.map((input) => input.name).join(', ')}.`)
  }
  return lines
}

export function buildWorkflowLaunchContextDocs(
  contextDocs: ContextDocDTO[],
  workflow: WorkflowDTO,
  options: {
    workspaceKind: 'hq' | 'campaign'
    workspaceName: string
    workspaceRootPath?: string
    seededInputNames?: string[]
    contextHint?: string
  },
): ContextDocDTO[] {
  const combined = new Map(contextDocs.map((doc) => [doc.slug, doc]))
  const workspaceRootPath = options.workspaceRootPath ?? contextDocs[0]?.workspaceRootPath ?? ''
  combined.set(WORKFLOW_LAUNCH_CONTEXT_SLUG, {
    slug: WORKFLOW_LAUNCH_CONTEXT_SLUG,
    metadata: {
      name: 'Workflow Launch Context',
      description: 'Explains which workflow the artist is trying to set up and how to guide the next questions.',
      enabled: true,
      routing: { mode: 'targeted', agents: [CONCIERGE_SLUG] },
    },
    body: [
      `Workflow: ${workflow.metadata.name}`,
      `Workflow slug: ${workflow.slug}`,
      `Workspace: ${workflowScopeLabel(options.workspaceKind, options.workspaceName)}.`,
      workflow.metadata.description ? `Goal: ${workflow.metadata.description}` : null,
      ...formatInputList(workflow),
      options.seededInputNames && options.seededInputNames.length > 0
        ? `Already available from the launch surface: ${options.seededInputNames.join(', ')}.`
        : null,
      options.contextHint ?? null,
      'The artist is asking for setup help, not blind execution.',
      'Use the existing workspace context first. Ask only for missing decisions, assets, or approvals.',
      'Do not run, schedule, automate, publish, spend money, or send outreach until the artist explicitly chooses that next step.',
    ].filter(Boolean).join('\n\n'),
    path: workspaceRootPath ? `${workspaceRootPath}/context/${WORKFLOW_LAUNCH_CONTEXT_SLUG}/CONTEXT.md` : `context/${WORKFLOW_LAUNCH_CONTEXT_SLUG}/CONTEXT.md`,
    workspaceRootPath,
  })
  return [...combined.values()]
}

export function createWorkflowSetupDraft(
  workflow: WorkflowDTO,
  options: {
    workspaceKind: 'hq' | 'campaign'
    workspaceName: string
    seededInputNames?: string[]
    contextHint?: string
  },
): string {
  const scope = options.workspaceKind === 'hq'
    ? `my Artist HQ workspace "${options.workspaceName}"`
    : `my campaign workspace "${options.workspaceName}"`
  const inputs = workflow.metadata.trigger.inputs ?? []
  const missingPrompt = inputs.length > 0
    ? `The workflow may need inputs like ${inputs.map((input) => input.name).join(', ')}.`
    : 'If this workflow still needs any inputs, ask only for the missing decisions.'

  return [
    `I want to set up the ${workflow.metadata.name} workflow in ${scope}.`,
    workflow.metadata.description ? workflow.metadata.description : null,
    'Use the workspace context and any approved assets that are already available before asking me to repeat anything.',
    options.seededInputNames && options.seededInputNames.length > 0
      ? `Inputs already seeded from the UI: ${options.seededInputNames.join(', ')}.`
      : null,
    options.contextHint ?? null,
    missingPrompt,
    'Help me think through the strongest setup, ask only the key questions you still need, then let me decide whether to run it now or schedule it.',
    'Do not start the workflow, schedule it, automate it, or take any public action until I explicitly confirm.',
  ].filter(Boolean).join('\n\n')
}
