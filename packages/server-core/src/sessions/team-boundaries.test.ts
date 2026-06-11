import { describe, expect, it } from 'bun:test'
import type { TeamRunDetail, TeamTask } from '@craft-agent/shared/teams'
import { SessionManager } from './SessionManager.ts'

type TeamBoundaryHarness = {
  resolveTeamActor(managed: { id: string; spawnedFromAgent?: { agentSlug: string } }, run: TeamRunDetail): string
  assertDifferentReviewer(taskLabel: string, ownerAgentSlug: string, reviewerAgentSlug: string): void
  assertCanSpawnTeamMember(run: TeamRunDetail, actor: string, agentSlug: string, task?: TeamTask): void
  assertCanRequestTaskGate(run: TeamRunDetail, actor: string, task: TeamTask, gate: 'review' | 'approval'): void
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
})
