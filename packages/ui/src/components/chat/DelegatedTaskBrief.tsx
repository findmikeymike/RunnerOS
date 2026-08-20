import { ClipboardList } from 'lucide-react'
import { cn } from '../../lib/utils'

export interface DelegatedTaskBriefData {
  task: string
  context?: string
  expectedOutput?: string
}

export interface DelegatedTaskBriefProps {
  content: string
  className?: string
}

const DELEGATION_PROMPT_PREFIX = 'You are executing a delegated RunnerOS agent message.'
const SECTION_LABELS = ['Task', 'Context', 'Expected output', 'Allowed source slugs', 'Requested skill slugs'] as const

function extractSection(content: string, label: typeof SECTION_LABELS[number]): string | undefined {
  const marker = `\n${label}:\n`
  const start = content.indexOf(marker)
  if (start === -1) return undefined

  const valueStart = start + marker.length
  const nextStarts = SECTION_LABELS
    .filter(candidate => candidate !== label)
    .map(candidate => content.indexOf(`\n\n${candidate}:`, valueStart))
    .filter(index => index !== -1)
  const instructionStart = content.indexOf('\n\nReturn only the requested result.', valueStart)
  if (instructionStart !== -1) nextStarts.push(instructionStart)

  const valueEnd = nextStarts.length > 0 ? Math.min(...nextStarts) : content.length
  return content.slice(valueStart, valueEnd).trim() || undefined
}

export function isDelegatedAgentPrompt(content: string): boolean {
  return content.startsWith(DELEGATION_PROMPT_PREFIX)
}

export function parseDelegatedTaskBrief(content: string): DelegatedTaskBriefData | null {
  if (!isDelegatedAgentPrompt(content)) return null
  const task = extractSection(content, 'Task')
  if (!task) return null

  return {
    task,
    context: extractSection(content, 'Context'),
    expectedOutput: extractSection(content, 'Expected output'),
  }
}

export function DelegatedTaskBrief({ content, className }: DelegatedTaskBriefProps) {
  const brief = parseDelegatedTaskBrief(content)
  if (!brief) return null

  return (
    <div className={cn('flex w-full justify-end', className)}>
      <div className="max-w-[80%] rounded-[12px] border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-white/76">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-white/42">
          <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Assigned task</span>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{brief.task}</p>
        {(brief.context || brief.expectedOutput) && (
          <div className="mt-2.5 space-y-1.5 border-t border-white/[0.06] pt-2 text-xs text-white/48">
            {brief.context && <p><span className="text-white/62">Context:</span> {brief.context}</p>}
            {brief.expectedOutput && <p><span className="text-white/62">Expected:</span> {brief.expectedOutput}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
