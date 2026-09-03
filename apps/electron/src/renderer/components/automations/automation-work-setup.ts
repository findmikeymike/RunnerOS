import type { WorkflowInputBinding, WorkflowInputTriggerSource } from '@craft-agent/shared/automations'
import { automationReviewSentence as sharedAutomationReviewSentence } from '@craft-agent/shared/automations/review-sentence'
import type { WorkflowTriggerInput } from '@craft-agent/shared/workflows'

export type AutomationWhen = 'weekly' | 'daily' | 'monthly' | 'once' | 'file' | 'webhook' | 'url' | 'message' | 'custom'

export function initialWorkflowInputBindings(
  inputs: readonly WorkflowTriggerInput[],
  prefilled: Record<string, unknown> = {},
): Record<string, WorkflowInputBinding> {
  return Object.fromEntries(inputs.flatMap((input): Array<[string, WorkflowInputBinding]> => {
    if (Object.prototype.hasOwnProperty.call(prefilled, input.name)) {
      return [[input.name, { mode: 'fixed', value: prefilled[input.name] }]]
    }
    if (input.default !== undefined) return [[input.name, { mode: 'fixed', value: input.default }]]
    if (input.required) return [[input.name, { mode: 'ask' }]]
    return []
  }))
}

export function triggerSourcesForInput(
  when: AutomationWhen,
  input: WorkflowTriggerInput,
): Array<{ source: WorkflowInputTriggerSource; label: string }> {
  if (input.type !== 'string') return []
  if (when === 'file') return [
    { source: 'file.path', label: 'From file path' },
    { source: 'file.name', label: 'From file name' },
  ]
  if (when === 'webhook') return [{ source: 'webhook.body', label: 'From webhook' }]
  if (when === 'message') return [{ source: 'message.text', label: 'From message' }]
  if (when === 'url') return [{ source: 'url.content', label: 'From page content' }]
  return []
}

export function reconcileBindingsForWhen(
  inputs: readonly WorkflowTriggerInput[],
  bindings: Record<string, WorkflowInputBinding>,
  when: AutomationWhen,
): Record<string, WorkflowInputBinding> {
  const next = { ...bindings }
  for (const input of inputs) {
    const binding = next[input.name]
    if (binding?.mode === 'trigger' && !triggerSourcesForInput(when, input).some(({ source }) => source === binding.from)) {
      next[input.name] = input.required ? { mode: 'ask' } : { mode: 'fixed', value: fixedValueWhenSelected(input, binding) }
    }
  }
  if (when === 'file' && !Object.values(next).some((binding) => binding.mode === 'trigger')) {
    const available = (input: WorkflowTriggerInput) => {
      const binding = next[input.name]
      return !binding || binding.mode === 'ask' || binding.mode === 'fixed'
    }
    const fileLike = (input: WorkflowTriggerInput) => input.name
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .split(/[^a-zA-Z0-9]+/)
      .some((token) => ['file', 'path', 'asset'].includes(token.toLowerCase()))
    const candidate = inputs.find((input) => input.required && input.type === 'string' && available(input) && fileLike(input))
    if (candidate) next[candidate.name] = { mode: 'trigger', from: 'file.path' }
  }
  return next
}

export function fixedValueWhenSelected(
  input: WorkflowTriggerInput,
  currentBinding?: WorkflowInputBinding,
): unknown {
  if (currentBinding?.mode === 'fixed') return currentBinding.value
  return input.default !== undefined ? input.default : ''
}

export function fixedTriggerInputs(bindings: Record<string, WorkflowInputBinding>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(bindings).flatMap(([name, binding]) => (
    binding.mode === 'fixed' && binding.value !== '' && binding.value !== undefined && binding.value !== null
      ? [[name, binding.value]]
      : []
  )))
}

export function compactWorkflowInputBindings(
  inputs: readonly WorkflowTriggerInput[],
  bindings: Record<string, WorkflowInputBinding>,
): Record<string, WorkflowInputBinding> {
  const definitions = new Map(inputs.map((input) => [input.name, input]))
  return Object.fromEntries(Object.entries(bindings).filter(([name, binding]) => {
    const definition = definitions.get(name)
    if (!definition) return false
    return definition.required || binding.mode !== 'fixed' || (binding.value !== '' && binding.value !== undefined && binding.value !== null)
  }))
}

export function requestedInputNames(bindings: Record<string, WorkflowInputBinding>): string[] {
  return Object.entries(bindings).flatMap(([name, binding]) => binding.mode === 'ask' ? [name] : [])
}

export function validateWorkflowInputBindings(
  inputs: readonly WorkflowTriggerInput[],
  bindings: Record<string, WorkflowInputBinding>,
  when: AutomationWhen,
): string | undefined {
  const fixedValues = fixedTriggerInputs(bindings)
  for (const input of inputs) {
    const binding = bindings[input.name]
    if (input.required && !binding) return `Choose how to supply ${input.name}.`
    if (!binding) continue
    if (!input.required && binding.mode === 'ask') return `${input.name} is optional and cannot pause every run.`
    if (binding.mode === 'trigger' && !triggerSourcesForInput(when, input).some(({ source }) => source === binding.from)) {
      return `${input.name} cannot come from this trigger.`
    }
    if (binding.mode !== 'fixed') continue
    const value = binding.value
    if (input.required && (value === '' || value === undefined || value === null)) return `Add ${input.name} or ask for it each time.`
    if (value === '' || value === undefined || value === null || input.type !== 'number') continue
    if (typeof value !== 'number' || !Number.isFinite(value)) return `${input.name} must be a number.`
    if (input.integer && !Number.isInteger(value)) return `${input.name} must be a whole number.`
    if (input.min !== undefined && value < input.min) return `${input.name} must be at least ${input.min}.`
    if (input.max !== undefined && value > input.max) return `${input.name} must be at most ${input.max}.`
  }
  for (const input of inputs) {
    if (!input.maxFrom) continue
    const value = fixedValues[input.name]
    const maximum = fixedValues[input.maxFrom]
    if (typeof value === 'number' && typeof maximum === 'number' && value > maximum) {
      return `${input.name} cannot be greater than ${input.maxFrom}.`
    }
  }
  return undefined
}

export function automationReviewSentence(input: {
  title: string
  runnerName: string
  when: AutomationWhen
  scheduleLabel?: string
  requestedInputs?: string[]
  fixedInputs?: Record<string, unknown>
}): string {
  return sharedAutomationReviewSentence(input)
}
