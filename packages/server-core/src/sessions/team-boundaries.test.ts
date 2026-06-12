import { describe, expect, it, mock } from 'bun:test'
import type { TeamRunDetail, TeamTask } from '@craft-agent/shared/teams'
import { SessionManager } from './SessionManager.ts'

type TeamBoundaryHarness = {
  resolveTeamActor(managed: { id: string; spawnedFromAgent?: { agentSlug: string } }, run: TeamRunDetail): string
  assertDifferentReviewer(taskLabel: string, ownerAgentSlug: string, reviewerAgentSlug: string): void
  assertCanSpawnTeamMember(run: TeamRunDetail, actor: string, agentSlug: string, task?: TeamTask): void
  assertCanRequestTaskGate(run: TeamRunDetail, actor: string, task: TeamTask, gate: 'review' | 'approval'): void
  assertCanUpdateTeamTask(run: TeamRunDetail, actor: string, task: TeamTask, leaseId?: string): void
  assertTeamRunMutable(run: TeamRunDetail): void
  shouldNotifyTeamLeadOfTaskUpdate(run: TeamRunDetail, actor: string, task: TeamTask): boolean
  buildTeamLeadTaskUpdatePrompt(run: TeamRunDetail, actor: string, task: TeamTask): string
  buildTeamLeadMessagePrompt(run: TeamRunDetail, actor: string, message: string, task?: TeamTask): string
  notifyTeamLeadBestEffort(label: string, notify: () => Promise<void>): Promise<void>
}

const task: TeamTask = {
  id: 'task_123',
  runId: 'run_123',
  title: 'Implement risky change',
  description: 'Do the work',
  ownerAgentSlug: 'coder',
  status: 'todo',
  priority: 'normal',
  inputs: {},
  reviewRequired: true,
  reviewerAgentSlug: 'reviewer',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const run: TeamRunDetail = {
  id: 'run_123',
  workspaceId: 'workspace-1',
  teamSlug: 'engineering-ship-team',
  state: 'running',
  userRequest: 'Ship the feature',
  leadSessionId: 'lead-session',
  teamSnapshot: {
    metadata: {
      name: 'Engineering Ship Team',
      description: 'Ships features',
      lead: 'system-architect',
      members: [
        { slug: 'coder', role: 'Implementation' },
        { slug: 'reviewer', role: 'Review' },
      ],
    },
    body: '# Team',
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  tasks: [task],
  messages: [],
  events: [],
}

function harness(): TeamBoundaryHarness {
  return new SessionManager() as unknown as TeamBoundaryHarness
}

describe('team session boundaries', () => {
  it('rejects reviewer self-assignment', () => {
    expect(() => harness().assertDifferentReviewer(task.id, 'coder', 'coder')).toThrow('must be reviewed by another team member')
    expect(() => harness().assertDifferentReviewer(task.id, 'coder', 'reviewer')).not.toThrow()
  })

  it('prevents non-leads from waking other team members directly', () => {
    const sm = harness()

    expect(() => sm.assertCanSpawnTeamMember(run, 'system-architect', 'reviewer')).not.toThrow()
    expect(() => sm.assertCanSpawnTeamMember(run, 'coder', 'coder', task)).not.toThrow()
    expect(() => sm.assertCanSpawnTeamMember(run, 'coder', 'reviewer', task)).toThrow('Only the team lead can wake other team members')
    expect(() => sm.assertCanSpawnTeamMember(run, 'reviewer', 'coder', task)).toThrow('Only the team lead can wake other team members')
  })

  it('resolves team actors only from linked run sessions', () => {
    const sm = harness()
    const linkedRun = {
      ...run,
      leadSessionId: 'lead-session',
      memberSessionIds: {
        coder: 'coder-session',
      },
    }

    expect(sm.resolveTeamActor({ id: 'lead-session' }, linkedRun)).toBe('system-architect')
    expect(sm.resolveTeamActor({ id: 'coder-session', spawnedFromAgent: { agentSlug: 'coder' } }, linkedRun)).toBe('coder')
    expect(() => sm.resolveTeamActor({ id: 'random-session' }, linkedRun)).toThrow('is not linked to team run')
  })

  it('allows only the lead or task owner to request review and approval gates', () => {
    const sm = harness()

    expect(() => sm.assertCanRequestTaskGate(run, 'system-architect', task, 'review')).not.toThrow()
    expect(() => sm.assertCanRequestTaskGate(run, 'coder', task, 'approval')).not.toThrow()
    expect(() => sm.assertCanRequestTaskGate(run, 'reviewer', task, 'review')).toThrow('cannot request review')
    expect(() => sm.assertCanRequestTaskGate(run, 'reviewer', task, 'approval')).toThrow('cannot request approval')
  })

  it('requires task owners to hold an active lease before updating work', () => {
    const sm = harness()
    const leasedTask = {
      ...task,
      status: 'in_progress' as const,
      lease: {
        id: 'lease_valid',
        ownerAgentSlug: 'coder',
        claimedAt: '2026-01-01T00:00:00.000Z',
        heartbeatAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2999-01-01T00:00:00.000Z',
      },
    }

    expect(() => sm.assertCanUpdateTeamTask(run, 'coder', task)).toThrow('must claim task')
    expect(() => sm.assertCanUpdateTeamTask(run, 'coder', leasedTask, 'lease_wrong')).toThrow('does not hold the active lease')
    expect(() => sm.assertCanUpdateTeamTask(run, 'coder', leasedTask, 'lease_valid')).not.toThrow()
    expect(() => sm.assertCanUpdateTeamTask(run, 'system-architect', task)).not.toThrow()
    expect(() => sm.assertCanUpdateTeamTask(run, 'reviewer', task)).not.toThrow()
  })

  it('wakes the lead only for meaningful member handoff states', () => {
    const sm = harness()
    const linkedRun = { ...run, leadSessionId: 'lead-session' }
    const doneTask = { ...task, status: 'done' as const, output: 'Implemented and verified.' }
    const blockedTask = { ...task, status: 'blocked' as const, blockedReason: 'Needs product input.' }
    const progressTask = { ...task, status: 'in_progress' as const }

    expect(sm.shouldNotifyTeamLeadOfTaskUpdate(linkedRun, 'coder', doneTask)).toBe(true)
    expect(sm.shouldNotifyTeamLeadOfTaskUpdate(linkedRun, 'coder', blockedTask)).toBe(true)
    expect(sm.shouldNotifyTeamLeadOfTaskUpdate(linkedRun, 'coder', progressTask)).toBe(false)
    expect(sm.shouldNotifyTeamLeadOfTaskUpdate(linkedRun, 'system-architect', doneTask)).toBe(false)
    expect(sm.shouldNotifyTeamLeadOfTaskUpdate({ ...linkedRun, leadSessionId: undefined }, 'coder', doneTask)).toBe(false)

    const prompt = sm.buildTeamLeadTaskUpdatePrompt(linkedRun, 'coder', doneTask)
    expect(prompt).toContain('Team task update from @coder')
    expect(prompt).toContain(doneTask.id)
    expect(prompt).toContain('Implemented and verified.')
  })

  it('builds compact lead prompts for direct member messages', () => {
    const prompt = harness().buildTeamLeadMessagePrompt(run, 'coder', 'I need a decision on the API shape.', task)

    expect(prompt).toContain('Team message from @coder')
    expect(prompt).toContain('Team run id: run_123')
    expect(prompt).toContain(task.id)
    expect(prompt).toContain('I need a decision on the API shape.')
  })

  it('keeps lead notifications best-effort', async () => {
    const notify = mock(async () => {
      throw new Error('lead session unavailable')
    })

    await expect(harness().notifyTeamLeadBestEffort('test notification', notify)).resolves.toBeUndefined()
    expect(notify).toHaveBeenCalled()
  })

  it('blocks mutating team tools while a run is paused or terminal', () => {
    const sm = harness()

    expect(() => sm.assertTeamRunMutable(run)).not.toThrow()
    expect(() => sm.assertTeamRunMutable({ ...run, state: 'paused' })).toThrow('is paused')
    expect(() => sm.assertTeamRunMutable({ ...run, state: 'cancelled' })).toThrow('is cancelled')
    expect(() => sm.assertTeamRunMutable({ ...run, state: 'failed' })).toThrow('is failed')
    expect(() => sm.assertTeamRunMutable({ ...run, state: 'done' })).toThrow('is done')
  })
})
