import { parseSharedIntelNote } from '@craft-agent/shared/shared-intel'

export function signalDocumentDate(body: string): string | undefined {
  const sharedIntel = parseSharedIntelNote(body)
  if (sharedIntel?.updatedAt) return sharedIntel.updatedAt
  return body.match(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/)?.[0]
}

export function readableSignalBody(body: string): string {
  const withoutMachinePayload = body.replace(/```json shared-intel\s*\n[\s\S]*?\n```\s*/i, '')
  return withoutMachinePayload.trim() || body.trim()
}

export function formatSignalDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  }).format(date)
}

export function appendSignalNugget(
  currentBody: string | undefined,
  input: { text: string; sourceTitle: string; sourceKey: string; amendedAt: string },
): string {
  const amendedLabel = `_Last amended: ${input.amendedAt}_`
  let base = currentBody?.trim()
    || `# Signal Nuggets\n\n${amendedLabel}\n\nSelected intelligence worth carrying into future artist and campaign work.`
  if (/_Last amended: [^\n]+_/.test(base)) {
    base = base.replace(/_Last amended: [^\n]+_/, amendedLabel)
  } else if (base.startsWith('# Signal Nuggets')) {
    base = base.replace('# Signal Nuggets', `# Signal Nuggets\n\n${amendedLabel}`)
  } else {
    base = `# Signal Nuggets\n\n${amendedLabel}\n\n${base}`
  }
  const quote = input.text.split('\n').map((line) => `> ${line}`).join('\n')
  return [
    base,
    '',
    `## ${formatSignalDate(input.amendedAt)} · ${input.sourceTitle}`,
    '',
    quote,
    '',
    `<!-- signal-source: ${input.sourceKey} -->`,
  ].join('\n')
}
