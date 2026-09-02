import * as React from 'react'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CHAT_LAYOUT } from '@/config/layout'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { StyledDropdownMenuContent } from '@/components/ui/styled-dropdown'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'

interface ChatAgentHeaderProps {
  name: string
  description?: string
  menu?: React.ReactNode
  leadingAction?: React.ReactNode
  rightSidebarButton?: React.ReactNode
  className?: string
}

export function ChatAgentHeader({
  name,
  description,
  menu,
  leadingAction,
  rightSidebarButton,
  className,
}: ChatAgentHeaderProps) {
  return (
    <div className={cn('relative z-panel shrink-0 px-3 pt-2 @xs/panel:px-4', className)}>
      <div className={cn(CHAT_LAYOUT.maxWidth, 'relative mx-auto flex h-9 min-w-0 items-center justify-center')}>
        {leadingAction && <div className="titlebar-no-drag absolute left-0 shrink-0">{leadingAction}</div>}

        <div
          className="titlebar-no-drag flex h-8 min-w-0 max-w-[64%] items-center gap-0.5 rounded-[10px] border border-[#ff8063]/[0.34] px-1 shadow-tinted"
          style={{ '--shadow-color': '244, 63, 47' } as React.CSSProperties}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={description ? 0 : -1}
                className={cn(
                  'inline-flex h-7 min-w-0 items-center justify-center px-3',
                  'text-[11px] font-medium uppercase tracking-[0.13em] text-white/95 outline-none',
                  description && 'cursor-help focus-visible:ring-1 focus-visible:ring-orange-200/70',
                )}
              >
                <span className="truncate">{name}</span>
              </span>
            </TooltipTrigger>
            {description ? <TooltipContent side="bottom" className="max-w-[360px] text-xs">{description}</TooltipContent> : null}
          </Tooltip>
          {menu && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Chat options"
                  className="flex h-6 w-6 items-center justify-center rounded-[6px] text-white/38 transition-colors hover:bg-white/[0.07] hover:text-white/78 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/25"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <StyledDropdownMenuContent align="end" sideOffset={6}>
                {menu}
              </StyledDropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {rightSidebarButton && <div className="titlebar-no-drag absolute right-0 shrink-0">{rightSidebarButton}</div>}
      </div>
    </div>
  )
}
