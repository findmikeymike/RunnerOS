import * as React from 'react'
import { AudioLines, Check, ChevronRight, Fingerprint, Layers3, LoaderCircle, Orbit, Sparkles } from 'lucide-react'
import type { AgentTaskModeDefinition } from '@craft-agent/shared/agent-definitions/types'
import { cn } from '@/lib/utils'

const FOCUS_ICONS: Record<string, typeof Fingerprint> = {
  'brand-audit': Fingerprint,
  'artist-world': Orbit,
  'voice-beliefs': AudioLines,
  'campaign-angles': Sparkles,
  'full-brand-system': Layers3,
}

interface ChatAgentTaskModeBarProps {
  modes: AgentTaskModeDefinition[]
  selectedModeId?: string
  applyingModeId?: string | null
  conversationStarted?: boolean
  openingConversation?: boolean
  onSelect: (modeId: string) => void
}

export function ChatAgentTaskModeBar({
  modes,
  selectedModeId,
  applyingModeId,
  conversationStarted = false,
  openingConversation = false,
  onSelect,
}: ChatAgentTaskModeBarProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const [canScrollRight, setCanScrollRight] = React.useState(false)
  const updateScroll = React.useCallback(() => {
    const row = scrollRef.current
    if (row) setCanScrollRight(row.scrollWidth - row.clientWidth - row.scrollLeft > 2)
  }, [])
  React.useEffect(() => {
    const row = scrollRef.current
    if (!row) return
    const observer = new ResizeObserver(() => {
      row.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      updateScroll()
    })
    observer.observe(row)
    updateScroll()
    return () => observer.disconnect()
  }, [modes, updateScroll])
  React.useEffect(() => {
    const row = scrollRef.current
    const selected = row?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
    selected?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    updateScroll()
  }, [selectedModeId, updateScroll])

  const helperText = applyingModeId
    ? (conversationStarted ? 'Updating the next reply…' : 'Starting conversation…')
    : openingConversation
      ? 'Starting conversation…'
      : selectedModeId && conversationStarted
        ? 'Choose another anytime · applies to the next reply'
        : selectedModeId ? 'Focus selected' : 'Choose a focus to start'

  return (
    <div className="relative min-w-0" aria-label="Agent focus">
      <p className="sr-only" role="status">{helperText}</p>
      <div
        ref={scrollRef}
        onScroll={updateScroll}
        className="flex items-center gap-1.5 overflow-x-auto py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {modes.map((mode) => {
          const selected = selectedModeId === mode.id
          const applying = applyingModeId === mode.id
          const Icon = FOCUS_ICONS[mode.id] ?? Layers3
          return (
            <button
              key={mode.id}
              type="button"
              title={`${mode.description}${mode.fullMode ? ' Comprehensive · takes longer.' : ''}`}
              aria-pressed={selected}
              onClick={() => onSelect(mode.id)}
              disabled={Boolean(applyingModeId) || openingConversation}
              className={cn(
                'group relative flex h-9 max-w-full shrink-0 items-center gap-2 rounded-lg border px-3 text-[11px] font-medium tracking-[-0.01em] shadow-hairline-top transition-[color,background-color,border-color] duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffac91]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#101216]',
                'disabled:cursor-wait motion-reduce:transition-none',
                selected
                  ? 'border-[#ffac91]/45 bg-gradient-to-b from-[#ff9b7d]/15 to-[#ff8063]/[0.07] text-[#ffd4c4]'
                  : 'border-white/[0.09] bg-gradient-to-b from-white/[0.055] to-white/[0.02] text-white/65 hover:border-white/20 hover:bg-white/[0.07] hover:text-white/95',
                mode.fullMode && !selected && 'border-dashed',
              )}
            >
              {applying ? <LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 animate-spin text-[#ffac91] motion-reduce:animate-none" /> : (
                <Icon aria-hidden="true" strokeWidth={1.5} className={cn('size-3.5 shrink-0', selected ? 'text-[#ffac91]' : 'text-white/35 group-hover:text-white/65')} />
              )}
              <span className="min-w-0 whitespace-normal text-left leading-[13px]">{mode.label}</span>
              {selected && !applying && <Check aria-hidden="true" className="size-3 shrink-0 text-[#ffac91]" strokeWidth={2} />}
              {mode.fullMode && <span className="hidden whitespace-nowrap text-[9px] font-normal text-white/40 @xl/panel:inline">Full · slower</span>}
            </button>
          )
        })}
      </div>
      {canScrollRight && (
        <div className="pointer-events-none absolute inset-y-0 right-0 flex w-11 items-center justify-end bg-gradient-to-l from-[#101216] via-[#101216]/90 to-transparent">
          <button
            type="button"
            aria-label="More focus options"
            onClick={() => scrollRef.current?.scrollBy({ left: 220, behavior: 'instant' })}
            className="pointer-events-auto flex size-7 items-center justify-center rounded-md border border-white/10 bg-[#202227] text-white/60 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffac91]/70"
          >
            <ChevronRight className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}
