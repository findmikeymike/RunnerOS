import * as React from 'react'
import { toast } from 'sonner'
import { Check, ExternalLink, Play, Plus, ShieldCheck, Trash2, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useNavigation } from '@/contexts/NavigationContext'
import { useTeams } from '@/hooks/useTeams'
import { useTeamRuns } from '@/hooks/useTeamRuns'
import { routes } from '../../shared/routes'
import type { TeamDTO, TeamRunDetail, TeamRunSnapshot } from '../../shared/types'

interface TeamsListPageProps {
  workspaceId: string
  teamSlug?: string
}

export default function TeamsListPage({ workspaceId, teamSlug }: TeamsListPageProps) {
  const { navigate } = useNavigation()
  const { allTeams, loading, error, remove } = useTeams()
  const { runs, detailsById, start, createTask, updateTask } = useTeamRuns(workspaceId)
  const selectedTeam = React.useMemo(
    () => allTeams.find((team) => team.slug === teamSlug) ?? null,
    [allTeams, teamSlug],
  )
  const selectedRuntimeTeam = selectedTeam ?? allTeams[0] ?? null
  const selectedRuns = React.useMemo(
    () => selectedRuntimeTeam ? runs.filter((run) => run.teamSlug === selectedRuntimeTeam.slug) : [],
    [runs, selectedRuntimeTeam],
  )
  const latestRun = selectedRuns[0] ?? null
  const latestDetail = latestRun ? detailsById[latestRun.id] : undefined

  const handleDelete = async (team: TeamDTO) => {
    if (!window.confirm(`Delete ${team.metadata.name}?`)) return
    try {
      const ok = await remove(team.slug)
      if (ok) {
        toast.success(`Deleted ${team.metadata.name}`)
        if (teamSlug === team.slug) navigate(routes.view.teams())
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleStartRun = async (team: TeamDTO) => {
    const userRequest = window.prompt(`What should ${team.metadata.name} do?`)
    if (!userRequest?.trim()) return
    try {
      const run = await start({ teamSlug: team.slug, userRequest })
      toast.success(`Started ${team.metadata.name}`)
      navigate(routes.view.team(team.slug))
      if (run.leadSessionId) navigate(routes.view.allSessions(run.leadSessionId), { newPanel: true })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleCreateTask = async (run: TeamRunSnapshot, team: TeamDTO) => {
    const title = window.prompt('Task title')
    if (!title?.trim()) return
    const owner = window.prompt('Owner agent slug', team.metadata.members[0]?.slug ?? team.metadata.lead)
    if (!owner?.trim()) return
    try {
      await createTask(run.id, {
        title,
        description: '',
        ownerAgentSlug: owner.trim(),
      })
      toast.success('Task created')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleCompleteTask = async (run: TeamRunSnapshot, taskId: string) => {
    try {
      await updateTask(run.id, taskId, { status: 'done' })
      toast.success('Task marked done')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleApprovalDecision = async (run: TeamRunSnapshot, task: TeamRunDetail['tasks'][number], decision: 'approved' | 'rejected') => {
    if (!task.approval) return
    const note = decision === 'rejected' ? window.prompt('Reason for rejection?') ?? undefined : undefined
    try {
      await updateTask(run.id, task.id, {
        status: decision === 'approved' ? 'in_progress' : 'blocked',
        approval: {
          ...task.approval,
          status: decision,
          decidedAt: new Date().toISOString(),
          decisionNote: note,
        },
        blockedReason: decision === 'rejected' ? (note || 'User rejected approval request') : undefined,
      })
      toast.success(decision === 'approved' ? 'Approval granted' : 'Approval rejected')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="runneros-glass-route h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-7 py-7">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[28px] font-semibold leading-tight text-white">Teams</h1>
            <p className="mt-1 max-w-lg text-[12px] leading-[18px] text-white/54">
              Saved groups of agents with one lead, specialist members, and a verification policy.
            </p>
          </div>
          <Badge variant="secondary" className="shrink-0 border-white/[0.08] bg-white/[0.055] text-white/70">
            {allTeams.length} saved
          </Badge>
        </div>

        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-white/50">Loading teams...</div>
        ) : error ? (
          <div className="rounded-[14px] border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>
        ) : allTeams.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-white/48">
            <Users className="h-9 w-9 opacity-60" />
            <div>
              <p className="text-sm font-medium text-white">No teams yet</p>
              <p className="mt-1 text-xs">Starter teams are seeded when the Teams library is initialized.</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {allTeams.map((team) => (
                <TeamCard
                  key={team.slug}
                  team={team}
                  selected={team.slug === teamSlug}
                  onOpen={() => navigate(routes.view.team(team.slug))}
                  onStart={() => void handleStartRun(team)}
                  onDelete={() => void handleDelete(team)}
                />
              ))}
            </div>

            {selectedRuntimeTeam ? (
              <TeamDetailPanel
                team={selectedRuntimeTeam}
                runs={selectedRuns}
                latestDetail={latestDetail}
                onStart={() => void handleStartRun(selectedRuntimeTeam)}
                onOpenLead={(sessionId) => navigate(routes.view.allSessions(sessionId), { newPanel: true })}
                onCreateTask={latestRun ? () => void handleCreateTask(latestRun, selectedRuntimeTeam) : undefined}
                onCompleteTask={latestRun ? (taskId) => void handleCompleteTask(latestRun, taskId) : undefined}
                onDecideApproval={latestRun ? (task, decision) => void handleApprovalDecision(latestRun, task, decision) : undefined}
              />
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

function TeamCard({
  team,
  selected,
  onOpen,
  onStart,
  onDelete,
}: {
  team: TeamDTO
  selected: boolean
  onOpen: () => void
  onStart: () => void
  onDelete: () => void
}) {
  const verification = team.metadata.verification?.default ?? 'off'

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      className={[
        'group cursor-pointer rounded-[14px] border p-4 text-left transition-colors focus:outline-none focus:ring-1 focus:ring-[#38bdf8]/45',
        selected
          ? 'border-[#38bdf8]/35 bg-[#38bdf8]/10'
          : 'border-white/[0.08] bg-white/[0.035] hover:bg-white/[0.06]',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-white/[0.08] bg-white/[0.055] text-lg">
            {team.metadata.avatar ?? <Users className="h-4 w-4 text-white/60" />}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-white">{team.metadata.name}</div>
            <div className="mt-0.5 truncate text-[11px] text-white/42">@{team.slug}</div>
          </div>
        </div>
        <span
          className="rounded-[7px] border border-white/[0.08] bg-white/[0.045] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-white/50"
        >
          {team.metadata.standing ? 'Standing' : 'Ad hoc'}
        </span>
      </div>

      <p className="mt-3 line-clamp-2 text-[12px] leading-[18px] text-white/58">{team.metadata.description}</p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        <TeamPill>Lead: {team.metadata.lead}</TeamPill>
        <TeamPill>{team.metadata.members.length} members</TeamPill>
        <TeamPill>Verify: {verification}</TeamPill>
      </div>

      <div className="mt-4 flex justify-end">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-white/62 hover:text-white"
          onClick={(event) => {
            event.stopPropagation()
            onStart()
          }}
        >
          <Play className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-white/45 hover:text-red-200"
          onClick={(event) => {
            event.stopPropagation()
            onDelete()
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </article>
  )
}

function TeamDetailPanel({
  team,
  runs,
  latestDetail,
  onStart,
  onOpenLead,
  onCreateTask,
  onCompleteTask,
  onDecideApproval,
}: {
  team: TeamDTO
  runs: TeamRunSnapshot[]
  latestDetail?: TeamRunDetail
  onStart: () => void
  onOpenLead: (sessionId: string) => void
  onCreateTask?: () => void
  onCompleteTask?: (taskId: string) => void
  onDecideApproval?: (task: TeamRunDetail['tasks'][number], decision: 'approved' | 'rejected') => void
}) {
  const verification = team.metadata.verification
  const latestRun = runs[0]
  const approvalTasks = latestDetail?.tasks.filter((task) => task.approval?.status === 'requested') ?? []

  return (
    <aside className="rounded-[14px] border border-white/[0.08] bg-white/[0.035] p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border border-white/[0.08] bg-white/[0.055] text-xl">
          {team.metadata.avatar ?? <Users className="h-5 w-5 text-white/60" />}
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-white">{team.metadata.name}</h2>
          <p className="mt-1 text-[12px] leading-[18px] text-white/55">{team.metadata.description}</p>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <div className="flex gap-2">
          <Button size="sm" className="h-8 flex-1 bg-[#38bdf8]/18 text-white hover:bg-[#38bdf8]/26" onClick={onStart}>
            <Play className="mr-1.5 h-3.5 w-3.5" />
            Start run
          </Button>
          {latestRun?.leadSessionId ? (
            <Button size="sm" variant="ghost" className="h-8 px-2 text-white/62 hover:text-white" onClick={() => onOpenLead(latestRun.leadSessionId!)}>
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>

        <DetailBlock title="Lead">
          <TeamPill>{team.metadata.lead}</TeamPill>
        </DetailBlock>

        <DetailBlock title="Latest run">
          {latestRun ? (
            <div className="rounded-[10px] border border-white/[0.07] bg-black/10 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-white/86">{latestRun.state}</span>
                <span className="text-[10px] text-white/36">{new Date(latestRun.createdAt).toLocaleString()}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-[11px] leading-[16px] text-white/50">{latestRun.userRequest}</p>
            </div>
          ) : (
            <p className="text-[12px] text-white/45">No runs yet.</p>
          )}
        </DetailBlock>

        <DetailBlock title="Task board">
          {latestDetail ? (
            <div className="space-y-2">
              <div className="flex justify-end">
                {onCreateTask ? (
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-white/56 hover:text-white" onClick={onCreateTask}>
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Task
                  </Button>
                ) : null}
              </div>
              {latestDetail.tasks.length === 0 ? (
                <p className="text-[12px] text-white/45">No tasks created yet.</p>
              ) : latestDetail.tasks.map((task) => (
                <div key={task.id} className="rounded-[10px] border border-white/[0.07] bg-black/10 px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-medium text-white/86">{task.title}</div>
                      <div className="mt-0.5 text-[11px] text-white/45">@{task.ownerAgentSlug}</div>
                    </div>
                    <TeamPill>{task.status}</TeamPill>
                  </div>
                  {task.status !== 'done' && onCompleteTask ? (
                    <Button size="sm" variant="ghost" className="mt-2 h-7 px-2 text-white/50 hover:text-white" onClick={() => onCompleteTask(task.id)}>
                      Mark done
                    </Button>
                  ) : null}
                  {task.approval?.status === 'requested' ? (
                    <div className="mt-2 rounded-[8px] border border-amber-400/20 bg-amber-400/10 px-2 py-1.5 text-[11px] leading-[16px] text-amber-100/80">
                      Approval: {task.approval.reason}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-white/45">Start a run to create tasks.</p>
          )}
        </DetailBlock>

        <DetailBlock title="Members">
          <div className="space-y-2">
            {team.metadata.members.map((member) => (
              <div key={member.slug} className="rounded-[10px] border border-white/[0.07] bg-black/10 px-3 py-2">
                <div className="text-[12px] font-medium text-white/86">@{member.slug}</div>
                <div className="mt-0.5 text-[11px] leading-[16px] text-white/50">{member.role}</div>
              </div>
            ))}
          </div>
        </DetailBlock>

        <DetailBlock title="Verification">
          <div className="flex items-center gap-2 text-[12px] text-white/62">
            <ShieldCheck className="h-4 w-4 text-[#38bdf8]" />
            <span>{verification?.default ?? 'off'}</span>
          </div>
          {verification?.requiredFor?.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {verification.requiredFor.map((action) => (
                <TeamPill key={action}>{action.replace(/_/g, ' ')}</TeamPill>
              ))}
            </div>
          ) : null}
        </DetailBlock>

        <DetailBlock title="Approvals">
          {approvalTasks.length ? (
            <div className="space-y-2">
              {approvalTasks.map((task) => (
                <div key={task.id} className="rounded-[10px] border border-amber-400/20 bg-amber-400/10 px-3 py-2">
                  <div className="text-[12px] font-medium text-white/86">{task.title}</div>
                  <p className="mt-1 text-[11px] leading-[16px] text-amber-100/78">{task.approval?.reason}</p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" className="h-7 flex-1 bg-emerald-400/16 text-emerald-50 hover:bg-emerald-400/24" onClick={() => onDecideApproval?.(task, 'approved')}>
                      <Check className="mr-1 h-3.5 w-3.5" />
                      Approve
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 flex-1 text-red-100/72 hover:text-red-50" onClick={() => onDecideApproval?.(task, 'rejected')}>
                      <X className="mr-1 h-3.5 w-3.5" />
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-white/45">No approvals waiting.</p>
          )}
        </DetailBlock>

        <DetailBlock title="Activity">
          {latestDetail?.events.length ? (
            <div className="space-y-1.5">
              {latestDetail.events.slice(-5).reverse().map((event) => (
                <div key={event.id} className="text-[11px] leading-[16px] text-white/45">
                  <span className="text-white/66">{event.kind}</span>
                  {event.body ? `: ${event.body}` : ''}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-white/45">No activity yet.</p>
          )}
        </DetailBlock>
      </div>
    </aside>
  )
}

function DetailBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-white/36">{title}</h3>
      {children}
    </section>
  )
}

function TeamPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-[7px] border border-white/[0.08] bg-white/[0.045] px-2 py-0.5 text-[11px] text-white/58">
      {children}
    </span>
  )
}
