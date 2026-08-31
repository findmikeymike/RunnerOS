import * as React from 'react'
import { Bot, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CHAT_LAYOUT } from '@/config/layout'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { StyledDropdownMenuContent } from '@/components/ui/styled-dropdown'

interface ChatAgentHeaderProps {
  name: string
  description?: string
  avatar?: string
  menu?: React.ReactNode
  leadingAction?: React.ReactNode
  rightSidebarButton?: React.ReactNode
  className?: string
}

export function ChatAgentHeader({
  name,
  description,
  avatar,
  menu,
  leadingAction,
  rightSidebarButton,
  className,
}: ChatAgentHeaderProps) {
  return (
    <div className={cn('relative z-panel shrink-0 px-3 pt-3 @xs/panel:px-4', className)}>
      <div className={cn(CHAT_LAYOUT.maxWidth, 'relative mx-auto min-w-0 overflow-hidden rounded-[10px] bg-[#111112]/95 shadow-middle backdrop-blur-xl')}>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_0%_45%,rgba(220,20,36,0.17),transparent_43%),radial-gradient(circle_at_30%_115%,rgba(255,82,0,0.10),transparent_48%)]" />
        <div className="relative flex min-h-[82px] items-center gap-3 px-4 py-3 pr-14">
          {leadingAction && <div className="titlebar-no-drag shrink-0">{leadingAction}</div>}
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[9px] bg-black/22 text-sm font-medium text-white/88 shadow-minimal">
            {avatar ? <span className="max-w-8 truncate">{avatar}</span> : <Bot className="h-[18px] w-[18px]" />}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-medium leading-5 text-white/88">{name}</h1>
            {description && <p className="mt-0.5 line-clamp-2 text-[12px] leading-[17px] text-white/46">{description}</p>}
          </div>
          {rightSidebarButton && <div className="titlebar-no-drag shrink-0 self-start">{rightSidebarButton}</div>}
        </div>
        {menu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Chat options"
                className="titlebar-no-drag absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-md text-white/38 transition-colors hover:bg-white/[0.07] hover:text-white/78 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/25"
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
    </div>
  )
}
