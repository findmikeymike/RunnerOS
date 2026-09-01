import type { WorkflowTriggerInput } from '@craft-agent/shared/workflows'

export type WorkflowInputControl = 'short-text' | 'long-text' | 'number' | 'boolean' | 'asset'

const EXPLICIT_ASSET_INPUTS = new Set([
  'merch-product-builder:artwork',
  'merch-product-builder:artist_reference',
])

const LONG_TEXT_NAMES = /(?:brief|goal|body|context|elements|preferences|assets|lanes|platforms|territories|markets|sound_alikes)$/

export function humanizeWorkflowInputName(name: string): string {
  const words = name.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : 'Input'
}

export function workflowInputControl(workflowSlug: string, input: WorkflowTriggerInput): WorkflowInputControl {
  if (EXPLICIT_ASSET_INPUTS.has(`${workflowSlug}:${input.name}`)) return 'asset'
  if (input.type === 'boolean') return 'boolean'
  if (input.type === 'number') return 'number'
  return LONG_TEXT_NAMES.test(input.name) ? 'long-text' : 'short-text'
}

export function orderWorkflowInputs(inputs: readonly WorkflowTriggerInput[]): {
  required: WorkflowTriggerInput[]
  optional: WorkflowTriggerInput[]
} {
  return {
    required: inputs.filter((input) => input.required),
    optional: inputs.filter((input) => !input.required),
  }
}

export function validateWorkflowInputValues(
  inputs: readonly WorkflowTriggerInput[],
  values: Record<string, string | number | boolean>,
): { inputName: string; message: string } | null {
  for (const input of inputs) {
    const value = values[input.name]
    const label = humanizeWorkflowInputName(input.name)
    if (input.required && (value === '' || value === undefined || value === null)) {
      return { inputName: input.name, message: `${label} is required.` }
    }
    if (value === '' || value === undefined || value === null || input.type !== 'number') continue
    if (typeof value !== 'number' || !Number.isFinite(value)) return { inputName: input.name, message: `${label} must be a number.` }
    if (input.integer && !Number.isInteger(value)) return { inputName: input.name, message: `${label} must be a whole number.` }
    if (input.min !== undefined && value < input.min) return { inputName: input.name, message: `${label} must be at least ${input.min}.` }
    if (input.max !== undefined && value > input.max) return { inputName: input.name, message: `${label} must be at most ${input.max}.` }
  }
  for (const input of inputs) {
    if (!input.maxFrom) continue
    const value = values[input.name]
    const ceiling = values[input.maxFrom]
    if (typeof value === 'number' && typeof ceiling === 'number' && value > ceiling) {
      return {
        inputName: input.name,
        message: `${humanizeWorkflowInputName(input.name)} cannot be greater than ${humanizeWorkflowInputName(input.maxFrom).toLowerCase()} (${ceiling}).`,
      }
    }
  }
  return null
}

export function workflowNumberMax(
  input: WorkflowTriggerInput,
  values: Record<string, string | number | boolean>,
): number | undefined {
  const referenced = input.maxFrom ? values[input.maxFrom] : undefined
  if (typeof referenced !== 'number' || !Number.isFinite(referenced)) return input.max
  return input.max === undefined ? referenced : Math.min(input.max, referenced)
}

export function workflowOutputAssetPath(
  workspaceRootPath: string,
  outputId: string,
  assetPath: string,
): string {
  if (/^(?:\/|[A-Za-z]:[\\/])/.test(assetPath)) return assetPath
  const separator = workspaceRootPath.includes('\\') ? '\\' : '/'
  const clean = (part: string) => part.replace(/^[\\/]+|[\\/]+$/g, '')
  return [workspaceRootPath.replace(/[\\/]+$/g, ''), 'outputs', clean(outputId), clean(assetPath)].join(separator)
}
