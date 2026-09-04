/**
 * "Still working" — the difference between a wait and a freeze.
 *
 * A tool that takes 25 seconds and says nothing is indistinguishable from a
 * tool that has died. The duration is rarely the real complaint; the silence
 * is. So once the wait stops being ordinary, say so, and past a point show the
 * count too.
 *
 * It reports and never judges. A video render legitimately runs for minutes,
 * so calling a long wait "slow" would be telling the artist their working
 * render is broken. The number is the honest version: it reads the same
 * whether the tool is wedged or simply busy, and the artist can tell which
 * from what they asked for.
 *
 * Deciding a wait is *abnormal* would need a per-tool sense of normal. That is
 * worth having one day, and it would still only choose wording — nothing here
 * cancels, fails, or interrupts a call.
 *
 * Renders nothing at all below the threshold. A fast tool should stay quiet —
 * a notice on every call would be the same noise in a different key.
 */

import * as React from 'react'
import i18n from 'i18next'
import { cn } from '../../lib/utils'

/** Long enough that a normal call never trips it. */
const NOTICE_AFTER_MS = 10_000
/** Past this, start showing the count as well as the reassurance. */
const SHOW_COUNT_AFTER_MS = 45_000

/** "45s" under a minute, "2:14" above it. */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`
}

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
      {elapsed < SHOW_COUNT_AFTER_MS
        ? i18n.t('turnCard.stillWorking')
        : i18n.t('turnCard.stillWorkingLong', { duration: formatDuration(elapsed) })}
    </span>
  )
}
