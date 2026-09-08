import * as React from 'react'
import {
  ArrowUpRight,
  BookOpenText,
  Flag,
  Layers3,
  LoaderCircle,
  Megaphone,
  Palette,
  RadioTower,
  ScanSearch,
  type LucideIcon,
} from 'lucide-react'
import type { AgentTaskModeDefinition } from '@craft-agent/shared/agent-definitions/types'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface AgentTaskModePickerDialogProps {
  open: boolean
  agentName: string
  modes: AgentTaskModeDefinition[]
  launchingModeId?: string | null
  onOpenChange: (open: boolean) => void
  onSelect: (modeId: string) => void
}

const MODE_ICONS: Record<string, LucideIcon> = {
  'brand-audit': ScanSearch,
  'narrative-universe': BookOpenText,
  'belief-worldview': Flag,
  'visual-world': Palette,
  'brand-expression': RadioTower,
  'campaign-angles': Megaphone,
  'full-brand-system': Layers3,
}

export function AgentTaskModePickerDialog({
  open,
  agentName,
  modes,
  launchingModeId,
  onOpenChange,
  onSelect,
}: AgentTaskModePickerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] w-[calc(100vw-24px)] max-w-[780px] overflow-hidden !rounded-[22px] !border !border-white/[0.09] !bg-[#070709]/98 p-0 !text-white !shadow-2xl backdrop-blur-2xl">
        <DialogHeader className="relative overflow-hidden border-b border-white/[0.065] bg-[#0b0c0f] px-6 pb-5 pt-6 text-left sm:px-7">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
          <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-[#f97316]/[0.09] blur-3xl" />
          <div className="relative">
            <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/38">
              <span className="h-1.5 w-1.5 rounded-full bg-[#fb923c] shadow-[0_0_12px_rgba(251,146,60,0.65)]" />
              {agentName}
            </div>
            <DialogTitle className="text-[26px] font-semibold leading-tight tracking-[-0.035em] text-white sm:text-[30px]">
              What are we doing?
            </DialogTitle>
            <DialogDescription className="mt-2 max-w-xl text-[13px] leading-5 text-white/48">
              Pick the main job. Your worker starts with the right branding playbook instead of loading everything.
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="max-h-[calc(88vh-150px)] overflow-y-auto p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {modes.map((mode, index) => {
              const Icon = MODE_ICONS[mode.id] ?? Layers3
              const isFull = mode.fullMode === true
              const isLaunching = launchingModeId === mode.id
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => onSelect(mode.id)}
                  disabled={Boolean(launchingModeId)}
                  className={cn(
                    'group relative isolate flex min-h-[124px] overflow-hidden rounded-[14px] border border-white/[0.075] bg-white/[0.04] p-4 text-left transition-all duration-200',
                    'hover:-translate-y-px hover:border-white/[0.15] hover:bg-white/[0.065]',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#fb923c]/65 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070709]',
                    'disabled:cursor-wait disabled:hover:translate-y-0',
                    isFull && 'sm:col-span-2 min-h-[112px] border-[#fb923c]/20 bg-[radial-gradient(120%_180%_at_0%_0%,rgba(249,115,22,0.13),rgba(255,255,255,0.035)_48%,rgba(255,255,255,0.025))]',
                  )}
                  style={{ animationDelay: `${index * 25}ms` }}
                  aria-label={`Start ${agentName} in ${mode.label} mode`}
                >
                  <span className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-70" />
                  <span className={cn(
                    'relative flex w-full gap-3.5',
                    isFull ? 'items-center' : 'items-start',
                  )}>
                    <span className={cn(
                      'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-white/[0.075] bg-black/25 text-white/62 transition-colors group-hover:text-white',
                      isFull && 'border-[#fb923c]/20 bg-[#f97316]/10 text-[#fdba74]',
                    )}>
                      {isLaunching ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-3">
                        <span className="text-[14px] font-semibold tracking-[-0.015em] text-white/92">
                          {mode.label}
                        </span>
                        <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/22 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[#fdba74]" />
                      </span>
                      <span className="mt-1.5 block max-w-[32rem] text-[11.5px] leading-[17px] text-white/46 group-hover:text-white/58">
                        {mode.description}
                      </span>
                      <span className={cn(
                        'mt-3 inline-flex text-[9px] font-semibold uppercase tracking-[0.14em] text-white/27',
                        isFull && 'text-[#fdba74]/70',
                      )}>
                        {isFull ? 'Comprehensive · slower' : 'Focused start'}
                      </span>
                    </span>
                  </span>
                </button>
              )
            })}
          </div>

          <p className="px-1 pb-0.5 pt-3.5 text-[10.5px] leading-4 text-white/28">
            You can change direction later. The worker will flag when another branding mode is the better fit.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
