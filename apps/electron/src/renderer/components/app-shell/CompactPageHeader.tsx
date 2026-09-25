import * as React from 'react'
import { cn } from '@/lib/utils'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import { isArtistCampaignWorkspace, isArtistHQWorkspace, isLabWorkspace } from '@/lib/artist-workspace'

export type CompactPageHeaderTone = 'orange' | 'blue' | 'emerald' | 'violet' | 'red'

export const LAB_HERO_BACKGROUND = [
  'radial-gradient(70% 54% at 50% 118%, rgba(10, 24, 115, 0.72) 0%, rgba(15, 42, 145, 0.22) 42%, rgba(15, 42, 145, 0) 72%)',
  'linear-gradient(90deg, #173FC4 0%, #2465ED 20%, #38A4F5 50%, #2465ED 80%, #173FC4 100%)',
].join(', ')

const GLOBAL_HERO_BACKGROUND = [
  'radial-gradient(70% 54% at 50% 118%, rgba(155, 0, 24, 0.72) 0%, rgba(190, 0, 24, 0.22) 42%, rgba(190, 0, 24, 0) 72%)',
  'linear-gradient(90deg, #D90B16 0%, #F22409 20%, #FF5A00 50%, #F22409 80%, #D90B16 100%)',
].join(', ')

const CAMPAIGN_HERO_BACKGROUND = [
  'radial-gradient(70% 54% at 50% 118%, rgba(0, 82, 61, 0.72) 0%, rgba(0, 110, 80, 0.22) 42%, rgba(0, 110, 80, 0) 72%)',
  'linear-gradient(90deg, #008A60 0%, #009C78 20%, #20BF91 50%, #009C78 80%, #008A60 100%)',
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
  compact = false,
  hero = false,
  className,
  titleClassName,
  backgroundImage,
  backgroundGradient,
  dimBackgroundImage = false,
}: {
  eyebrow: React.ReactNode
  title: React.ReactNode
  tone: CompactPageHeaderTone
  actions?: React.ReactNode
  eyebrowAccessory?: React.ReactNode
  backgroundImage?: string | null
  backgroundGradient?: string
  dimBackgroundImage?: boolean
  borderless?: boolean
  compact?: boolean
  hero?: boolean
  className?: string
  titleClassName?: string
}) {
  const shell = useOptionalAppShellContext()
  const workspace = shell?.workspaces.find(item => item.id === shell.activeWorkspaceId)
  const labTheme = !!workspace && isLabWorkspace(workspace, shell?.workspaces ?? [])
  const campaignTheme = !labTheme
    && !isArtistHQWorkspace(workspace, shell?.workspaces ?? [])
    && isArtistCampaignWorkspace(workspace)
  const workspaceBackground = labTheme ? LAB_HERO_BACKGROUND : campaignTheme ? CAMPAIGN_HERO_BACKGROUND : GLOBAL_HERO_BACKGROUND
  const colors = toneClasses[tone]

  return (
    <header
      className={cn(
        'relative overflow-hidden rounded-[22px]',
        hero ? 'min-h-[240px]' : compact ? 'min-h-[80px]' : 'min-h-[108px]',
        !borderless && 'border',
        labTheme ? 'border-sky-100/[0.12]' : campaignTheme ? 'border-emerald-100/[0.12]' : colors.surface,
        className,
      )}
    >
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={backgroundImage
          ? { backgroundImage: `url(${JSON.stringify(backgroundImage)})` }
          : { background: backgroundGradient ?? workspaceBackground }}
      />
      {backgroundImage ? (
        <div
          className={cn(
            'absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.04)_0%,rgba(0,0,0,0.18)_46%,rgba(0,0,0,0.82)_100%)]',
            dimBackgroundImage && 'bg-black/45',
          )}
        />
      ) : null}
      <div className={cn(
        'relative z-10 flex justify-between gap-5 px-6',
        hero ? 'min-h-[240px] items-end py-6' : compact ? 'min-h-[80px] items-center py-3' : 'min-h-[108px] items-center py-4',
      )}>
        <div className="min-w-0 self-end">
          <div className="flex items-center gap-1.5">
            <p className={cn('text-[9px] font-medium uppercase tracking-[0.18em]', colors.eyebrow)}>{eyebrow}</p>
            {eyebrowAccessory}
          </div>
          <h1 className={cn('mt-1 truncate font-medium tracking-tight text-white/92', hero ? 'text-[52px]' : 'text-[26px]', titleClassName)}>{title}</h1>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div> : null}
      </div>
    </header>
  )
}
