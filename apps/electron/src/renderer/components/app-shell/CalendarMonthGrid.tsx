import * as React from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface CalendarDayMenuItem {
  id: string
  label: string
  detail?: string
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
}: {
  visibleMonth: Date
  selectedDate: string
  dayMetaByDate: Map<string, CalendarMonthDayMeta>
  dayActions?: CalendarDayAction[]
  onSelectDate: (date: string) => void
  onChangeMonth: (month: Date) => void
  onDayAction?: (date: string, actionId: string) => void
  onSelectItem?: (date: string, itemId: string) => void
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
    if (dayActions.length === 0) return
    setMenu({
      date,
      x: Math.max(8, Math.min(x, window.innerWidth - 248)),
      y: Math.max(8, Math.min(y, window.innerHeight - 360)),
    })
  }, [dayActions.length, onSelectDate])

  return (
    <div className="rounded-[16px] border border-white/[0.05] bg-black/20 p-3">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onChangeMonth(addMonths(visibleMonth, -1))}
          className="rounded-full border border-white/[0.06] p-2 text-white/45 hover:bg-white/[0.04] hover:text-white/75"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-sm font-semibold text-white/78">{monthLabel}</div>
        <button
          type="button"
          onClick={() => onChangeMonth(addMonths(visibleMonth, 1))}
          className="rounded-full border border-white/[0.06] p-2 text-white/45 hover:bg-white/[0.04] hover:text-white/75"
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
          <div key={day} className="py-2 text-center text-[9px] font-semibold uppercase tracking-[0.14em] text-white/28">
            {day}
          </div>
        ))}
        {days.map((day) => {
          const key = toDateKey(day)
          const meta = dayMetaByDate.get(key)
          const count = meta?.count ?? 0
          const dots = meta?.dots ?? (count > 0 ? ['bg-orange-400/80'] : [])
          const isSelected = key === selectedDate
          const isToday = key === todayKey
          const isCurrentMonth = day.getMonth() === visibleMonth.getMonth()
          return (
            <button
              key={key}
              type="button"
              onClick={(event) => openMenu(key, event.clientX, event.clientY)}
              onContextMenu={(event) => {
                event.preventDefault()
                openMenu(key, event.clientX, event.clientY)
              }}
              aria-haspopup={dayActions.length > 0 ? 'menu' : undefined}
              className={cn(
                'flex min-h-[72px] flex-col rounded-[12px] border p-2 text-left transition-colors',
                isSelected
                  ? 'border-orange-400/40 bg-orange-500/12'
                  : 'border-white/[0.045] bg-white/[0.015] hover:bg-white/[0.035]',
                !isCurrentMonth && 'opacity-35',
              )}
            >
              <div className="flex items-start justify-between">
                <span className={cn('text-xs font-medium', isToday ? 'text-orange-200' : 'text-white/65')}>
                  {day.getDate()}
                </span>
                {count > 0 ? <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] text-white/55">{count}</span> : null}
              </div>
              {dots.length > 0 ? (
                <div className="mt-auto flex gap-1 pt-3">
                  {dots.slice(0, 4).map((dotClass, index) => (
                    <span key={`${dotClass}-${index}`} className={cn('h-1.5 w-1.5 rounded-full', dotClass)} />
                  ))}
                </div>
              ) : null}
            </button>
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
      className="popover-styled fixed z-dropdown w-60 overflow-hidden p-1.5 shadow-strong"
      style={{ left: x, top: y }}
    >
      <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/45">{label}</div>
      {actions.map((action) => {
        const Icon = action.icon
        return (
          <button key={action.id} type="button" role="menuitem" onClick={() => onAction(action.id)} className="flex min-h-8 w-full items-center gap-2 rounded-[5px] px-2 text-left text-xs text-foreground/75 hover:bg-foreground/[0.06]">
            <Icon className="h-3.5 w-3.5 text-foreground/45" />
            {action.label}
          </button>
        )
      })}
      {items.length > 0 ? (
        <>
          <div className="my-1 h-px bg-foreground/[0.06]" />
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/35">Scheduled</div>
          <div className="max-h-36 overflow-y-auto">
            {items.map((item) => (
              <button key={item.id} type="button" role="menuitem" onClick={() => onItem(item.id)} className="block min-h-8 w-full rounded-[5px] px-2 py-1.5 text-left hover:bg-foreground/[0.06]">
                <span className="block truncate text-xs text-foreground/72">{item.label}</span>
                {item.detail ? <span className="mt-0.5 block truncate text-[10px] text-foreground/35">{item.detail}</span> : null}
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
