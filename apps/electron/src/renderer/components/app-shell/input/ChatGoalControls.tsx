import * as React from 'react'
import { ChevronDown, ChevronUp, Pause, Pencil, Play, Square, Target } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { takePendingChatGoalSetup } from '@/lib/chat-goal-setup'
import type { Session } from '../../../../shared/types'
import type { ChatGoalState, CreateChatGoalInput } from '@craft-agent/shared/sessions'

type EditorMode = 'create' | 'edit' | 'extend'

interface GoalOpenDetail {
  sessionId: string
  objective?: string
  proposal?: CreateChatGoalInput
  confirmationNonce?: string
  intent?: 'open-controls' | 'quick-start'
}

interface ChatGoalControlsProps {
  session: Session
  defaultExpanded?: boolean
}

export function parseChatGoalCommand(message: string): string | null | undefined {
  const match = message.trim().match(/^(?:\/goal|\$goal)(?:\s+([\s\S]+))?$/i)
  if (!match) return undefined
  return match[1]?.trim() || null
}

const STATUS_LABEL: Record<ChatGoalState['status'], string> = {
  active: 'Goal active',
  paused: 'Goal paused',
  blocked: 'Goal blocked',
  'budget-limited': 'Goal reached its limit',
  complete: 'Goal complete',
  cancelled: 'Goal stopped',
}

const STATUS_TONE: Record<ChatGoalState['status'], string> = {
  active: 'text-emerald-300/85',
  paused: 'text-amber-300/85',
  blocked: 'text-orange-300/85',
  'budget-limited': 'text-amber-300/85',
  complete: 'text-sky-300/85',
  cancelled: 'text-white/48',
}

const BADGE_TONE: Record<ChatGoalState['status'], string> = {
  active: 'border-orange-400/20 bg-orange-500/10 text-orange-200/90',
  paused: 'border-amber-400/18 bg-amber-400/[0.08] text-amber-200/85',
  blocked: 'border-orange-400/25 bg-orange-500/12 text-orange-200',
  'budget-limited': 'border-amber-400/22 bg-amber-400/10 text-amber-200/90',
  complete: 'border-emerald-400/18 bg-emerald-400/[0.08] text-emerald-200/85',
  cancelled: 'border-white/[0.08] bg-white/[0.045] text-white/52',
}

function goalBadgeLabel(goal?: ChatGoalState): string {
  if (!goal) return 'Goal'
  if (goal.completion?.taskVerification === 'skipped-degraded') return 'Check goal'
  switch (goal.status) {
    case 'active': return `Goal ${goal.round}/${goal.maxRounds}`
    case 'paused': return 'Goal paused'
    case 'blocked': return 'Needs you'
    case 'budget-limited': return 'Goal limit'
    case 'complete': return 'Goal done'
    case 'cancelled': return 'Goal stopped'
  }
}

export function buildGoalCommandDraft(draft = ''): string {
  const content = draft.trimStart()
  if (/^(?:\/goal|\$goal)(?:\s|$)/i.test(content)) return draft
  return content ? `$goal ${content}` : '$goal '
}

export function ChatGoalBadge({
  session,
  draft,
  onDraftChange,
}: {
  session: Session
  draft?: string
  onDraftChange?: (value: string) => void
}) {
  const goal = session.chatGoal
  const label = goalBadgeLabel(goal)

  const openGoal = React.useCallback(() => {
    if (goal) {
      window.dispatchEvent(new CustomEvent<GoalOpenDetail>('craft:open-goal', {
        detail: { sessionId: session.id, intent: 'open-controls' },
      }))
      return
    }

    onDraftChange?.(buildGoalCommandDraft(draft))
    queueMicrotask(() => {
      window.dispatchEvent(new CustomEvent('craft:focus-input', {
        detail: { sessionId: session.id },
      }))
    })
  }, [draft, goal, onDraftChange, session.id])

  return (
    <button
      type="button"
      aria-label={goal ? `Open Goal controls: ${label}` : 'Write a Goal in chat'}
      onClick={openGoal}
      disabled={!goal && !onDraftChange}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-[8px] border px-2 text-[11px] font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-orange-300/40 disabled:cursor-not-allowed disabled:opacity-40',
        goal
          ? BADGE_TONE[goal.status]
          : 'border-white/[0.08] bg-white/[0.045] text-white/64 hover:bg-white/[0.08] hover:text-white',
      )}
    >
      <Target className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{label}</span>
      {goal ? <ChevronDown className="h-3 w-3 opacity-55" aria-hidden="true" /> : null}
    </button>
  )
}

function goalCommand<T>(sessionId: string, command: Parameters<typeof window.electronAPI.sessionCommand>[1]) {
  return window.electronAPI.sessionCommand(sessionId, command) as Promise<T>
}

export function ChatGoalControls({ session, defaultExpanded = false }: ChatGoalControlsProps) {
  const goal = session.chatGoal
  const [expanded, setExpanded] = React.useState(defaultExpanded)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [mode, setMode] = React.useState<EditorMode>('create')
  const [objective, setObjective] = React.useState('')
  const [doneWhen, setDoneWhen] = React.useState('')
  const [maxRounds, setMaxRounds] = React.useState(6)
  const [tokenBudget, setTokenBudget] = React.useState('')
  const [confirmationNonce, setConfirmationNonce] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const quickStartObjectiveRef = React.useRef<string | null>(null)

  const openEditor = React.useCallback((nextMode: EditorMode, input?: CreateChatGoalInput, nonce?: string) => {
    const source = input ?? (nextMode === 'create' ? undefined : goal)
    const usedTokens = goal?.tokenBaseline !== undefined && session.tokenUsage?.totalTokens !== undefined
      ? Math.max(0, session.tokenUsage.totalTokens - goal.tokenBaseline)
      : 0
    const isTokenExtension = nextMode === 'extend' && goal?.stop?.code === 'token-limit'
    setMode(nextMode)
    setObjective(source?.objective ?? '')
    setDoneWhen(source?.doneWhen ?? '')
    setMaxRounds(
      nextMode === 'extend' && goal && !isTokenExtension
        ? Math.min(12, Math.max(goal.maxRounds + 2, goal.round + 2))
        : source?.maxRounds ?? 6
    )
    setTokenBudget(
      isTokenExtension
        ? String(Math.max(goal?.tokenBudget ?? 0, usedTokens) + 10_000)
        : source?.tokenBudget?.toString() ?? ''
    )
    setConfirmationNonce(nonce ?? null)
    setError(null)
    setDialogOpen(true)
  }, [goal, session.tokenUsage?.totalTokens])

  const runAction = React.useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Goal action failed'
      setError(message)
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }, [])

  const quickStartGoal = React.useCallback((nextObjective: string) => {
    quickStartObjectiveRef.current = nextObjective
    void runAction(async () => {
      try {
        const prepared = await goalCommand<{ proposal: CreateChatGoalInput; confirmationNonce: string }>(session.id, {
          type: 'goalPrepare',
          proposal: { objective: nextObjective },
        })
        takePendingChatGoalSetup(session.id)
        await goalCommand(session.id, {
          type: 'goalCreate',
          confirmationNonce: prepared.confirmationNonce,
          initialMessage: prepared.proposal.objective,
        })
      } finally {
        quickStartObjectiveRef.current = null
      }
    })
  }, [runAction, session.id])

  React.useEffect(() => {
    const applyOpen = (detail: GoalOpenDetail) => {
      if (!detail || detail.sessionId !== session.id) return

      if (detail.intent === 'quick-start' && detail.objective) {
        if (goal && goal.status !== 'complete' && goal.status !== 'cancelled') {
          setExpanded(true)
          toast.info('This chat already has a Goal. Edit or stop it before starting another.')
        } else {
          quickStartGoal(detail.objective)
        }
        return
      }

      if (detail.intent === 'open-controls') {
        if (goal) {
          setExpanded(true)
        } else {
          openEditor('create')
        }
        return
      }

      if (detail.proposal && detail.confirmationNonce) {
        if (quickStartObjectiveRef.current) {
          takePendingChatGoalSetup(session.id)
          return
        }
        openEditor('create', detail.proposal, detail.confirmationNonce)
        return
      }

      if (goal && goal.status !== 'complete' && goal.status !== 'cancelled') {
        setExpanded(true)
        toast.info('This chat already has a Goal. Edit or stop it before starting another.')
        return
      }

      openEditor('create', detail.objective ? { objective: detail.objective } : undefined)
    }

    const pending = takePendingChatGoalSetup(session.id)
    if (pending) applyOpen(pending)

    const onOpen = (rawEvent: Event) => {
      const detail = (rawEvent as CustomEvent<GoalOpenDetail>).detail
      if (detail?.sessionId === session.id) takePendingChatGoalSetup(session.id)
      applyOpen(detail)
    }

    window.addEventListener('craft:open-goal', onOpen)
    return () => window.removeEventListener('craft:open-goal', onOpen)
  }, [goal, openEditor, quickStartGoal, session.id])

  const prepareGoal = async () => {
    if (!objective.trim()) {
      setError('Add a clear objective.')
      return
    }
    await runAction(async () => {
      const result = await goalCommand<{ proposal: CreateChatGoalInput; confirmationNonce: string }>(session.id, {
        type: 'goalPrepare',
        proposal: {
          objective: objective.trim(),
          doneWhen: doneWhen.trim() || undefined,
          maxRounds,
          tokenBudget: tokenBudget.trim() ? Number(tokenBudget) : undefined,
        },
      })
      setObjective(result.proposal.objective)
      setDoneWhen(result.proposal.doneWhen ?? '')
      setMaxRounds(result.proposal.maxRounds ?? 6)
      setTokenBudget(result.proposal.tokenBudget?.toString() ?? '')
      setConfirmationNonce(result.confirmationNonce)
    })
  }

  const startGoal = async () => {
    if (!confirmationNonce) return prepareGoal()
    let started = false
    await runAction(async () => {
      await goalCommand(session.id, {
        type: 'goalCreate',
        confirmationNonce,
        initialMessage: objective.trim(),
      })
      started = true
      setDialogOpen(false)
    })
    if (!started) setConfirmationNonce(null)
  }

  const saveEdit = async () => {
    if (!goal || !objective.trim()) return
    await runAction(async () => {
      await goalCommand(session.id, {
        type: 'goalEdit',
        goalId: goal.id,
        revision: goal.revision,
        patch: {
          objective: objective.trim(),
          doneWhen: doneWhen.trim() || null,
          maxRounds,
          tokenBudget: tokenBudget.trim() ? Number(tokenBudget) : null,
        },
      })
      setDialogOpen(false)
    })
  }

  const extendAndResume = async () => {
    if (!goal) return
    await runAction(async () => {
      const isTokenExtension = goal.stop?.code === 'token-limit'
      const edited = await goalCommand<ChatGoalState>(session.id, {
        type: 'goalEdit',
        goalId: goal.id,
        revision: goal.revision,
        patch: isTokenExtension
          ? { tokenBudget: Number(tokenBudget) }
          : { maxRounds },
      })
      await goalCommand(session.id, {
        type: 'goalResume',
        goalId: edited.id,
        revision: edited.revision,
      })
      setDialogOpen(false)
    })
  }

  const pause = () => goal && runAction(() => goalCommand(session.id, {
    type: 'goalPause',
    goalId: goal.id,
    revision: goal.revision,
  }))

  const resume = () => goal && runAction(() => goalCommand(session.id, {
    type: 'goalResume',
    goalId: goal.id,
    revision: goal.revision,
  }))

  const stop = () => goal && runAction(async () => {
    await goalCommand(session.id, {
      type: 'goalCancel',
      goalId: goal.id,
      revision: goal.revision,
    })
    if (session.isProcessing) await window.electronAPI.cancelProcessing(session.id, false)
  })

  const startAnother = () => goal && runAction(async () => {
    await goalCommand(session.id, {
      type: 'goalClear',
      goalId: goal.id,
      revision: goal.revision,
    })
    openEditor('create')
  })

  const tokensUsed = goal?.tokenBaseline !== undefined && session.tokenUsage?.totalTokens !== undefined
    ? Math.max(0, session.tokenUsage.totalTokens - goal.tokenBaseline)
    : undefined
  const isTokenExtension = mode === 'extend' && goal?.stop?.code === 'token-limit'
  const minimumRounds = mode === 'extend' && goal
    ? Math.max(2, goal.round, goal.maxRounds + 1)
    : mode === 'edit' && goal
      ? Math.max(2, goal.round)
      : 2
  const roundsValid = Number.isInteger(maxRounds) && maxRounds >= minimumRounds && maxRounds <= 12
  const parsedTokenBudget = tokenBudget.trim() ? Number(tokenBudget) : undefined
  const tokenBudgetValid = parsedTokenBudget === undefined
    || (Number.isInteger(parsedTokenBudget) && parsedTokenBudget > 0)
  const tokenExtensionValid = !isTokenExtension
    || (parsedTokenBudget !== undefined
      && tokenBudgetValid
      && parsedTokenBudget > Math.max(goal?.tokenBudget ?? 0, tokensUsed ?? 0))
  const isTokenLimitedGoal = goal?.status === 'budget-limited' && goal.stop?.code === 'token-limit'

  return (
    <>
      {goal && expanded && (
        <section
          aria-label="Chat Goal"
          className="mb-1.5 rounded-[10px] border border-white/[0.08] bg-white/[0.035] px-3 py-2"
        >
          <div className="flex min-w-0 items-center gap-2">
            <Target className={cn('h-3.5 w-3.5 shrink-0', STATUS_TONE[goal.status])} aria-hidden="true" />
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
              onClick={() => setExpanded(value => !value)}
              aria-expanded={expanded}
            >
              <span className={cn('shrink-0 text-[12px] font-medium', STATUS_TONE[goal.status])}>
                {STATUS_LABEL[goal.status]}
              </span>
              <span className="shrink-0 text-[11px] text-white/38">· Round {goal.round}/{goal.maxRounds}</span>
              <span className="truncate text-[12px] text-white/62">{goal.objective}</span>
              {expanded
                ? <ChevronUp className="h-3.5 w-3.5 shrink-0 text-white/35" aria-hidden="true" />
                : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-white/35" aria-hidden="true" />}
            </button>

            <div className="flex shrink-0 items-center gap-1">
              {goal.status === 'active' && (
                <Button size="sm" variant="ghost" className="h-7 px-2" disabled={busy} onClick={pause} aria-label="Pause Goal">
                  <Pause /> <span className="hidden @md/panel:inline">Pause</span>
                </Button>
              )}
              {(goal.status === 'paused' || goal.status === 'blocked') && (
                <Button size="sm" variant="ghost" className="h-7 px-2" disabled={busy || session.isProcessing} onClick={resume} aria-label="Resume Goal">
                  <Play /> <span className="hidden @md/panel:inline">Resume</span>
                </Button>
              )}
              {goal.status === 'budget-limited' && (
                <Button size="sm" variant="ghost" className="h-7 px-2" disabled={busy || (!isTokenLimitedGoal && goal.maxRounds >= 12)} onClick={() => openEditor('extend')}>
                  {isTokenLimitedGoal ? 'Increase budget' : 'Add rounds'}
                </Button>
              )}
              {(goal.status === 'complete' || goal.status === 'cancelled') ? (
                <Button size="sm" variant="ghost" className="h-7 px-2" disabled={busy} onClick={startAnother}>New Goal</Button>
              ) : (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-white/52" disabled={busy} onClick={stop} aria-label="Stop Goal now">
                  <Square /> <span className="hidden @md/panel:inline">Stop</span>
                </Button>
              )}
            </div>
          </div>

          {goal.completion?.taskVerification === 'skipped-degraded' && (
            <div role="status" className="mt-2 rounded-md bg-amber-400/[0.08] px-2 py-1.5 text-[11px] text-amber-200/75">
              Goal completed while task tracking was unavailable. Open tasks could not be verified.
            </div>
          )}

          {expanded && (
            <div className="mt-2 border-t border-white/[0.06] pt-2 text-[12px] text-white/55">
              <div className="whitespace-pre-wrap text-white/72">{goal.objective}</div>
              {goal.doneWhen && <div className="mt-1"><span className="text-white/38">Done when:</span> {goal.doneWhen}</div>}
              <div className="mt-1 text-white/38">
                {tokensUsed === undefined ? 'Goal token use unavailable' : `Goal tokens ~${tokensUsed.toLocaleString()}`}
                {session.tokenUsage?.costUsd !== undefined ? ` · Session cost ~$${session.tokenUsage.costUsd.toFixed(2)}` : ''}
              </div>
              {(goal.stop?.message || goal.completion?.summary) && (
                <div className="mt-2 rounded-md bg-white/[0.035] px-2 py-1.5 text-white/62">
                  {goal.stop?.message ?? goal.completion?.summary}
                  {goal.completion?.evidence?.length ? (
                    <ul className="mt-1 list-disc pl-4">
                      {goal.completion.evidence.map(item => <li key={item}>{item}</li>)}
                    </ul>
                  ) : null}
                </div>
              )}
              {goal.status !== 'complete' && goal.status !== 'cancelled' && (
                <Button size="sm" variant="ghost" className="mt-1 h-7 px-2" disabled={busy} onClick={() => openEditor('edit')}>
                  <Pencil /> Edit Goal
                </Button>
              )}
              {error && <p role="alert" className="mt-1 text-destructive">{error}</p>}
            </div>
          )}
        </section>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{mode === 'create' ? (confirmationNonce ? 'Confirm Goal' : 'Start a Goal') : mode === 'edit' ? 'Edit Goal' : isTokenExtension ? 'Increase token budget' : 'Add rounds and resume'}</DialogTitle>
            <DialogDescription>
              {mode === 'create'
                ? 'This agent will keep working in this chat, one bounded round at a time. Permissions never expand.'
                : mode === 'extend'
                  ? `Choose a higher ${isTokenExtension ? 'token budget' : 'round cap'}. Resuming uses the same chat, agent, model, and permissions.`
                  : 'Changes invalidate any reserved continuation and apply to the next Goal round.'}
            </DialogDescription>
          </DialogHeader>

          {mode !== 'extend' && (
            <>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">Objective</span>
                <Textarea
                  value={objective}
                  onChange={event => {
                    setObjective(event.target.value)
                    if (confirmationNonce) setConfirmationNonce(null)
                  }}
                  placeholder="What should this agent finish?"
                  maxLength={4000}
                  autoFocus
                  disabled={busy}
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">Done when <span className="font-normal text-muted-foreground">(optional)</span></span>
                <Textarea
                  value={doneWhen}
                  onChange={event => {
                    setDoneWhen(event.target.value)
                    if (confirmationNonce) setConfirmationNonce(null)
                  }}
                  placeholder="Evidence or finish condition"
                  maxLength={2000}
                  disabled={busy}
                />
              </label>
            </>
          )}

          {!isTokenExtension && (
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">Maximum rounds</span>
              <Input
                type="number"
                min={minimumRounds}
                max={12}
                value={maxRounds}
                onChange={event => {
                  setMaxRounds(Number(event.target.value))
                  if (confirmationNonce) setConfirmationNonce(null)
                }}
                disabled={busy}
              />
              <span className="text-xs text-muted-foreground">2–12 total rounds. The first turn counts.</span>
            </label>
          )}

          {(tokenBudget || isTokenExtension) && (
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">Token budget</span>
              <Input
                type="number"
                min={1}
                step={1000}
                value={tokenBudget}
                onChange={event => {
                  setTokenBudget(event.target.value)
                  if (confirmationNonce) setConfirmationNonce(null)
                }}
                disabled={busy}
              />
              <span className="text-xs text-muted-foreground">Approximate provider-reported tokens used by this Goal.</span>
            </label>
          )}

          {confirmationNonce && mode === 'create' && (
            <div className="rounded-md border border-white/[0.08] bg-white/[0.035] p-3 text-sm">
              <div className="font-medium">Review before starting</div>
              <div className="mt-1 whitespace-pre-wrap text-muted-foreground">{objective}</div>
              <div className="mt-2 text-xs text-muted-foreground">
                Up to {maxRounds} rounds{parsedTokenBudget ? ` and ~${parsedTokenBudget.toLocaleString()} tokens` : ''}. Restart, approval, auth, or a required decision pauses the Goal.
              </div>
            </div>
          )}

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)} disabled={busy}>Cancel</Button>
            {mode === 'create' && !confirmationNonce && <Button onClick={prepareGoal} disabled={busy || !objective.trim() || !roundsValid || !tokenBudgetValid}>Review Goal</Button>}
            {mode === 'create' && confirmationNonce && <Button onClick={startGoal} disabled={busy}>Start Goal</Button>}
            {mode === 'edit' && <Button onClick={saveEdit} disabled={busy || !objective.trim() || !roundsValid || !tokenBudgetValid}>Save changes</Button>}
            {mode === 'extend' && <Button onClick={extendAndResume} disabled={busy || !goal || (!roundsValid && !isTokenExtension) || !tokenExtensionValid}>{isTokenExtension ? 'Increase budget and resume' : 'Add rounds and resume'}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
