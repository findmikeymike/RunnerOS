import * as React from 'react'
import { Loader2, Pencil, X, CornerUpRight, Clock3 } from 'lucide-react'
import { toast } from 'sonner'
import type { Message } from '@craft-agent/core/types'

export function PendingMessageQueue({ sessionId, messages }: { sessionId: string; messages: Message[] }) {
  const [editing, setEditing] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState('')
  const [busy, setBusy] = React.useState<string | null>(null)
  const [busyAction, setBusyAction] = React.useState<string | null>(null)
  const inFlight = React.useRef(false)
  const command = async (message: Message, action: 'edit' | 'remove' | 'steer') => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(message.id)
    setBusyAction(action)
    try {
      await window.electronAPI.sessionCommand(sessionId, { type: 'queuedMessage', messageId: message.id, action, ...(action === 'edit' ? { content: draft } : {}) })
      setEditing(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      inFlight.current = false
      setBusy(null)
      setBusyAction(null)
    }
  }
  if (!messages.length) return null
  const applying = messages.some(message => message.queuedOptions?.steerNext)
  return (
    <div className="max-h-36 w-full overflow-y-auto rounded-t-xl border border-b-0 border-white/15 bg-[#18181a] text-white/85" aria-label="Pending messages">
      {messages.map((message, index) => {
        const waiting = Boolean(message.isPending || busy === message.id)
        const steering = Boolean(message.queuedOptions?.steerNext || (busy === message.id && busyAction === 'steer'))
        return (
          <div key={message.id} className="px-2.5 py-1.5 [&+&]:border-t [&+&]:border-white/10">
            {editing === message.id ? (
              <div className="space-y-2">
                <textarea aria-label="Edit queued message" value={draft} onChange={event => setDraft(event.target.value)} className="min-h-12 w-full rounded-lg border border-white/20 bg-[#151517] text-white/90 p-2 text-[11px]" />
                <div className="flex justify-end gap-3 text-xs">
                  <button disabled={waiting} onClick={() => setEditing(null)}>Cancel</button>
                  <button disabled={waiting || !draft.trim()} onClick={() => void command(message, 'edit')}>Save update</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span role="status" className="shrink-0 text-white/55" title={steering ? 'Applying update…' : message.isPending ? 'Saving update…' : `Queued—${index === 0 ? 'runs next' : `${index + 1} in line`}`} aria-label={steering ? 'Applying update…' : 'Queued message'}>
                  {(waiting || steering) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Clock3 className="h-3 w-3" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p title={message.content} className="truncate text-[11px] leading-5 text-white/85">{message.content}</p>
                  {!!message.attachments?.length && <p className="text-[10px] text-white/55">{message.attachments.length} attachment(s) retained</p>}
                  {!!message.queuedOptions?.skillSlugs?.length && <p className="text-[10px] text-white/55">Selected skills retained</p>}
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button disabled={waiting || applying || busy !== null} aria-label="Steer now" title="Interrupt the current response and apply this update next" onClick={() => void command(message, 'steer')} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-white/65 hover:bg-white/10 hover:text-white disabled:opacity-40"><CornerUpRight className="h-3 w-3" /> Steer</button>
                  <button disabled={waiting || applying || busy !== null} aria-label="Edit queued message" title="Edit queued message" onClick={() => { setEditing(message.id); setDraft(message.content) }} className="rounded-md p-1.5 text-white/75 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70 disabled:opacity-40"><Pencil className="h-3 w-3" /></button>
                  <button disabled={waiting || applying || busy !== null} aria-label="Remove queued message" title="Remove queued message" onClick={() => void command(message, 'remove')} className="rounded-md p-1.5 text-white/75 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70 disabled:opacity-40"><X className="h-3 w-3" /></button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
