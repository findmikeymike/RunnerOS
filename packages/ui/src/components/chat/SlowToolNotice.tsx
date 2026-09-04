/**
 * "Still working" — the difference between a wait and a freeze.
 *
 * A tool that takes 25 seconds and says nothing is indistinguishable from a
 * tool that has died. The duration is rarely the real complaint; the silence
 * is. So say something once the wait stops being ordinary, and say plainly
 * when it stops being reasonable.
 *
 * Renders nothing at all below the threshold. A fast tool should stay quiet —
 * a notice on every call would be the same noise in a different key.
 */

import * as React from 'react'
import i18n from 'i18next'
import { cn } from '../../lib/utils'

/** Long enough that a normal call never trips it. */
const NOTICE_AFTER_MS = 10_000
/** Past this, stop reassuring and admit it is unusual. */
const UNUSUAL_AFTER_MS = 45_000

export interface SlowToolNoticeProps {
  /** When the tool call started. `ActivityItem.timestamp`. */
  startedAt: number
  /** Only a running tool is worth waiting on. */
  running: boolean
  className?: string
}

export function SlowToolNotice({ startedAt, running, className }: SlowToolNoticeProps) {
  const [now, setNow] = React.useState(() => Date.now())

  React.useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [running])

  if (!running) return null

  // Derived from the start time rather than a counter, so a row that mounts
  // late — scrolled back into view, re-rendered — reports the true wait.
  const elapsed = now - startedAt
  if (!Number.isFinite(elapsed) || elapsed < NOTICE_AFTER_MS) return null

  return (
    <span className={cn('shrink-0 text-muted-foreground/70 tabular-nums', className)}>
      {elapsed < UNUSUAL_AFTER_MS
        ? i18n.t('turnCard.stillWorking')
        : i18n.t('turnCard.stillWorkingLong', { seconds: Math.floor(elapsed / 1000) })}
    </span>
  )
}
