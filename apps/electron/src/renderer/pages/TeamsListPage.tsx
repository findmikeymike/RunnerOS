import * as React from 'react'
import { toast } from 'sonner'
import { Archive, Bell, Check, CheckCircle2, Copy, ExternalLink, Pause, Pencil, Play, Plus, RefreshCw, ShieldCheck, Square, Trash2, UserPlus, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useNavigation } from '@/contexts/NavigationContext'
import { useTeams } from '@/hooks/useTeams'
import { useTeamRuns } from '@/hooks/useTeamRuns'
import { STARTER_TEAMS } from '@craft-agent/shared/teams/starter-templates'
import { routes } from '../../shared/routes'
import type { TeamDTO, TeamMetadataDTO, TeamRunDetail, TeamRunSnapshot, TeamRunTick } from '../../shared/types'

interface TeamsListPageProps {
  workspaceId: string
  teamSlug?: string
}

interface TeamLibraryStats {
  activeTasks: number
  blockedTasks: number
  lastActivityIso?: string
}

type CreateTeamDialogInput = {
  slug: string
  metadata: TeamMetadataDTO
  body: string
}

type TeamMemberDraft = {
  id: string
  slug: string
  role: string
}

type TeamRiskActionDraft = NonNullable<NonNullable<TeamMetadataDTO['verification']>['requiredFor']>[number]

const TEAM_RISK_ACTIONS = [
  { id: 'code_change', label: 'Code changes' },
  { id: 'deploy', label: 'Deploying' },
  { id: 'publish', label: 'Publishing' },
  { id: 'spend', label: 'Spending' },
  { id: 'customer_message', label: 'Customer messages' },
  { id: 'delete', label: 'Deleting' },
  { id: 'refund', label: 'Refunds' },
  { id: 'external_action', label: 'External actions' },
] as const

const TEAM_AGENT_SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

export default function TeamsListPage({ workspaceId, teamSlug }: TeamsListPageProps) {
  const { navigate } = useNavigation()
  const { allTeams, loading, error, upsert, remove } = useTeams()
  const { runs, detailsById, ticksByRunId, get, start, control, complete, tick, listTicks, wakeAgent, updateTask } = useTeamRuns(workspaceId)
  const [selectedRunIdByTeam, setSelectedRunIdByTeam] = React.useState<Record<string, string>>({})
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false)
  const [createTemplateSlug, setCreateTemplateSlug] = React.useState<string | null>(null)
  const requestedCardRunDetailsRef = React.useRef(new Set<string>())
  const selectedTeam = React.useMemo(
    () => allTeams.find((team) => team.slug === teamSlug) ?? null,
    [allTeams, teamSlug],
  )
  const activeTeams = React.useMemo(() => allTeams.filter((team) => !team.metadata.archived), [allTeams])
  const archivedTeams = React.useMemo(() => allTeams.filter((team) => team.metadata.archived), [allTeams])
  const selectedRuntimeTeam = selectedTeam
  const selectedRuns = React.useMemo(
    () => selectedRuntimeTeam ? runs.filter((run) => run.teamSlug === selectedRuntimeTeam.slug) : [],
    [runs, selectedRuntimeTeam],
  )
  const selectedRunId = selectedRuntimeTeam ? selectedRunIdByTeam[selectedRuntimeTeam.slug] : undefined
  const activeRun = selectedRuns.find((run) => run.id === selectedRunId) ?? selectedRuns[0] ?? null
  const activeDetail = activeRun ? detailsById[activeRun.id] : undefined
  const activeTicks = activeRun ? (ticksByRunId[activeRun.id] ?? []) : []
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
    if (!activeRun || ticksByRunId[activeRun.id]) return
    void listTicks(activeRun.id).catch((err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    })
  }, [activeRun, listTicks, ticksByRunId])

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

  const openCreateDialog = (templateSlug?: string) => {
    setCreateTemplateSlug(templateSlug ?? null)
    setCreateDialogOpen(true)
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
    const rejectionNote = decision === 'rejected' ? window.prompt('Reason for rejection?') : undefined
    if (rejectionNote === null) return
    const note = rejectionNote ?? undefined
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

  const handleRunControl = async (run: TeamRunSnapshot, action: 'pause' | 'resume' | 'cancel') => {
    const reason = action === 'resume' ? undefined : window.prompt(action === 'pause' ? 'Pause reason?' : 'Cancel reason?')
    if (reason === null) return
    try {
      await control(run.id, { action, reason: reason?.trim() || undefined })
      toast.success(action === 'pause' ? 'Run paused' : action === 'resume' ? 'Run resumed' : 'Run cancelled')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleRunTick = async (run: TeamRunSnapshot) => {
    try {
      const result = await tick(run.id, { reason: 'manual' })
      const usefulActions = result.tick.actions.filter((action) => action.type !== 'no-op')
      toast.success(usefulActions.length ? `Ran loop: ${usefulActions.map((action) => action.type).join(', ')}` : 'Run loop checked')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleWakeAgent = async (run: TeamRunSnapshot, agentSlug: string, taskId?: string) => {
    try {
      const result = await wakeAgent(run.id, agentSlug, taskId)
      toast.success(`${result.status === 'created' ? 'Created' : 'Woke'} @${agentSlug}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleCompleteRun = async (run: TeamRunSnapshot) => {
    const summary = window.prompt('Final team summary?')
    if (!summary?.trim()) return
    try {
      await complete(run.id, { summary: summary.trim() })
      toast.success('Team run completed')
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
            <Button size="sm" className="h-8 bg-[#38bdf8]/18 text-white hover:bg-[#38bdf8]/26" onClick={() => openCreateDialog()}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New
            </Button>
            <Button size="sm" variant="ghost" className="h-8 px-2 text-white/62 hover:text-white" onClick={() => openCreateDialog(STARTER_TEAMS[0]?.slug)}>
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
                ticks={activeTicks}
                onSelectRun={(runId) => setSelectedRunIdByTeam((prev) => ({ ...prev, [selectedRuntimeTeam.slug]: runId }))}
                onStart={() => void handleStartRun(selectedRuntimeTeam)}
                onEdit={() => void handleEditTeam(selectedRuntimeTeam)}
                onDuplicate={() => void handleDuplicateTeam(selectedRuntimeTeam)}
                onArchive={() => void handleArchiveTeam(selectedRuntimeTeam)}
                onOpenLead={(sessionId) => navigate(routes.view.allSessions(sessionId), { newPanel: true })}
                onControlRun={(run, action) => void handleRunControl(run, action)}
                onTickRun={(run) => void handleRunTick(run)}
                onWakeAgent={(run, agentSlug, taskId) => void handleWakeAgent(run, agentSlug, taskId)}
                onCompleteRun={(run) => void handleCompleteRun(run)}
                onDecideApproval={activeRun ? (task, decision) => void handleApprovalDecision(activeRun, task, decision) : undefined}
              />
            ) : (
              <div className="hidden min-h-[420px] items-center justify-center rounded-[14px] border border-white/[0.08] bg-white/[0.025] p-6 text-center text-sm text-white/46 xl:flex">
                Select a team to see active runs.
              </div>
            )}
          </div>
        )}
      </div>
      <CreateTeamDialog
        open={createDialogOpen}
        initialTemplateSlug={createTemplateSlug}
        teams={allTeams}
        onOpenChange={setCreateDialogOpen}
        onCreate={async (input) => {
          const saved = await upsert(input)
          toast.success(`Created ${saved.metadata.name}`)
          navigate(routes.view.team(saved.slug))
        }}
      />
    </div>
  )
}

function CreateTeamDialog({
  open,
  initialTemplateSlug,
  teams,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  initialTemplateSlug: string | null
  teams: TeamDTO[]
  onOpenChange: (open: boolean) => void
  onCreate: (input: CreateTeamDialogInput) => Promise<void>
}) {
  const [mode, setMode] = React.useState<'scratch' | 'template'>('scratch')
  const [templateSlug, setTemplateSlug] = React.useState(STARTER_TEAMS[0]?.slug ?? '')
  const [name, setName] = React.useState('')
  const [slug, setSlug] = React.useState('')
  const [slugTouched, setSlugTouched] = React.useState(false)
  const [description, setDescription] = React.useState('')
  const [avatar, setAvatar] = React.useState('')
  const [lead, setLead] = React.useState('orchestrator')
  const [standing, setStanding] = React.useState(true)
  const [permissionMode, setPermissionMode] = React.useState<TeamMetadataDTO['permissionMode']>('ask')
  const [verificationDefault, setVerificationDefault] = React.useState<'off' | 'advisory' | 'blocking'>('advisory')
  const [requiredFor, setRequiredFor] = React.useState<TeamRiskActionDraft[]>(['code_change', 'deploy', 'publish', 'spend'])
  const [members, setMembers] = React.useState<TeamMemberDraft[]>(() => [
    { id: crypto.randomUUID(), slug: 'reviewer', role: 'Verification and final review' },
  ])
  const [body, setBody] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)

  const existingSlugs = React.useMemo(() => new Set(teams.map((team) => team.slug)), [teams])

  const applyTemplate = React.useCallback((template?: typeof STARTER_TEAMS[number]) => {
    if (!template) return
    setName(template.metadata.name)
    setSlug(uniqueTeamSlug(template.slug, teams))
    setSlugTouched(false)
    setDescription(template.metadata.description)
    setAvatar(template.metadata.avatar ?? '')
    setLead(template.metadata.lead)
    setStanding(template.metadata.standing ?? true)
    setPermissionMode(template.metadata.permissionMode ?? 'ask')
    setVerificationDefault(template.metadata.verification?.default ?? 'advisory')
    setRequiredFor([...(template.metadata.verification?.requiredFor ?? [])])
    setMembers(template.metadata.members.map((member) => ({ id: crypto.randomUUID(), slug: member.slug, role: member.role })))
    setBody(template.body)
  }, [teams])

  const resetScratch = React.useCallback(() => {
    setName('')
    setSlug('')
    setSlugTouched(false)
    setDescription('Coordinates a reusable team of agents.')
    setAvatar('')
    setLead('orchestrator')
    setStanding(true)
    setPermissionMode('ask')
    setVerificationDefault('advisory')
    setRequiredFor(['code_change', 'deploy', 'publish', 'spend'])
    setMembers([{ id: crypto.randomUUID(), slug: 'reviewer', role: 'Verification and final review' }])
    setBody('')
  }, [])

  const lastOpenKeyRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!open) return
    const openKey = initialTemplateSlug ? `template:${initialTemplateSlug}` : 'scratch'
    if (lastOpenKeyRef.current === openKey) return
    lastOpenKeyRef.current = openKey
    if (initialTemplateSlug) {
      const template = STARTER_TEAMS.find((team) => team.slug === initialTemplateSlug) ?? STARTER_TEAMS[0]
      setMode('template')
      setTemplateSlug(template?.slug ?? '')
      applyTemplate(template)
    } else {
      setMode('scratch')
      resetScratch()
    }
  }, [applyTemplate, initialTemplateSlug, open, resetScratch])
  React.useEffect(() => {
    if (!open) lastOpenKeyRef.current = null
  }, [open])

  const normalizedSlug = toSlug(slug || name)
  const validMembers = members
    .map((member) => ({ slug: member.slug.trim(), role: member.role.trim() }))
    .filter((member) => member.slug && member.role)
  const duplicateMember = new Set(validMembers.map((member) => member.slug)).size !== validMembers.length
  const incompleteMember = members.some((member) => {
    const hasSlug = Boolean(member.slug.trim())
    const hasRole = Boolean(member.role.trim())
    return hasSlug !== hasRole
  })
  const invalidLead = Boolean(lead.trim() && !TEAM_AGENT_SLUG_REGEX.test(lead.trim()))
  const invalidMember = members.some((member) => Boolean(member.slug.trim()) && !TEAM_AGENT_SLUG_REGEX.test(member.slug.trim()))
  const leadIsMember = validMembers.some((member) => member.slug === lead.trim())
  const canSubmit = Boolean(
    name.trim()
    && normalizedSlug
    && lead.trim()
    && TEAM_AGENT_SLUG_REGEX.test(normalizedSlug)
    && !invalidLead
    && validMembers.length > 0
    && !incompleteMember
    && !invalidMember
    && !duplicateMember
    && !leadIsMember
    && !existingSlugs.has(normalizedSlug),
  )

  const updateMember = (id: string, patch: Partial<TeamMemberDraft>) => {
    setMembers((prev) => prev.map((member) => member.id === id ? { ...member, ...patch } : member))
  }

  const addMember = (draft?: Partial<TeamMemberDraft>) => {
    setMembers((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        slug: draft?.slug ?? '',
        role: draft?.role ?? '',
      },
    ])
  }

  const removeMember = (id: string) => {
    setMembers((prev) => prev.length <= 1 ? prev : prev.filter((member) => member.id !== id))
  }

  const toggleRiskAction = (action: TeamRiskActionDraft) => {
    setRequiredFor((prev) => prev.includes(action) ? prev.filter((item) => item !== action) : [...prev, action])
  }

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const cleanName = name.trim()
      await onCreate({
        slug: normalizedSlug,
        metadata: {
          name: cleanName,
          description: description.trim() || 'Coordinates a reusable team of agents.',
          avatar: avatar.trim() || undefined,
          lead: lead.trim(),
          members: validMembers,
          standing,
          archived: false,
          permissionMode,
          verification: {
            default: verificationDefault,
            requiredFor,
          },
        },
        body: body.trim() || `# ${cleanName}\n\nUse this team for coordinated work with explicit ownership, review, and approvals.\n`,
      })
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-4xl !rounded-[18px] !border !border-white/[0.09] !bg-[#090a0d] p-0 !text-white shadow-middle">
        <DialogHeader className="border-b border-white/[0.08] px-5 py-4">
          <DialogTitle className="text-white">Create team</DialogTitle>
          <DialogDescription className="text-white/48">
            Set the lead, members, and guardrails before this team can run work.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[72vh] grid-cols-1 overflow-hidden md:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-5 overflow-y-auto px-5 py-4">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setMode('scratch')
                  resetScratch()
                }}
                className={createModeClass(mode === 'scratch')}
              >
                <Plus className="h-4 w-4" />
                <span>From scratch</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('template')
                  applyTemplate(STARTER_TEAMS.find((team) => team.slug === templateSlug) ?? STARTER_TEAMS[0])
                }}
                className={createModeClass(mode === 'template')}
              >
                <Copy className="h-4 w-4" />
                <span>Use template</span>
              </button>
            </div>

            {mode === 'template' ? (
              <Field label="Template">
                <Select
                  value={templateSlug}
                  onValueChange={(value) => {
                    setTemplateSlug(value)
                    const template = STARTER_TEAMS.find((team) => team.slug === value)
                    applyTemplate(template)
                  }}
                >
                  <SelectTrigger className="border-white/[0.12] bg-white/[0.035] text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STARTER_TEAMS.map((team) => (
                      <SelectItem key={team.slug} value={team.slug}>{team.metadata.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : null}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[72px_minmax(0,1fr)]">
              <Field label="Icon">
                <Input
                  value={avatar}
                  onChange={(event) => setAvatar(event.target.value.slice(0, 4))}
                  placeholder="Icon"
                  className="border-white/[0.12] bg-white/[0.035] text-center text-white"
                />
              </Field>
              <Field label="Team name">
                <Input
                  value={name}
                  onChange={(event) => {
                    const next = event.target.value
                    setName(next)
                    if (!slugTouched) setSlug(toSlug(next))
                  }}
                  placeholder="Engineering Ship Team"
                  className="border-white/[0.12] bg-white/[0.035] text-white"
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Slug">
                <Input
                  value={slug}
                  onChange={(event) => {
                    setSlugTouched(true)
                    setSlug(event.target.value)
                  }}
                  onBlur={() => setSlug(normalizedSlug)}
                  placeholder="engineering-ship-team"
                  className="border-white/[0.12] bg-white/[0.035] font-mono text-white"
                />
                {existingSlugs.has(normalizedSlug) ? (
                  <p className="mt-1 text-[11px] text-amber-200/78">That slug already exists.</p>
                ) : slug && !TEAM_AGENT_SLUG_REGEX.test(normalizedSlug) ? (
                  <p className="mt-1 text-[11px] text-amber-200/78">Use lowercase letters, numbers, and hyphens.</p>
                ) : null}
              </Field>
              <Field label="Lead agent">
                <Input
                  value={lead}
                  onChange={(event) => setLead(event.target.value)}
                  placeholder="system-architect"
                  className="border-white/[0.12] bg-white/[0.035] font-mono text-white"
                />
                {invalidLead ? (
                  <p className="mt-1 text-[11px] text-amber-200/78">Use a valid agent slug.</p>
                ) : leadIsMember ? (
                  <p className="mt-1 text-[11px] text-amber-200/78">Lead cannot also be a member.</p>
                ) : null}
              </Field>
            </div>

            <Field label="Description">
              <Textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What this team owns"
                className="min-h-[74px] border-white/[0.12] bg-white/[0.035] text-white"
              />
            </Field>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Permission">
                <Select value={permissionMode ?? 'ask'} onValueChange={(value) => setPermissionMode(value as TeamMetadataDTO['permissionMode'])}>
                  <SelectTrigger className="border-white/[0.12] bg-white/[0.035] text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ask">Ask first</SelectItem>
                    <SelectItem value="safe">Safe</SelectItem>
                    <SelectItem value="allow-all">Full access</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <div className="flex items-end">
                <label className="flex h-9 w-full items-center justify-between rounded-md border border-white/[0.12] bg-white/[0.035] px-3 text-sm text-white/72">
                  <span>Standing team</span>
                  <Switch checked={standing} onCheckedChange={setStanding} />
                </label>
              </div>
            </div>

            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-white/36">Members</h3>
                <div className="flex gap-1.5">
                  <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-white/62 hover:text-white" onClick={() => addMember({ slug: 'reviewer', role: 'Verification and review' })}>
                    <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                    Reviewer
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-white/62 hover:text-white" onClick={() => addMember()}>
                    <UserPlus className="mr-1 h-3.5 w-3.5" />
                    Add
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                {members.map((member) => (
                  <div key={member.id} className="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)_32px] gap-2">
                    <Input
                      value={member.slug}
                      onChange={(event) => updateMember(member.id, { slug: event.target.value })}
                      placeholder="agent-slug"
                      className="border-white/[0.12] bg-white/[0.035] font-mono text-white"
                    />
                    <Input
                      value={member.role}
                      onChange={(event) => updateMember(member.id, { role: event.target.value })}
                      placeholder="Role in this team"
                      className="border-white/[0.12] bg-white/[0.035] text-white"
                    />
                    <Button type="button" size="sm" variant="ghost" className="h-9 px-2 text-white/42 hover:text-red-100" onClick={() => removeMember(member.id)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              {duplicateMember ? <p className="mt-1 text-[11px] text-amber-200/78">Member slugs must be unique.</p> : null}
              {incompleteMember ? <p className="mt-1 text-[11px] text-amber-200/78">Each member needs both a slug and a role.</p> : null}
              {invalidMember ? <p className="mt-1 text-[11px] text-amber-200/78">Member slugs must use lowercase letters, numbers, and hyphens.</p> : null}
            </section>

            <section>
              <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-white/36">Guardrails</h3>
              <div className="grid grid-cols-3 gap-2">
                {(['off', 'advisory', 'blocking'] as const).map((modeOption) => (
                  <button
                    key={modeOption}
                    type="button"
                    onClick={() => setVerificationDefault(modeOption)}
                    className={createModeClass(verificationDefault === modeOption)}
                  >
                    <ShieldCheck className="h-4 w-4" />
                    <span>{modeOption}</span>
                  </button>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {TEAM_RISK_ACTIONS.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => toggleRiskAction(action.id)}
                    className={[
                      'rounded-[7px] border px-2 py-1 text-[11px] transition-colors',
                      requiredFor.includes(action.id)
                        ? 'border-[#38bdf8]/30 bg-[#38bdf8]/12 text-sky-100/88'
                        : 'border-white/[0.08] bg-white/[0.035] text-white/48 hover:text-white/70',
                    ].join(' ')}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </section>
          </div>

          <aside className="border-t border-white/[0.08] bg-white/[0.025] p-4 md:border-l md:border-t-0">
            <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-white/36">Preview</h3>
            <div className="mt-3 rounded-[12px] border border-white/[0.08] bg-black/20 p-3">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-white/[0.08] bg-white/[0.055] text-lg">
                  {avatar || <Users className="h-4 w-4 text-white/58" />}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-white">{name.trim() || 'New team'}</div>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-white/42">@{normalizedSlug || 'new-team'}</div>
                </div>
              </div>
              <p className="mt-3 text-[12px] leading-[18px] text-white/58">{description.trim() || 'Coordinates a reusable team of agents.'}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <TeamPill>Lead: {lead.trim() || 'unset'}</TeamPill>
                <TeamPill>{validMembers.length} members</TeamPill>
                <TeamPill>{verificationDefault} review</TeamPill>
              </div>
              <div className="mt-3 space-y-2">
                {validMembers.slice(0, 5).map((member) => (
                  <div key={member.slug} className="rounded-[8px] border border-white/[0.07] bg-white/[0.035] px-2 py-1.5">
                    <div className="truncate font-mono text-[11px] text-white/78">@{member.slug}</div>
                    <div className="mt-0.5 line-clamp-2 text-[11px] leading-[15px] text-white/45">{member.role}</div>
                  </div>
                ))}
              </div>
              {requiredFor.length ? (
                <p className="mt-3 text-[11px] leading-[16px] text-white/42">
                  Requires review for {requiredFor.length} risky action{requiredFor.length === 1 ? '' : 's'}.
                </p>
              ) : null}
            </div>
          </aside>
        </div>

        <DialogFooter className="border-t border-white/[0.08] px-5 py-4">
          <Button type="button" variant="ghost" className="text-white/62 hover:text-white" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" className="bg-[#38bdf8]/18 text-white hover:bg-[#38bdf8]/26" disabled={!canSubmit || submitting} onClick={() => void handleSubmit()}>
            Create team
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-white/36">{label}</Label>
      {children}
    </div>
  )
}

function createModeClass(active: boolean): string {
  return [
    'flex h-9 items-center justify-center gap-2 rounded-[9px] border px-3 text-sm transition-colors',
    active
      ? 'border-[#38bdf8]/32 bg-[#38bdf8]/12 text-white'
      : 'border-white/[0.08] bg-white/[0.035] text-white/54 hover:text-white/78',
  ].join(' ')
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
  ticks,
  onSelectRun,
  onStart,
  onEdit,
  onDuplicate,
  onArchive,
  onOpenLead,
  onControlRun,
  onTickRun,
  onWakeAgent,
  onCompleteRun,
  onDecideApproval,
}: {
  team: TeamDTO
  runs: TeamRunSnapshot[]
  selectedRun?: TeamRunSnapshot | null
  selectedDetail?: TeamRunDetail
  ticks: TeamRunTick[]
  onSelectRun: (runId: string) => void
  onStart: () => void
  onEdit: () => void
  onDuplicate: () => void
  onArchive: () => void
  onOpenLead: (sessionId: string) => void
  onControlRun: (run: TeamRunSnapshot, action: 'pause' | 'resume' | 'cancel') => void
  onTickRun: (run: TeamRunSnapshot) => void
  onWakeAgent: (run: TeamRunSnapshot, agentSlug: string, taskId?: string) => void
  onCompleteRun: (run: TeamRunSnapshot) => void
  onDecideApproval?: (task: TeamRunDetail['tasks'][number], decision: 'approved' | 'rejected') => void
}) {
  const verification = team.metadata.verification
  const approvalTasks = selectedDetail?.tasks.filter((task) => task.approval?.status === 'requested') ?? []
  const runIsTerminal = selectedRun ? ['done', 'failed', 'cancelled'].includes(selectedRun.state) : false
  const allTasksDone = Boolean(selectedDetail?.tasks.length) && selectedDetail!.tasks.every((task) => task.status === 'done')

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

        {selectedRun ? (
          <DetailBlock title="Operator controls">
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="ghost" className="h-8 justify-center px-2 text-white/70 hover:text-white" disabled={runIsTerminal} onClick={() => onTickRun(selectedRun)}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Tick
              </Button>
              <Button size="sm" variant="ghost" className="h-8 justify-center px-2 text-white/70 hover:text-white" disabled={runIsTerminal} onClick={() => onWakeAgent(selectedRun, team.metadata.lead)}>
                <Bell className="mr-1.5 h-3.5 w-3.5" />
                Lead
              </Button>
              {selectedRun.state === 'paused' ? (
                <Button size="sm" variant="ghost" className="h-8 justify-center px-2 text-white/70 hover:text-white" onClick={() => onControlRun(selectedRun, 'resume')}>
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                  Resume
                </Button>
              ) : (
                <Button size="sm" variant="ghost" className="h-8 justify-center px-2 text-white/70 hover:text-white" disabled={runIsTerminal} onClick={() => onControlRun(selectedRun, 'pause')}>
                  <Pause className="mr-1.5 h-3.5 w-3.5" />
                  Pause
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-8 justify-center px-2 text-red-200/70 hover:text-red-100" disabled={runIsTerminal} onClick={() => onControlRun(selectedRun, 'cancel')}>
                <Square className="mr-1.5 h-3.5 w-3.5" />
                Cancel
              </Button>
              <Button size="sm" variant="ghost" className="h-8 justify-center px-2 text-emerald-100/72 hover:text-emerald-50" disabled={!allTasksDone || runIsTerminal} onClick={() => onCompleteRun(selectedRun)}>
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                Complete
              </Button>
            </div>
            {selectedRun.swarm?.operatorPausedReason ? (
              <p className="mt-2 text-[11px] leading-[16px] text-white/45">{selectedRun.swarm.operatorPausedReason}</p>
            ) : null}
            {selectedRun.finalSummary ? (
              <p className="mt-2 text-[11px] leading-[16px] text-emerald-100/70">{selectedRun.finalSummary}</p>
            ) : null}
          </DetailBlock>
        ) : null}

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
                    {selectedRun && !runIsTerminal && task.ownerAgentSlug !== team.metadata.lead ? (
                      <div className="mt-2 flex justify-end">
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-white/50 hover:text-white" onClick={() => onWakeAgent(selectedRun, task.ownerAgentSlug, task.id)}>
                          <Bell className="mr-1 h-3.5 w-3.5" />
                          Wake
                        </Button>
                      </div>
                    ) : null}
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

        <DetailBlock title="Run loop">
          {ticks.length ? (
            <div className="space-y-2">
              {ticks.slice(-5).reverse().map((item) => (
                <div key={item.id} className="rounded-[10px] border border-white/[0.07] bg-black/10 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-white/70">{item.reason}</span>
                    <span className="text-[10px] text-white/36">{new Date(item.completedAt).toLocaleTimeString()}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {item.actions.map((action, index) => (
                      <TeamPill key={`${item.id}:${index}`}>{action.type}{action.agentSlug ? ` @${action.agentSlug}` : ''}</TeamPill>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-white/45">No loop ticks yet.</p>
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
                  ) : selectedRun && !runIsTerminal ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 shrink-0 px-2 text-white/52 hover:text-white"
                      onClick={() => onWakeAgent(selectedRun, member.slug)}
                    >
                      <Bell className="h-3.5 w-3.5" />
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
