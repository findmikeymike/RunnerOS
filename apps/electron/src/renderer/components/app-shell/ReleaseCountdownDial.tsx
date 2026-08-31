import * as React from 'react'
import { cn } from '@/lib/utils'
import { getReleaseCountdown } from './release-countdown'

export function ReleaseCountdownDial({
  releaseDate,
  campaignStartDate,
  onClick,
}: {
  releaseDate?: string
  campaignStartDate?: string
  onClick: () => void
}) {
  const countdown = getReleaseCountdown(releaseDate, campaignStartDate)
  const arcDegrees = countdown.hasDate ? Math.max(22, countdown.progress * 300) : 0
  const trackStart = Math.min(300, arcDegrees + 1)
  const value = countdown.released ? 'LIVE' : countdown.daysUntil === null ? '—' : String(countdown.daysUntil)
  const label = countdown.released
    ? 'Released'
    : countdown.releaseDay
      ? 'Release day'
      : countdown.daysUntil === 1
        ? 'Day to release'
        : 'Days to release'
  const accessibleLabel = countdown.hasDate
    ? countdown.released
      ? `Released on ${countdown.dateLabel}. Edit campaign.`
      : `${countdown.daysUntil} ${countdown.daysUntil === 1 ? 'day' : 'days'} until release on ${countdown.dateLabel}. Edit campaign.`
    : 'Release date not set. Edit campaign.'

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={accessibleLabel}
      title={accessibleLabel}
      className="group relative flex h-[104px] w-[104px] shrink-0 items-center justify-center rounded-full border border-white/[0.09] bg-gradient-to-br from-[#1b1b1b] via-[#0f0f0f] to-[#020202] p-1.5 shadow-strong transition-transform hover:scale-[1.02] active:scale-[0.99]"
    >
      <span className="absolute inset-1.5 rounded-full bg-[#030303] shadow-panel-focused" />
      <span
        className="absolute inset-2.5 rounded-full opacity-95 transition-opacity group-hover:opacity-100"
        style={{
          background: countdown.hasDate
            ? `conic-gradient(from 210deg, #ffb000 0deg, #ff6a00 ${Math.max(10, arcDegrees * 0.55)}deg, #ff2700 ${arcDegrees}deg, rgba(255,255,255,0.055) ${trackStart}deg 300deg, transparent 300deg 360deg)`
            : 'conic-gradient(from 210deg, rgba(255,255,255,0.07) 0deg 300deg, transparent 300deg 360deg)',
          WebkitMask: 'radial-gradient(transparent 62%, #000 63%)',
          mask: 'radial-gradient(transparent 62%, #000 63%)',
        }}
      />
      <span className="relative z-10 flex h-[70px] w-[70px] flex-col items-center justify-center rounded-full border border-white/[0.075] bg-gradient-to-br from-[#181818] to-[#070707] shadow-strong">
        <span className="absolute inset-1.5 rounded-full border border-white/[0.035]" />
        <span className="absolute left-1/2 top-1.5 h-1 w-1 -translate-x-1/2 rounded-full bg-black shadow-xs" />
        <span className={cn(
          'relative z-10 font-light tracking-[-0.06em] text-[#ff9700]',
          countdown.released ? 'text-[14px] tracking-[0.05em]' : 'text-[27px]',
        )}>
          {value}
        </span>
        <span className="relative z-10 text-[5px] font-semibold uppercase tracking-[0.16em] text-white/64">{label}</span>
        <span className="relative z-10 mt-0.5 text-[6px] font-medium text-white/34">{countdown.dateLabel}</span>
      </span>
    </button>
  )
}
