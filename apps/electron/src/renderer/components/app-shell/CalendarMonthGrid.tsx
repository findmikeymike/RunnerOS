import * as React from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

const MAX_VISIBLE_DAY_ITEMS = 6

export interface CalendarDayMenuItem {
  id: string
  label: string
  detail?: string
  markerClass?: string
}

export interface CalendarDayAction {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

export interface CalendarMonthDayMeta {
  count?: number
  dots?: string[]
  items?: CalendarDayMenuItem[]
  highlights?: Array<{ id: string; label: string; className?: string }>
}

export function CalendarMonthGrid({
  visibleMonth,
  selectedDate,
  dayMetaByDate,
  dayActions = [],
  onSelectDate,
  onChangeMonth,
  onDayAction,
  onSelectItem,
  compact = false,
}: {
  visibleMonth: Date
  selectedDate: string
  dayMetaByDate: Map<string, CalendarMonthDayMeta>
  dayActions?: CalendarDayAction[]
  onSelectDate: (date: string) => void
  onChangeMonth: (month: Date) => void
  onDayAction?: (date: string, actionId: string) => void
  onSelectItem?: (date: string, itemId: string) => void
  compact?: boolean
}) {
  const [menu, setMenu] = React.useState<{ date: string; x: number; y: number } | null>(null)
  const days = React.useMemo(() => buildMonthDays(visibleMonth), [visibleMonth])
  const monthLabel = visibleMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  React.useEffect(() => {
    if (!menu) return
    const close = (event: PointerEvent) => {
      if (!(event.target as HTMLElement | null)?.closest('[data-calendar-day-menu]')) setMenu(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [menu])

  const openMenu = React.useCallback((date: string, x: number, y: number) => {
    onSelectDate(date)
    if (dayActions.length === 0 && (dayMetaByDate.get(date)?.items?.length ?? 0) === 0) return
    setMenu({
      date,
      x: Math.max(8, Math.min(x, window.innerWidth - 248)),
      y: Math.max(8, Math.min(y, window.innerHeight - 360)),
    })
  }, [dayActions.length, dayMetaByDate, onSelectDate])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onChangeMonth(addMonths(visibleMonth, -1))}
          className="rounded-full border border-white/[0.12] p-2 text-white/65 hover:bg-white/[0.08] hover:text-white"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-sm font-semibold text-white/88">{monthLabel}</div>
        <button
          type="button"
          onClick={() => onChangeMonth(addMonths(visibleMonth, 1))}
          className="rounded-full border border-white/[0.12] p-2 text-white/65 hover:bg-white/[0.08] hover:text-white"
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
          <div key={day} className="py-1 text-center text-[9px] font-semibold uppercase tracking-[0.14em] text-white/55">
            {day}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-1">
        {days.map((day) => {
          const key = toDateKey(day)
          const meta = dayMetaByDate.get(key)
          const count = meta?.count ?? 0
          const dots = meta?.dots ?? (count > 0 ? ['bg-orange-400/80'] : [])
          const items = meta?.items ?? []
          const highlights = meta?.highlights ?? []
          const visibleItems = items.slice(0, MAX_VISIBLE_DAY_ITEMS)
          const hiddenItemCount = items.length - visibleItems.length
          const isSelected = key === selectedDate
          const isToday = key === todayKey
          const isCurrentMonth = day.getMonth() === visibleMonth.getMonth()
          return (
            <div
              key={key}
              role="button"
              tabIndex={0}
              onClick={(event) => openMenu(key, event.clientX, event.clientY)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                const bounds = event.currentTarget.getBoundingClientRect()
                openMenu(key, bounds.left + 16, bounds.top + 32)
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                openMenu(key, event.clientX, event.clientY)
              }}
              aria-haspopup={dayActions.length > 0 || items.length > 0 ? 'menu' : undefined}
              className={cn(
                'flex flex-col rounded-[10px] border p-1.5 text-left transition-colors',
                compact ? 'min-h-[48px]' : 'min-h-[56px]',
                isSelected
                  ? 'border-[#f97316]/60 bg-[#0F0F10] hover:bg-[#12110F]'
                  : isCurrentMonth
                    ? 'border-white/[0.06] bg-[#0F0F10] hover:bg-[#121314]'
                    : 'border-white/[0.025] bg-[#090A0B] hover:bg-[#0C0D0E]',
              )}
            >
              <span className={cn(
                'text-[13px] font-medium',
                isSelected || isToday
                  ? 'text-[#f97316]'
                  : isCurrentMonth
                    ? 'text-white/82'
                    : 'text-white/28',
              )}>
                {day.getDate()}
              </span>
              {highlights.length > 0 ? (
                <div className="mt-auto min-w-0 space-y-1 pt-1">
                  {highlights.map((highlight) => (
                    <div
                      key={highlight.id}
                      title={highlight.label}
                      className={cn('max-w-full truncate rounded-[3px] bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700 ring-1 ring-emerald-300/60', highlight.className)}
                    >
                      {highlight.label}
                    </div>
                  ))}
                </div>
              ) : null}
              {items.length > 0 ? (
                <div className={cn('flex min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden pt-1.5', highlights.length === 0 && 'mt-auto')}>
                  {visibleItems.map((item, index) => (
                    <button
                      key={item.id}
                      type="button"
                      title={item.label}
                      aria-label={`Open ${item.label}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        onSelectDate(key)
                        onSelectItem?.(key, item.id)
                      }}
                      className={cn('size-2.5 shrink-0 rounded-[2px] ring-1 ring-white/15 transition-transform hover:scale-125', item.markerClass ?? dots[index % Math.max(dots.length, 1)] ?? 'bg-orange-400/85')}
                    />
                  ))}
                  {hiddenItemCount > 0 ? (
                    <button
                      type="button"
                      title={`Open ${hiddenItemCount} more items`}
                      aria-label={`Open ${hiddenItemCount} more items`}
                      onClick={(event) => {
                        event.stopPropagation()
                        openMenu(key, event.clientX, event.clientY)
                      }}
                      className="shrink-0 text-[9px] font-semibold text-white/48 hover:text-white/80"
                    >
                      +{hiddenItemCount}
                    </button>
                  ) : null}
                </div>
              ) : dots.length > 0 ? (
                <div className="mt-auto flex gap-1.5 pt-1.5">
                  {dots.map((dotClass, index) => (
                    <span key={`${dotClass}-${index}`} className={cn('size-2.5 rounded-[2px] ring-1 ring-white/15', dotClass)} />
                  ))}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
      {menu && typeof document !== 'undefined' ? createPortal(
        <CalendarDayMenu
          date={menu.date}
          x={menu.x}
          y={menu.y}
          actions={dayActions}
          items={dayMetaByDate.get(menu.date)?.items ?? []}
          onAction={(actionId) => {
            setMenu(null)
            onDayAction?.(menu.date, actionId)
          }}
          onItem={(itemId) => {
            setMenu(null)
            onSelectItem?.(menu.date, itemId)
          }}
        />,
        document.body,
      ) : null}
    </div>
  )
}

function CalendarDayMenu({ date, x, y, actions, items, onAction, onItem }: {
  date: string
  x: number
  y: number
  actions: CalendarDayAction[]
  items: CalendarDayMenuItem[]
  onAction: (actionId: string) => void
  onItem: (itemId: string) => void
}) {
  const label = parseDateKey(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  return (
    <div
      data-calendar-day-menu
      role="menu"
      aria-label={`Calendar actions for ${label}`}
      className="fixed z-dropdown w-60 overflow-hidden rounded-[8px] border border-white/15 bg-[#0b0b0c] p-1.5 text-white shadow-strong"
      style={{ left: x, top: y }}
    >
      <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/55">{label}</div>
      {actions.map((action) => {
        const Icon = action.icon
        return (
          <button key={action.id} type="button" role="menuitem" onClick={() => onAction(action.id)} className="flex min-h-8 w-full items-center gap-2 rounded-[5px] px-2 text-left text-xs font-medium text-white/85 hover:bg-white/[0.07] hover:text-white">
            <Icon className="h-3.5 w-3.5 text-white/58" />
            {action.label}
          </button>
        )
      })}
      {items.length > 0 ? (
        <>
          <div className="my-1 h-px bg-white/[0.08]" />
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/45">Scheduled</div>
          <div className="max-h-36 overflow-y-auto">
            {items.map((item) => (
              <button key={item.id} type="button" role="menuitem" onClick={() => onItem(item.id)} className="block min-h-8 w-full rounded-[5px] px-2 py-1.5 text-left hover:bg-white/[0.07]">
                <span className="block truncate text-xs text-white/82">{item.label}</span>
                {item.detail ? <span className="mt-0.5 block truncate text-[10px] text-white/42">{item.detail}</span> : null}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}

export function toDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function parseDateKey(value: string): Date {
  const [year, month, day] = value.split('-').map((part) => Number(part))
  return new Date(year || 1970, (month || 1) - 1, day || 1)
}

function buildMonthDays(month: Date): Date[] {
  const start = new Date(month.getFullYear(), month.getMonth(), 1)
  const first = new Date(start)
  first.setDate(start.getDate() - start.getDay())
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(first)
    day.setDate(first.getDate() + index)
    return day
  })
}

function addMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1)
}

const todayKey = toDateKey(new Date())
