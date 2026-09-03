export type AutomationReviewWhen = 'weekly' | 'daily' | 'monthly' | 'once' | 'file' | 'webhook' | 'url' | 'message' | 'custom'

export function automationReviewSentence(input: {
  title: string
  runnerName: string
  when: AutomationReviewWhen
  scheduleLabel?: string
  requestedInputs?: string[]
  fixedInputs?: Record<string, unknown>
}): string {
  const requested = input.requestedInputs ?? []
  const cadence = input.when === 'weekly'
    ? `Every ${input.scheduleLabel || 'week'}`
    : input.when === 'daily'
      ? `Every day${input.scheduleLabel ? ` at ${timeOnly(input.scheduleLabel)}` : ''}`
      : input.when === 'monthly'
        ? input.scheduleLabel || 'Every month'
        : input.when === 'once'
          ? `Once${input.scheduleLabel ? ` on ${input.scheduleLabel}` : ''}`
          : input.when === 'file'
            ? 'When a matching file lands'
            : input.when === 'webhook'
              ? 'When the webhook arrives'
              : input.when === 'message'
                ? 'When a message matches'
          : input.when === 'url'
                  ? 'When the page changes'
                  : input.scheduleLabel || 'On your custom schedule'
  const wait = requested.length
    ? ` will wait under Needs you for ${joinHuman(requested.map(humanizeInputName))}, then run`
    : ' will run'
  const fixed = Object.entries(input.fixedInputs ?? {})
    .map(([name, value]) => `${humanizeInputName(name)} ${formatInputValue(value)}`)
  const fixedText = fixed.length ? ` with ${joinHuman(fixed)}` : ''
  const title = input.title.trim() || input.runnerName
  const runnerText = title.localeCompare(input.runnerName, undefined, { sensitivity: 'accent' }) === 0
    ? ''
    : ` using ${input.runnerName}`
  return `${cadence}, ${title}${wait}${fixedText}${runnerText}.`
}

function formatInputValue(value: unknown): string {
  if (typeof value === 'string') return `“${value}”`
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function timeOnly(label: string): string {
  return label.includes(' at ') ? label.split(' at ').slice(1).join(' at ') : label
}

function joinHuman(values: string[]): string {
  if (values.length < 2) return values[0] ?? ''
  if (values.length === 2) return `${values[0]} and ${values[1]}`
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`
}

function humanizeInputName(name: string): string {
  return name.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}
