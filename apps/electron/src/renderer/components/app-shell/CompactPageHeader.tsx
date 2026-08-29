import * as React from 'react'
import { cn } from '@/lib/utils'

export type CompactPageHeaderTone = 'orange' | 'blue' | 'emerald' | 'violet' | 'red'

const GLOBAL_HERO_BACKGROUND = [
  'radial-gradient(70% 54% at 50% 118%, rgba(155, 0, 24, 0.72) 0%, rgba(190, 0, 24, 0.22) 42%, rgba(190, 0, 24, 0) 72%)',
  'linear-gradient(90deg, #D90B16 0%, #F22409 20%, #FF5A00 50%, #F22409 80%, #D90B16 100%)',
].join(', ')

const toneClasses: Record<CompactPageHeaderTone, { surface: string; eyebrow: string }> = {
  orange: {
    surface: 'border-orange-100/[0.12]',
    eyebrow: 'text-white/58',
  },
  blue: {
    surface: 'border-orange-100/[0.12]',
    eyebrow: 'text-white/58',
  },
  emerald: {
    surface: 'border-orange-100/[0.12]',
    eyebrow: 'text-white/58',
  },
  violet: {
    surface: 'border-orange-100/[0.12]',
    eyebrow: 'text-white/58',
  },
  red: {
    surface: 'border-orange-100/[0.12]',
    eyebrow: 'text-white/58',
  },
}

export function CompactPageHeader({
  eyebrow,
  title,
  tone,
  actions,
  eyebrowAccessory,
  borderless = false,
  className,
  titleClassName,
}: {
  eyebrow: React.ReactNode
  title: React.ReactNode
  tone: CompactPageHeaderTone
  actions?: React.ReactNode
  eyebrowAccessory?: React.ReactNode
  backgroundImage?: string | null
  dimBackgroundImage?: boolean
  borderless?: boolean
  className?: string
  titleClassName?: string
}) {
  const colors = toneClasses[tone]

  return (
    <header
      className={cn(
        'relative min-h-[154px] overflow-hidden rounded-[22px]',
        !borderless && 'border',
        colors.surface,
        className,
      )}
    >
      <div className="absolute inset-0" style={{ background: GLOBAL_HERO_BACKGROUND }} />
      <div className="relative z-10 flex min-h-[154px] items-center justify-between gap-5 px-6 py-5">
        <div className="min-w-0 self-end">
          <div className="flex items-center gap-1.5">
            <p className={cn('text-[9px] font-medium uppercase tracking-[0.18em]', colors.eyebrow)}>{eyebrow}</p>
            {eyebrowAccessory}
          </div>
          <h1 className={cn('mt-1 truncate text-[30px] font-medium tracking-tight text-white/92', titleClassName)}>{title}</h1>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div> : null}
      </div>
    </header>
  )
}
