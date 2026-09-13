import {
  Activity, AudioLines, BookOpen, CalendarDays, Captions, ChartNoAxesCombined,
  Check, CircleHelp, ClipboardList, Coins, Compass,
  Download, FileCheck, Fingerprint, Globe, Image, Info, Layers3,
  Lightbulb, ListChecks, ListMusic, LoaderCircle, Map, Megaphone,
  MessageCircle, Mic, MousePointerClick, Orbit, Package, Palette,
  PencilLine, Plug, Presentation, Radio, RefreshCw, Repeat,
  ScanText, Scissors, Search, Send, ShieldCheck, Shirt,
  SlidersHorizontal, Sparkles, Target, Users, Video,
} from 'lucide-react'
import type { AgentTaskModeDefinition } from '@craft-agent/shared/agent-definitions/types'
import { GENERAL_AGENT_TASK_MODE_ID, consolidateManagerGeneralModes } from '@craft-agent/shared/agent-definitions/task-modes'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@craft-agent/ui'

const GENERAL_MODE: AgentTaskModeDefinition = {
  id: GENERAL_AGENT_TASK_MODE_ID,
  label: 'General',
  description: 'Just send a message. The worker uses your request and artist context to choose relevant skills.',
  icon: 'message-circle',
  kind: 'focus',
  primarySkillSlugs: [],
}

const FOCUS_ICONS: Record<string, typeof Fingerprint> = {
  'activity': Activity,
  'audio-lines': AudioLines,
  'book-open': BookOpen,
  'calendar': CalendarDays,
  'captions': Captions,
  'chart-no-axes-combined': ChartNoAxesCombined,
  'circle-help': CircleHelp,
  'clipboard-list': ClipboardList,
  'coins': Coins,
  'compass': Compass,
  'download': Download,
  'file-check': FileCheck,
  'fingerprint': Fingerprint,
  'globe': Globe,
  'image': Image,
  'layers': Layers3,
  'lightbulb': Lightbulb,
  'list-checks': ListChecks,
  'list-music': ListMusic,
  'map': Map,
  'megaphone': Megaphone,
  'message-circle': MessageCircle,
  'mic': Mic,
  'mouse-pointer-click': MousePointerClick,
  'orbit': Orbit,
  'package': Package,
  'palette': Palette,
  'pencil-line': PencilLine,
  'plug': Plug,
  'presentation': Presentation,
  'radio': Radio,
  'refresh-cw': RefreshCw,
  'repeat': Repeat,
  'scan-text': ScanText,
  'scissors': Scissors,
  'search': Search,
  'send': Send,
  'shield-check': ShieldCheck,
  'shirt': Shirt,
  'sliders-horizontal': SlidersHorizontal,
  'sparkles': Sparkles,
  'target': Target,
  'users': Users,
  'video': Video,
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
  openingConversation = false,
  onSelect,
}: ChatAgentTaskModeBarProps) {
  const consolidated = consolidateManagerGeneralModes(modes)
  const focusModes = [
    consolidated.find(mode => mode.id === GENERAL_AGENT_TASK_MODE_ID) ?? GENERAL_MODE,
    ...consolidated.filter(mode => mode.id !== GENERAL_AGENT_TASK_MODE_ID),
  ]
  const legacyManagerSelection = selectedModeId === 'just-talk' && consolidated.some(mode => mode.id === GENERAL_AGENT_TASK_MODE_ID && mode.primarySkillSlugs.includes('artist-manager-operating-system'))
  const activeModeId = legacyManagerSelection ? GENERAL_AGENT_TASK_MODE_ID : selectedModeId ?? GENERAL_AGENT_TASK_MODE_ID
  const busy = Boolean(applyingModeId) || openingConversation
  const helperText = busy
    ? 'Updating focus…'
    : activeModeId === GENERAL_AGENT_TASK_MODE_ID
      ? 'General selected. Send a message or choose a focus.'
      : focusModes.some((mode) => mode.id === activeModeId)
        ? 'Focus selected. Applies to your next message.'
        : 'Send a message or choose a focus.'

  return (
    <div className="relative min-w-0" aria-label="Agent focus">
      <p className="sr-only" role="status">{helperText}</p>
      <div data-focus-options className="relative mx-auto flex flex-wrap items-center justify-center gap-1.5 px-1 pt-1 pb-2">
        {focusModes.map((mode) => {
          const selected = activeModeId === mode.id
          const applying = applyingModeId === mode.id
          const Icon = FOCUS_ICONS[mode.icon ?? ''] ?? Layers3
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
                    disabled={busy}
                    aria-disabled={busy}
                    className={cn(
                      'group relative flex cursor-pointer min-h-7 max-w-full items-center gap-2 rounded-lg border px-3 py-1 text-[11px] font-medium tracking-[-0.01em] shadow-hairline-top transition-[color,background-color,border-color] duration-150',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#fb923c]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#242424]',
                      'disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none',
                      selected
                        ? 'border-[#fb923c]/60 bg-[#fb923c]/15 text-white/95'
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
                  <p className="text-[12px] leading-[18px] text-white/90">{mode.description}</p>
                  {mode.helpText && <p className="mt-3 border-t border-white/[0.07] pt-3 text-[11px] leading-[17px] text-white/55">{mode.helpText}</p>}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )
        })}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="How skill focus works"
              className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/[0.07] hover:text-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#fb923c]/70 motion-reduce:transition-none"
            >
              <Info aria-hidden="true" className="size-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="bottom" align="end" sideOffset={10} collisionPadding={12}
            aria-label="How skill focus works"
            className="w-[300px] max-w-[calc(100vw-24px)] rounded-xl border border-white/10 bg-[#181818] p-4 text-left shadow-modal-small"
          >
            <p className="text-[12px] font-semibold text-white/95">Choose how to focus</p>
            <p className="mt-2 text-[12px] leading-[18px] text-white/85"><strong>General:</strong> Just send a message. The worker uses your request and artist context to choose relevant skills.</p>
            <p className="mt-2 text-[12px] leading-[18px] text-white/85">Click a skill button to narrow the next reply. A Full option asks for broader coverage.</p>
            <p className="mt-3 border-t border-white/[0.07] pt-3 text-[11px] leading-[17px] text-white/60">The highlighted button is active. Change it anytime; choosing a focus does not send a message.</p>
          </PopoverContent>
        </Popover>
        <div data-focus-divider aria-hidden="true" className="pointer-events-none absolute inset-x-1 bottom-0 h-[0.5px] bg-[#fb923c]/45" />
      </div>
    </div>
  )
}
