import { GitBranch, MessageSquare, Webhook } from 'lucide-react'
import { cn } from '@/lib/utils'

export function ActionTypeIcon({ type, className }: { type: 'prompt' | 'webhook' | 'workflow'; className?: string }) {
  const Icon = type === 'webhook' ? Webhook : type === 'workflow' ? GitBranch : MessageSquare
  return <Icon className={cn('text-foreground/50', className)} />
}
