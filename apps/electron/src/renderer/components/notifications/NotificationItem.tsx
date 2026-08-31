/**
 * NotificationItem
 *
 * One row inside the BellMenu popover. Surfaces a Pulse / system notification
 * with acknowledge / dismiss / reply / open-run affordances.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { NotificationEntry } from '@/atoms/notifications'

const MAX_PREVIEW_CHARS = 200

function relativeTime(iso: string | undefined): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'now'
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`
  return `${Math.floor(ms / 86_400_000)}d`
}

interface NotificationItemProps {
  entry: NotificationEntry
  onAcknowledge: (id: string) => void
  onClear: (id: string) => void
  onRespond: (id: string, text: string) => void
  onOpenRun?: (runId: string) => void
}

export function NotificationItem({
  entry,
  onAcknowledge,
  onClear,
  onRespond,
  onOpenRun,
}: NotificationItemProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = React.useState(false)
  const [reply, setReply] = React.useState('')

  const Icon = entry.source === 'pulse' ? Activity : Bell

  const message = entry.message ?? ''
  const truncated = !expanded && message.length > MAX_PREVIEW_CHARS
  const preview = truncated ? message.slice(0, MAX_PREVIEW_CHARS) + '…' : message

  const urgencyTint =
    entry.urgency === 'high'
      ? 'bg-red-500/[0.06] border-l-red-500/40'
      : entry.urgency === 'normal'
        ? 'bg-blue-500/[0.05] border-l-blue-500/40'
        : 'border-l-white/15 bg-white/[0.02]'

  const title = entry.title ?? (entry.source === 'pulse' ? 'Pulse' : 'Notification')
  const isAcknowledged = !!entry.acknowledgedAt

  return (
    <div
      className={cn(
        'border-l-2 px-3 py-2 text-sm text-white',
        urgencyTint,
        isAcknowledged && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/60" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-[13px] truncate">{title}</span>
            <span className="shrink-0 text-[11px] text-white/50">
              {relativeTime(entry.createdAt)}
            </span>
            {entry.goalSlug && (
              <span className="truncate rounded bg-white/8 px-1.5 py-0.5 text-[10px] font-medium text-white/60">
                {entry.goalSlug}
              </span>
            )}
          </div>
          {message && (
            <button
              type="button"
              onClick={() => truncated && setExpanded(true)}
              className={cn(
                'mt-1 block whitespace-pre-wrap break-words text-left text-[12px] text-white/75',
                truncated && 'cursor-pointer hover:text-white',
              )}
            >
              {preview}
            </button>
          )}

          {entry.awaitingResponse && !entry.userResponse && (
            <div className="mt-2 flex items-center gap-1.5">
              <input
                type="text"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={t('notifications.replyPlaceholder')}
                className="h-7 flex-1 rounded-md border border-white/15 bg-black/40 px-2 text-[12px] text-white outline-none placeholder:text-white/35 focus:border-accent/60"
              />
              <Button
                size="sm"
                className="h-7 text-[11px]"
                disabled={!reply.trim()}
                onClick={() => {
                  const text = reply.trim()
                  if (!text) return
                  onRespond(entry.id, text)
                  setReply('')
                }}
              >
                {t('notifications.reply')}
              </Button>
            </div>
          )}

          <div className="mt-2 flex items-center gap-1.5 text-[11px]">
            {entry.workflowRunId && onOpenRun && (
              <button
                type="button"
                onClick={() => onOpenRun(entry.workflowRunId!)}
                className="rounded-md px-2 py-0.5 text-white/70 hover:bg-white/5 hover:text-white"
              >
                {t('notifications.openRun')}
              </button>
            )}
            {!isAcknowledged && (
              <button
                type="button"
                onClick={() => onAcknowledge(entry.id)}
                className="rounded-md px-2 py-0.5 text-white/70 hover:bg-white/5 hover:text-white"
              >
                {t('notifications.acknowledge')}
              </button>
            )}
            <button
              type="button"
              onClick={() => onClear(entry.id)}
              className="rounded-md px-2 py-0.5 text-white/50 hover:bg-white/5 hover:text-white/80"
            >
              {t('notifications.dismiss')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
