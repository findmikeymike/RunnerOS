import * as React from 'react'
import { toast } from 'sonner'
import { Archive, Check, Copy, ExternalLink, Pencil, Play, Plus, ShieldCheck, Trash2, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useNavigation } from '@/contexts/NavigationContext'
import { useTeams } from '@/hooks/useTeams'
import { useTeamRuns } from '@/hooks/useTeamRuns'
import { STARTER_TEAMS } from '@craft-agent/shared/teams'
import { routes } from '../../shared/routes'
import type { TeamDTO, TeamMetadataDTO, TeamRunDetail, TeamRunSnapshot } from '../../shared/types'

interface TeamsListPageProps {
  workspaceId: string
  teamSlug?: string
}

interface TeamLibraryStats {
  activeTasks: number
  blockedTasks: number
  lastActivityIso?: string
}

export default function TeamsListPage({ workspaceId, teamSlug }: TeamsListPageProps) {
  const { navigate } = useNavigation()
  const { allTeams, loading, error, upsert, remove } = useTeams()
  const { runs, detailsById, get, start, updateTask } = useTeamRuns(workspaceId)
  const [selectedRunIdByTeam, setSelectedRunIdByTeam] = React.useState<Record<string, string>>({})
  const requestedCardRunDetailsRef = React.useRef(new Set<string>())
  const selectedTeam = React.useMemo(
    () => allTeams.find((team) => team.slug === teamSlug) ?? null,
    [allTeams, teamSlug],
  )
  const activeTeams = React.useMemo(() => allTeams.filter((team) => !team.metadata.archived), [allTeams])
  const archivedTeams = React.useMemo(() => allTeams.filter((team) => team.metadata.archived), [allTeams])
  const selectedRuntimeTeam = selectedTeam ?? activeTeams[0] ?? allTeams[0] ?? null
  const selectedRuns = React.useMemo(
    () => selectedRuntimeTeam ? runs.filter((run) => run.teamSlug === selectedRuntimeTeam.slug) : [],
    [runs, selectedRuntimeTeam],
  )
  const selectedRunId = selectedRuntimeTeam ? selectedRunIdByTeam[selectedRuntimeTeam.slug] : undefined
  const activeRun = selectedRuns.find((run) => run.id === selectedRunId) ?? selectedRuns[0] ?? null
  const activeDetail = activeRun ? detailsById[activeRun.id] : undefined
  const teamStatsBySlug = React.useMemo(() => {
    const out = new Map<string, TeamLibraryStats>()
    for (const team of allTeams) {
      const teamRuns = runs.filter((run) => run.teamSlug === team.slug)
      const details = teamRuns.map((run) => detailsById[run.id]).filter((detail): detail is TeamRunDetail => Boolean(detail))
      const activeTasks = details.reduce((count, detail) => {
        return count + detail.tasks.filter((task) => task.status === 'todo' || task.status === 'in_progress' || task.status === 'review').length
      }, 0)
      const blockedTasks = details.reduce((count, detail) => {
        return count + detail.tasks.filter((task) => task.status === 'blocked').length
      }, 0)
      const lastActivityIso = teamRuns
        .map((run) => run.updatedAt || run.createdAt)
        .sort()
        .at(-1)
      out.set(team.slug, { activeTasks, blockedTasks, lastActivityIso })
    }
    return out
  }, [allTeams, detailsById, runs])

  React.useEffect(() => {
    if (!activeRun || detailsById[activeRun.id]) return
    void get(activeRun.id).catch((err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    })
  }, [activeRun, detailsById, get])

  React.useEffect(() => {
    for (const team of allTeams) {
      const latestRun = runs.find((run) => run.teamSlug === team.slug)
      if (!latestRun || detailsById[latestRun.id]) continue
      const requestKey = `${workspaceId}:${latestRun.id}`
      if (requestedCardRunDetailsRef.current.has(requestKey)) continue
      requestedCardRunDetailsRef.current.add(requestKey)
      void get(latestRun.id).catch((err) => {
        requestedCardRunDetailsRef.current.delete(requestKey)
        toast.error(err instanceof Error ? err.message : String(err))
      })
    }
  }, [allTeams, detailsById, get, runs, workspaceId])

  const handleCreateTeam = async () => {
    const name = window.prompt('Team name')
    if (!name?.trim()) return
    const slug = window.prompt('Team slug', toSlug(name))
    if (!slug?.trim()) return
    const description = window.prompt('Description', 'Coordinates a reusable team of agents.') ?? ''
    const lead = window.prompt('Lead agent slug', 'orchestrator')
    if (!lead?.trim()) return
    const membersText = window.prompt('Members as slug: role, one per line', 'reviewer: Verification')
    const members = parseMembers(membersText ?? '')
    if (members.length === 0) {
      toast.error('Add at least one member as slug: role')
      return
    }
    try {
      const saved = await upsert({
        slug: slug.trim(),
        metadata: {
          name: name.trim(),
          description: description.trim() || 'Coordinates a reusable team of agents.',
          lead: lead.trim(),
          members,
          standing: true,
          permissionMode: 'ask',
          verification: { default: 'advisory', requiredFor: ['code_change', 'deploy', 'publish', 'spend'] },
        },
        body: `# ${name.trim()}\n\nUse this team for coordinated work with explicit task ownership.`,
      })
      toast.success(`Created ${saved.metadata.name}`)
      navigate(routes.view.team(saved.slug))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleCreateFromTemplate = async () => {
    const choices = STARTER_TEAMS.map((team, index) => `${index + 1}. ${team.metadata.name} (${team.slug})`).join('\n')
    const selected = window.prompt(`Choose a team template:\n\n${choices}`, '1')
    if (!selected?.trim()) return
    const selectedIndex = Number.parseInt(selected.trim(), 10) - 1
    const template = STARTER_TEAMS[selectedIndex]
    if (!template) {
      toast.error('Unknown team template')
      return
    }
    const name = window.prompt('Team name', template.metadata.name)
    if (!name?.trim()) return
    const slug = window.prompt('Team slug', uniqueTeamSlug(template.slug, allTeams))
    if (!slug?.trim()) return
    try {
      const saved = await upsert({
        slug: slug.trim(),
        metadata: {
          ...template.metadata,
          name: name.trim(),
          archived: false,
        },
        body: template.body,
      })
      toast.success(`Created ${saved.metadata.name}`)
      navigate(routes.view.team(saved.slug))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleEditTeam = async (team: TeamDTO) => {
    const name = window.prompt('Team name', team.metadata.name)
    if (!name?.trim()) return
    const description = window.prompt('Description', team.metadata.description)
    if (description == null) return
    const lead = window.prompt('Lead agent slug', team.metadata.lead)
    if (!lead?.trim()) return
    const membersText = window.prompt('Members as slug: role, one per line', formatMembers(team.metadata.members))
    if (membersText == null) return
    const members = parseMembers(membersText)
    if (members.length === 0) {
      toast.error('Add at least one member as slug: role')
      return
    }
    try {
      const saved = await upsert({
        slug: team.slug,
        metadata: {
          ...team.metadata,
          name: name.trim(),
          description: description.trim(),
          lead: lead.trim(),
          members,
        },
        body: team.body,
      })
      toast.success(`Updated ${saved.metadata.name}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleDuplicateTeam = async (team: TeamDTO) => {
    const name = window.prompt('New team name', `${team.metadata.name} Copy`)
    if (!name?.trim()) return
    const slug = window.prompt('New team slug', uniqueTeamSlug(toSlug(name), allTeams))
    if (!slug?.trim()) return
    try {
      const saved = await upsert({
        slug: slug.trim(),
        metadata: {
          ...team.metadata,
          name: name.trim(),
          archived: false,
        },
        body: team.body,
      })
      toast.success(`Duplicated ${saved.metadata.name}`)
      navigate(routes.view.team(saved.slug))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleArchiveTeam = async (team: TeamDTO) => {
    try {
      const saved = await upsert({
        slug: team.slug,
        metadata: {
          ...team.metadata,
          archived: !team.metadata.archived,
        },
        body: team.body,
      })
      toast.success(saved.metadata.archived ? 'Team archived' : 'Team unarchived')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

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
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="secondary" className="border-white/[0.08] bg-white/[0.055] text-white/70">
              {activeTeams.length} active
            </Badge>
            {archivedTeams.length ? (
              <Badge variant="secondary" className="border-white/[0.08] bg-white/[0.035] text-white/45">
                {archivedTeams.length} archived
              </Badge>
            ) : null}
            <Button size="sm" className="h-8 bg-[#38bdf8]/18 text-white hover:bg-[#38bdf8]/26" onClick={handleCreateTeam}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New
            </Button>
            <Button size="sm" variant="ghost" className="h-8 px-2 text-white/62 hover:text-white" onClick={handleCreateFromTemplate}>
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              Template
            </Button>
          </div>
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
                  stats={teamStatsBySlug.get(team.slug)}
                  selected={team.slug === teamSlug}
                  onOpen={() => navigate(routes.view.team(team.slug))}
                  onStart={() => void handleStartRun(team)}
                  onEdit={() => void handleEditTeam(team)}
                  onDuplicate={() => void handleDuplicateTeam(team)}
                  onArchive={() => void handleArchiveTeam(team)}
                  onDelete={() => void handleDelete(team)}
                />
              ))}
            </div>

            {selectedRuntimeTeam ? (
              <TeamDetailPanel
                team={selectedRuntimeTeam}
                runs={selectedRuns}
                selectedRun={activeRun}
                selectedDetail={activeDetail}
                onSelectRun={(runId) => setSelectedRunIdByTeam((prev) => ({ ...prev, [selectedRuntimeTeam.slug]: runId }))}
                onStart={() => void handleStartRun(selectedRuntimeTeam)}
                onEdit={() => void handleEditTeam(selectedRuntimeTeam)}
                onDuplicate={() => void handleDuplicateTeam(selectedRuntimeTeam)}
                onArchive={() => void handleArchiveTeam(selectedRuntimeTeam)}
                onOpenLead={(sessionId) => navigate(routes.view.allSessions(sessionId), { newPanel: true })}
                onDecideApproval={activeRun ? (task, decision) => void handleApprovalDecision(activeRun, task, decision) : undefined}
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
  stats,
  selected,
  onOpen,
  onStart,
  onEdit,
  onDuplicate,
  onArchive,
  onDelete,
}: {
  team: TeamDTO
  stats?: TeamLibraryStats
  selected: boolean
  onOpen: () => void
  onStart: () => void
  onEdit: () => void
  onDuplicate: () => void
  onArchive: () => void
  onDelete: () => void
}) {
  const verification = team.metadata.verification?.default ?? 'off'
  const lastActivity = stats?.lastActivityIso ? formatRelativeTime(stats.lastActivityIso) : 'No activity'

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
          {team.metadata.archived ? 'Archived' : team.metadata.standing ? 'Standing' : 'Ad hoc'}
        </span>
      </div>

      <p className="mt-3 line-clamp-2 text-[12px] leading-[18px] text-white/58">{team.metadata.description}</p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        <TeamPill>Lead: {team.metadata.lead}</TeamPill>
        <TeamPill>{team.metadata.members.length} members</TeamPill>
        <TeamPill>Verify: {verification}</TeamPill>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <TeamStat label="Active" value={stats?.activeTasks ?? 0} />
        <TeamStat label="Blocked" value={stats?.blockedTasks ?? 0} tone={(stats?.blockedTasks ?? 0) > 0 ? 'warning' : 'normal'} />
        <TeamStat label="Activity" value={lastActivity} compact />
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
          className="h-7 px-2 text-white/50 hover:text-white"
          onClick={(event) => {
            event.stopPropagation()
            onEdit()
          }}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-white/50 hover:text-white"
          onClick={(event) => {
            event.stopPropagation()
            onDuplicate()
          }}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-white/45 hover:text-white"
          onClick={(event) => {
            event.stopPropagation()
            onArchive()
          }}
        >
          <Archive className="h-3.5 w-3.5" />
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
  selectedRun,
  selectedDetail,
  onSelectRun,
  onStart,
  onEdit,
  onDuplicate,
  onArchive,
  onOpenLead,
  onDecideApproval,
}: {
  team: TeamDTO
  runs: TeamRunSnapshot[]
  selectedRun?: TeamRunSnapshot | null
  selectedDetail?: TeamRunDetail
  onSelectRun: (runId: string) => void
  onStart: () => void
  onEdit: () => void
  onDuplicate: () => void
  onArchive: () => void
  onOpenLead: (sessionId: string) => void
  onDecideApproval?: (task: TeamRunDetail['tasks'][number], decision: 'approved' | 'rejected') => void
}) {
  const verification = team.metadata.verification
  const approvalTasks = selectedDetail?.tasks.filter((task) => task.approval?.status === 'requested') ?? []

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
          <Button size="sm" variant="ghost" className="h-8 px-2 text-white/62 hover:text-white" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-8 px-2 text-white/62 hover:text-white" onClick={onDuplicate}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-8 px-2 text-white/62 hover:text-white" onClick={onArchive}>
            <Archive className="h-3.5 w-3.5" />
          </Button>
          {selectedRun?.leadSessionId ? (
            <Button size="sm" variant="ghost" className="h-8 px-2 text-white/62 hover:text-white" onClick={() => onOpenLead(selectedRun.leadSessionId!)}>
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>

        <DetailBlock title="Lead">
          <TeamPill>{team.metadata.lead}</TeamPill>
        </DetailBlock>

        <DetailBlock title="Runs">
          {runs.length ? (
            <div className="space-y-2">
              {runs.slice(0, 5).map((run) => (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => onSelectRun(run.id)}
                  className={[
                    'w-full rounded-[10px] border px-3 py-2 text-left transition-colors',
                    selectedRun?.id === run.id
                      ? 'border-[#38bdf8]/30 bg-[#38bdf8]/10'
                      : 'border-white/[0.07] bg-black/10 hover:bg-white/[0.045]',
                  ].join(' ')}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-medium text-white/86">{run.state}</span>
                    <span className="text-[10px] text-white/36">{new Date(run.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-[16px] text-white/50">{run.userRequest}</p>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-white/45">No runs yet.</p>
          )}
        </DetailBlock>

        <DetailBlock title="Lead conversation">
          {selectedRun?.leadSessionId ? (
            <Button size="sm" variant="ghost" className="h-8 w-full justify-start px-2 text-white/62 hover:text-white" onClick={() => onOpenLead(selectedRun.leadSessionId!)}>
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Open lead session
            </Button>
          ) : (
            <p className="text-[12px] text-white/45">Start a run to create the lead session.</p>
          )}
        </DetailBlock>

        <DetailBlock title="Task board">
          {selectedDetail ? (
            <div className="space-y-2">
              {selectedDetail.tasks.length === 0 ? (
                <p className="text-[12px] text-white/45">No tasks created yet.</p>
              ) : selectedDetail.tasks.map((task) => {
                return (
                  <div key={task.id} className="rounded-[10px] border border-white/[0.07] bg-black/10 px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[12px] font-medium text-white/86">{task.title}</div>
                        <div className="mt-0.5 text-[11px] text-white/45">@{task.ownerAgentSlug}</div>
                      </div>
                      <TeamPill>{task.status}</TeamPill>
                    </div>
                    {(task.reviewRequired || task.review || task.status === 'review') ? (
                      <div className="mt-2 rounded-[8px] border border-[#38bdf8]/20 bg-[#38bdf8]/10 px-2 py-1.5 text-[11px] leading-[16px] text-sky-100/78">
                        <div className="flex items-center justify-between gap-2">
                          <span>Review: {task.review?.status ?? 'required'}</span>
                          {task.reviewerAgentSlug || task.review?.reviewerAgentSlug ? (
                            <span className="text-white/42">@{task.review?.reviewerAgentSlug ?? task.reviewerAgentSlug}</span>
                          ) : null}
                        </div>
                        {task.review?.findings ? (
                          <p className="mt-1 text-white/60">{task.review.findings}</p>
                        ) : null}
                        {task.output ? (
                          <p className="mt-1 text-white/60"><span className="text-white/38">Output: </span>{task.output}</p>
                        ) : null}
                        {task.evidence?.length ? (
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {task.evidence.map((item, index) => (
                              <TeamPill key={`${task.id}:review:${item.type}:${index}`}>{item.label}: {item.value}</TeamPill>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-1 text-white/38">No output or evidence yet.</p>
                        )}
                      </div>
                    ) : null}
                    {task.output && !task.reviewRequired ? (
                      <div className="mt-2 rounded-[8px] border border-white/[0.07] bg-white/[0.035] px-2 py-1.5 text-[11px] leading-[16px] text-white/62">
                        <span className="text-white/38">Output: </span>{task.output}
                      </div>
                    ) : null}
                    {task.evidence?.length && !task.reviewRequired ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {task.evidence.map((item, index) => (
                          <TeamPill key={`${task.id}:${item.type}:${index}`}>{item.label}: {item.value}</TeamPill>
                        ))}
                      </div>
                    ) : null}
                    {task.approval ? (
                      <div className="mt-2 rounded-[8px] border border-amber-400/20 bg-amber-400/10 px-2 py-1.5 text-[11px] leading-[16px] text-amber-100/80">
                        <div className="flex items-center justify-between gap-2">
                          <span>Approval: {task.approval.status}</span>
                          {task.approval.decidedAt ? (
                            <span className="text-white/38">{new Date(task.approval.decidedAt).toLocaleString()}</span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-amber-100/70">{task.approval.reason}</p>
                        {task.approval.decisionNote ? (
                          <p className="mt-1 text-white/54">{task.approval.decisionNote}</p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-[12px] text-white/45">Start a run to create tasks.</p>
          )}
        </DetailBlock>

        <DetailBlock title="Internal messages">
          {selectedDetail ? (
            <TeamMailbox messages={selectedDetail.messages} />
          ) : (
            <p className="text-[12px] text-white/45">Start a run to use the team mailbox.</p>
          )}
        </DetailBlock>

        <DetailBlock title="Members">
          <div className="space-y-2">
            {team.metadata.members.map((member) => (
              <div key={member.slug} className="rounded-[10px] border border-white/[0.07] bg-black/10 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 truncate text-[12px] font-medium text-white/86">@{member.slug}</div>
                  {selectedDetail?.memberSessionIds?.[member.slug] ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 shrink-0 px-2 text-white/52 hover:text-white"
                      onClick={() => onOpenLead(selectedDetail.memberSessionIds![member.slug]!)}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </div>
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
          {selectedDetail?.events.length ? (
            <div className="space-y-1.5">
              {selectedDetail.events.slice(-8).reverse().map((event) => (
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

function TeamMailbox({
  messages,
}: {
  messages: TeamRunDetail['messages']
}) {
  const unreadCount = messages.filter((message) => !message.readAt).length

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <TeamPill>{unreadCount} unread</TeamPill>
        <span className="text-[11px] text-white/38">Internal agent mailbox</span>
      </div>

      {messages.length ? (
        <div className="space-y-2">
          {messages.slice(-6).reverse().map((message) => (
            <div key={message.id} className="rounded-[10px] border border-white/[0.07] bg-black/10 px-3 py-2">
              <div className="flex items-center justify-between gap-2 text-[11px] text-white/42">
                <span>{message.fromAgentSlug} {'->'} {message.toAgentSlug}</span>
                <span>{message.readAt ? message.kind : `${message.kind} · unread`}</span>
              </div>
              <p className="mt-1 text-[12px] leading-[17px] text-white/70">{message.body}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[12px] text-white/45">No internal messages yet.</p>
      )}
    </div>
  )
}

function TeamPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-[7px] border border-white/[0.08] bg-white/[0.045] px-2 py-0.5 text-[11px] text-white/58">
      {children}
    </span>
  )
}

function TeamStat({
  label,
  value,
  tone = 'normal',
  compact,
}: {
  label: string
  value: React.ReactNode
  tone?: 'normal' | 'warning'
  compact?: boolean
}) {
  return (
    <div className="min-w-0 rounded-[9px] border border-white/[0.07] bg-black/10 px-2 py-1.5">
      <div className="truncate text-[10px] uppercase tracking-[0.08em] text-white/32">{label}</div>
      <div className={[
        'mt-0.5 truncate font-medium',
        compact ? 'text-[11px]' : 'text-[13px]',
        tone === 'warning' ? 'text-amber-100/85' : 'text-white/78',
      ].join(' ')}
      >
        {value}
      </div>
    </div>
  )
}

function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'new-team'
}

function formatRelativeTime(value: string): string {
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return 'Unknown'
  const diffMs = Date.now() - time
  if (diffMs < 60_000) return 'Now'
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(value).toLocaleDateString()
}

function uniqueTeamSlug(base: string, teams: TeamDTO[]): string {
  const taken = new Set(teams.map((team) => team.slug))
  if (!taken.has(base)) return base
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base}-${i}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}-${Date.now()}`
}

function parseMembers(value: string): TeamMetadataDTO['members'] {
  const members: TeamMetadataDTO['members'] = []
  const seen = new Set<string>()
  for (const rawLine of value.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const parts = line.includes(':') ? line.split(':') : line.split(/\s+-\s+/)
    const [rawSlug, ...roleParts] = parts
    const slug = rawSlug?.trim()
    const role = roleParts.join(':').trim()
    if (!slug || !role || seen.has(slug)) continue
    members.push({ slug, role })
    seen.add(slug)
  }
  return members
}

function formatMembers(members: TeamMetadataDTO['members']): string {
  return members.map((member) => `${member.slug}: ${member.role}`).join('\n')
}
