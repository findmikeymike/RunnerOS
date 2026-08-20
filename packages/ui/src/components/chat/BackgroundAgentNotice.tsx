import { CheckCircle2, CircleAlert, ExternalLink, LoaderCircle } from 'lucide-react'
import type { AgentMessageNoticeMetadata } from '@craft-agent/core'
import { cn } from '../../lib/utils'

export interface BackgroundAgentNoticeProps {
  agentMessage?: AgentMessageNoticeMetadata
  onOpen?: (sessionId: string) => void
  className?: string
}

function formatAgentName(slug?: string): string {
  if (!slug) return 'Background agent'
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function getBackgroundAgentStatusText(agentMessage?: AgentMessageNoticeMetadata): string {
  const name = formatAgentName(agentMessage?.targetAgentSlug)

  switch (agentMessage?.status) {
    case 'succeeded':
      return `${name} finished`
    case 'failed':
      return `${name} needs attention`
    case 'cancelled':
      return `${name} was stopped`
    case 'timed-out':
      return `${name} timed out`
    case 'running':
    default:
      return `${name} is working in the background`
  }
}

export function BackgroundAgentNotice({ agentMessage, onOpen, className }: BackgroundAgentNoticeProps) {
  const status = agentMessage?.status ?? 'running'
  const childSessionId = agentMessage?.childSessionId
  const isRunning = status === 'running'
  const isSuccessful = status === 'succeeded'
  const StatusIcon = isRunning ? LoaderCircle : isSuccessful ? CheckCircle2 : CircleAlert

  return (
    <div
      className={cn(
        'flex max-w-[90%] items-center gap-2.5 rounded-[10px] border border-white/[0.08] bg-white/[0.035] px-3 py-2 text-[13px] text-white/68',
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <StatusIcon
        className={cn(
          'h-3.5 w-3.5 shrink-0',
          isRunning && 'animate-spin text-white/45',
          isSuccessful && 'text-emerald-400/75',
          !isRunning && !isSuccessful && 'text-amber-400/80',
        )}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate font-medium">
        {getBackgroundAgentStatusText(agentMessage)}
      </span>
      {childSessionId && onOpen && (
        <button
          type="button"
          onClick={() => onOpen(childSessionId)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[7px] border border-white/[0.08] bg-white/[0.045] px-2 py-1 text-[11px] text-white/62 transition-colors hover:bg-white/[0.075] hover:text-white/82"
        >
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
          <span>Open background agent</span>
        </button>
      )}
    </div>
  )
}
