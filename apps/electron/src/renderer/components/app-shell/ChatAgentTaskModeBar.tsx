import * as React from 'react'
import { LoaderCircle } from 'lucide-react'
import type { AgentTaskModeDefinition } from '@craft-agent/shared/agent-definitions/types'
import { cn } from '@/lib/utils'

interface ChatAgentTaskModeBarProps {
  modes: AgentTaskModeDefinition[]
  selectedModeId?: string
  applyingModeId?: string | null
  onSelect: (modeId: string) => void
}

export function ChatAgentTaskModeBar({
  modes,
  selectedModeId,
  applyingModeId,
  onSelect,
}: ChatAgentTaskModeBarProps) {
  return (
    <div className="shrink-0 border-b border-white/[0.055] bg-[#08090b]/72 px-3 py-2.5 @xs/panel:px-4">
      <div className="mx-auto max-w-3xl">
        <div className="mb-1.5 flex items-baseline gap-2">
          <span className="text-[11px] font-medium text-white/72">What are we doing?</span>
          <span className="text-[10px] text-white/30">
            {selectedModeId ? 'Focus selected' : 'Choose a focus to start'}
          </span>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {modes.map((mode) => {
            const selected = selectedModeId === mode.id
            const applying = applyingModeId === mode.id
            const label = mode.fullMode ? 'General / all' : mode.label
            return (
              <button
                key={mode.id}
                type="button"
                title={mode.description}
                aria-pressed={selected}
                onClick={() => onSelect(mode.id)}
                disabled={Boolean(applyingModeId)}
                className={cn(
                  'group flex h-10 min-w-[98px] shrink-0 items-center justify-between gap-2 rounded-[9px] border px-2.5 text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff8063]/55 focus-visible:ring-offset-1 focus-visible:ring-offset-[#08090b]',
                  'disabled:cursor-wait',
                  selected
                    ? 'border-[#ff8063]/40 bg-[#ff8063]/10 text-white shadow-hairline-top'
                    : 'border-white/[0.075] bg-white/[0.025] text-white/55 hover:border-white/[0.14] hover:bg-white/[0.05] hover:text-white/88',
                )}
              >
                <span className="max-w-[132px] text-[10.5px] font-medium leading-[13px] tracking-[-0.005em]">
                  {label}
                </span>
                {applying ? (
                  <LoaderCircle className="h-3 w-3 shrink-0 animate-spin text-[#ff9b7d]" />
                ) : (
                  <span className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full transition-colors',
                    selected ? 'bg-[#ff8063]' : 'bg-white/14 group-hover:bg-white/28',
                  )} />
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
