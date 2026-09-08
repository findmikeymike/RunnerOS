import * as React from 'react'
import { MoreHorizontal } from 'lucide-react'
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
      'relative z-panel flex min-h-[64px] shrink-0 items-center justify-center gap-3 px-3 py-2 @md/panel:gap-5 @md/panel:px-5',
      focusControls && 'flex-col gap-1 pt-2 pb-0 @md/panel:gap-1',
      className,
    )}>
      {leadingAction && <div className={cn("titlebar-no-drag absolute left-3 shrink-0", focusControls ? "top-1" : "top-1/2 -translate-y-1/2")}>{leadingAction}</div>}
      <div className="titlebar-no-drag relative flex max-w-[calc(100%-80px)] shrink-0 items-center gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <h2
                  tabIndex={description ? 0 : -1}
                  className={cn(
                    'min-w-0 truncate rounded text-[12px] font-semibold uppercase leading-5 tracking-[0.1em] text-white/90 outline-none @md/panel:text-[13px]',
                    description && 'cursor-help focus-visible:ring-1 focus-visible:ring-[#fb923c]/70',
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
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-white/35 transition-colors hover:bg-white/[0.07] hover:text-white/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#fb923c]/70"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <StyledDropdownMenuContent align="start" sideOffset={8}>{menu}</StyledDropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>
      {focusControls && <div className="w-full min-w-0">{focusControls}</div>}
      {rightSidebarButton && <div className={cn("titlebar-no-drag absolute right-3 shrink-0", focusControls ? "top-1" : "top-1/2 -translate-y-1/2")}>{rightSidebarButton}</div>}
    </div>
  )
}
