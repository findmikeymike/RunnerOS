import { parseSharedIntelNote } from '@craft-agent/shared/shared-intel'
import { stripMarkdown } from '../utils/text'

interface SignalOutputTextRef {
  id: string
  summary?: string
  preview?: { assetId?: string; inlineText?: string }
}

interface SignalOutputManifestRef {
  primaryAssetId?: string
  primary?: { id?: string }
}

export function signalPreviewText(content: string): string {
  return stripMarkdown(content).split(/\s+/).slice(0, 120).join(' ')
}

export async function loadFullSignalOutputText(input: {
  output: SignalOutputTextRef
  getOutput: (outputId: string) => Promise<SignalOutputManifestRef | null>
  readAssetText: (outputId: string, assetId?: string) => Promise<string>
}): Promise<string> {
  const manifest = await input.getOutput(input.output.id)
  const assetId = manifest?.primaryAssetId || manifest?.primary?.id
  if (!assetId) throw new Error('The full report file is unavailable.')
  const content = await input.readAssetText(input.output.id, assetId)
  if (!content.trim()) throw new Error('The full report file is empty.')
  return content
}

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

export function signalFreshness(
  value: string | undefined,
  now = new Date(),
): { status: 'fresh' | 'aging' | 'stale'; ageDays: number } | null {
  if (!value) return null
  const generatedAt = new Date(value)
  if (Number.isNaN(generatedAt.getTime())) return null
  const ageDays = Math.max(0, Math.floor((now.getTime() - generatedAt.getTime()) / 86_400_000))
  return {
    status: ageDays <= 8 ? 'fresh' : ageDays <= 14 ? 'aging' : 'stale',
    ageDays,
  }
}

export function appendSignalNugget(
  currentBody: string | undefined,
  input: { text: string; sourceTitle: string; sourceKey: string; amendedAt: string; track?: 'industry' | 'your-world'; outputId?: string },
): string {
  const amendedLabel = `_Last amended: ${input.amendedAt}_`
  let base = currentBody?.trim()
    || `# Saved insights\n\n${amendedLabel}\n\nSelected intelligence worth carrying into future artist and campaign work.`
  if (/_Last amended: [^\n]+_/.test(base)) {
    base = base.replace(/_Last amended: [^\n]+_/, amendedLabel)
  } else if (/^# (?:Signal Nuggets|Saved insights)\b/.test(base)) {
    base = base.replace(/^# (?:Signal Nuggets|Saved insights)\b/, (heading) => `${heading}\n\n${amendedLabel}`)
  } else {
    base = `# Saved insights\n\n${amendedLabel}\n\n${base}`
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
    ...(input.track ? [`<!-- signal-track: ${input.track}${input.outputId ? `; output: ${input.outputId}` : ''} -->`] : []),
  ].join('\n')
}
