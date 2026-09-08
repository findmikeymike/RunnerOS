import * as React from 'react'
import { AudioLines, Check, ChevronRight, Fingerprint, Layers3, LoaderCircle, Orbit, Sparkles } from 'lucide-react'
import type { AgentTaskModeDefinition } from '@craft-agent/shared/agent-definitions/types'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@craft-agent/ui'

const FOCUS_ICONS: Record<string, typeof Fingerprint> = {
  'brand-audit': Fingerprint,
  'artist-world': Orbit,
  'voice-beliefs': AudioLines,
  'campaign-angles': Sparkles,
  'full-brand-system': Layers3,
}

const FOCUS_HELP: Record<string, { summary: string; details: string }> = {
  'brand-audit': {
    summary: 'Assess how your music, image, and public presence add up—and what makes you distinct.',
    details: 'Identify your strongest traits, mixed signals, and the changes that would sharpen your identity.',
  },
  'artist-world': {
    summary: 'Build a recognizable world around your music, connecting its story with a clear visual direction.',
    details: 'Explore themes, characters, symbols, color, styling, and imagery that belong together.',
  },
  'voice-beliefs': {
    summary: 'Clarify what you stand for and how you show up for your audience—through your music, content, and community.',
    details: 'Explore your point of view, your natural voice, and the shared ideas that bring your audience together.',
  },
  'campaign-angles': {
    summary: 'Turn a release into a compelling idea people can follow, share, and participate in.',
    details: 'Develop the central hook, content themes, fan participation, and ways to build anticipation.',
  },
  'full-brand-system': {
    summary: 'Bring your identity, story, visuals, voice, and campaign direction into one connected brand.',
    details: 'Work across all five areas for a complete foundation. A deeper session that takes longer.',
  },
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
        className="flex overflow-x-auto pt-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div data-focus-options className="relative mx-auto flex shrink-0 items-center gap-1.5">
        {modes.map((mode) => {
          const selected = selectedModeId === mode.id
          const applying = applyingModeId === mode.id
          const Icon = FOCUS_ICONS[mode.id] ?? Layers3
          const help = FOCUS_HELP[mode.id]
          const busy = Boolean(applyingModeId) || openingConversation
          // Keep pointer grace local: a shared provider can suppress a neighboring
          // trigger when the pointer crosses several focus buttons quickly.
          return (
            <TooltipProvider key={mode.id} delayDuration={150} disableHoverableContent={false}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => { if (!busy) onSelect(mode.id) }}
                    aria-disabled={busy}
                    className={cn(
                      'group relative flex h-7 max-w-full shrink-0 items-center gap-2 rounded-lg border px-3 text-[11px] font-medium tracking-[-0.01em] shadow-hairline-top transition-[color,background-color,border-color] duration-150',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#fb923c]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#242424]',
                      'aria-disabled:cursor-wait motion-reduce:transition-none',
                      selected
                        ? 'border-[#fb923c]/[0.51] bg-gradient-to-b from-white/[0.055] to-white/[0.02] text-white/90'
                        : 'border-white/[0.0765] bg-gradient-to-b from-white/[0.055] to-white/[0.02] text-white/65 hover:border-white/[0.17] hover:bg-white/[0.07] hover:text-white/95',
                      mode.fullMode && !selected && 'border-dashed',
                    )}
                  >
                    {applying ? <LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 animate-spin text-[#fb923c] motion-reduce:animate-none" /> : (
                      <Icon aria-hidden="true" strokeWidth={1.5} className={cn('size-3.5 shrink-0', selected ? 'text-[#fb923c]' : 'text-white/35 group-hover:text-white/65')} />
                    )}
                    <span className="min-w-0 whitespace-normal text-left leading-[13px]">{mode.label}</span>
                    {selected && !applying && <Check aria-hidden="true" className="size-3 shrink-0 text-[#fb923c]" strokeWidth={2} />}
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom" align="start" sideOffset={10} collisionPadding={12}
                  className="w-[300px] max-w-[calc(100vw-24px)] rounded-xl border-white/10 bg-[#181818] p-4 text-left shadow-modal-small backdrop-filter-none motion-reduce:animate-none"
                >
                  <div className="mb-2.5 flex items-center gap-2 text-white/95">
                    <Icon aria-hidden="true" className="size-3.5 shrink-0 text-[#fb923c]" strokeWidth={1.5} />
                    <span className="text-[12px] font-semibold tracking-wide">{mode.label}</span>
                  </div>
                  <p className="text-[12px] leading-[18px] text-white/90">{help?.summary ?? mode.description}</p>
                  {help && <p className="mt-3 border-t border-white/[0.07] pt-3 text-[11px] leading-[17px] text-white/55">{help.details}</p>}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )
        })}
          <div data-focus-divider aria-hidden="true" className="pointer-events-none absolute inset-x-0 -bottom-2 h-[0.5px] bg-[#fb923c]/45" />
        </div>
      </div>
      {canScrollRight && (
        <div className="pointer-events-none absolute inset-y-0 right-0 flex w-11 items-center justify-end bg-gradient-to-l from-[#1c1c1c] via-[#1c1c1c]/90 to-transparent">
          <button
            type="button"
            aria-label="More focus options"
            onClick={() => scrollRef.current?.scrollBy({ left: 220, behavior: 'instant' })}
            className="pointer-events-auto flex size-7 items-center justify-center rounded-md border border-white/10 bg-[#303030] text-white/60 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#fb923c]/70"
          >
            <ChevronRight className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}
