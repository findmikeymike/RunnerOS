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
    <div className={cn('relative z-panel shrink-0 px-3 pt-2 @xs/panel:px-4', className)}>
      <div className={cn(CHAT_LAYOUT.maxWidth, 'relative mx-auto min-w-0 overflow-hidden rounded-[10px] bg-[#111112]/82 shadow-middle backdrop-blur-xl')}>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_145%_at_50%_125%,rgba(255,122,24,0.16),rgba(255,122,24,0.045)_48%,transparent_72%)]" />
        <div className="relative flex min-h-[50px] items-center gap-2.5 px-3 py-2 pr-12">
          {leadingAction && <div className="titlebar-no-drag shrink-0">{leadingAction}</div>}
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-black/18 text-xs font-medium text-white/88 shadow-minimal">
            {avatar ? <span className="max-w-6 truncate">{avatar}</span> : <Bot className="h-3.5 w-3.5" />}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[13px] font-medium leading-4 text-white/88">{name}</h1>
            {description && <p className="mt-0.5 truncate text-[10.5px] leading-4 text-white/44">{description}</p>}
          </div>
          {rightSidebarButton && <div className="titlebar-no-drag shrink-0">{rightSidebarButton}</div>}
        </div>
        {menu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Chat options"
                className="titlebar-no-drag absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-white/38 transition-colors hover:bg-white/[0.07] hover:text-white/78 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/25"
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
