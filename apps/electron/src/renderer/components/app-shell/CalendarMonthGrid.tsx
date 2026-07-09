import * as React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface CalendarMonthDayMeta {
  count?: number
  dots?: string[]
}

export function CalendarMonthGrid({
  visibleMonth,
  selectedDate,
  dayMetaByDate,
  onSelectDate,
  onChangeMonth,
}: {
  visibleMonth: Date
  selectedDate: string
  dayMetaByDate: Map<string, CalendarMonthDayMeta>
  onSelectDate: (date: string) => void
  onChangeMonth: (month: Date) => void
}) {
  const days = React.useMemo(() => buildMonthDays(visibleMonth), [visibleMonth])
  const monthLabel = visibleMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

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
              onClick={() => onSelectDate(key)}
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
