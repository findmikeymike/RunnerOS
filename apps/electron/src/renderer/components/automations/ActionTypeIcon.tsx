import { CalendarClock, MessageSquare, Webhook } from 'lucide-react'
import { cn } from '@/lib/utils'

export function ActionTypeIcon({ type, className }: { type: 'prompt' | 'webhook' | 'queue-work'; className?: string }) {
  const Icon = type === 'webhook' ? Webhook : type === 'queue-work' ? CalendarClock : MessageSquare
  return <Icon className={cn('text-foreground/50', className)} />
}
