import * as React from 'react'
import { Diamond, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { StyledDropdownMenuContent } from '@/components/ui/styled-dropdown'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'

interface ChatAgentHeaderProps {
  name: string
  description?: string
  menu?: React.ReactNode
  leadingAction?: React.ReactNode
  rightSidebarButton?: React.ReactNode
  focusControls?: React.ReactNode
  className?: string
}

export function ChatAgentHeader({
  name,
  description,
  menu,
  leadingAction,
  rightSidebarButton,
  focusControls,
  className,
}: ChatAgentHeaderProps) {
  return (
    <div className={cn(
      'relative z-panel flex min-h-[64px] shrink-0 items-center gap-3 border-b border-white/[0.07] bg-gradient-to-b from-[#16181c]/95 to-[#0c0e11]/95 px-3 py-2 shadow-hairline-top backdrop-blur-xl @md/panel:gap-5 @md/panel:px-5',
      className,
    )}>
      {leadingAction && <div className="titlebar-no-drag shrink-0">{leadingAction}</div>}
      <div className="titlebar-no-drag flex max-w-[48%] shrink-0 items-center gap-2.5 @md/panel:max-w-[38%]">
        <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-[#ff9b7d]/20 bg-gradient-to-br from-[#ff9b7d]/12 to-[#ff8063]/[0.025] text-[#ffac91] shadow-hairline-top">
          <Diamond className="size-3.5" strokeWidth={1.5} />
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <h2
                  tabIndex={description ? 0 : -1}
                  className={cn(
                    'min-w-0 truncate rounded text-[10px] font-semibold uppercase leading-5 tracking-[0.1em] text-white/90 outline-none @md/panel:text-[11px]',
                    description && 'cursor-help focus-visible:ring-1 focus-visible:ring-[#ffac91]/70',
                  )}
                >
                  {name}
                </h2>
              </TooltipTrigger>
              {description ? <TooltipContent side="bottom" className="max-w-[360px] text-xs">{description}</TooltipContent> : null}
            </Tooltip>
            {menu && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Chat options"
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-white/35 transition-colors hover:bg-white/[0.07] hover:text-white/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#ffac91]/70"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <StyledDropdownMenuContent align="start" sideOffset={8}>{menu}</StyledDropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          {focusControls && <p className="whitespace-nowrap text-[10px] italic leading-4 text-white/45">What are we doing?</p>}
        </div>
      </div>
      {focusControls && <div className="min-w-0 flex-1 border-l border-white/[0.07] pl-3 @md/panel:pl-5">{focusControls}</div>}
      {rightSidebarButton && <div className="titlebar-no-drag ml-auto shrink-0">{rightSidebarButton}</div>}
    </div>
  )
}
