import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { resolveAutomationsConfigPath } from '@craft-agent/shared/automations/resolve-config-path'
import {
  ARTIST_CALENDAR_CONTEXT_SLUG,
  artistCalendarMetadata,
  serializeArtistCalendarBody,
} from '@craft-agent/shared/artist-context'
import {
  CAMPAIGN_CALENDAR_CONTEXT_SLUG,
  campaignCalendarMetadata,
  createCampaignCalendarItem,
  parseCampaignCalendarDocResult,
  serializeCampaignCalendarBody,
} from '@craft-agent/shared/campaign-calendar'
import {
  SCHEDULED_WORK_CONTEXT_SLUG,
  parseScheduledWorkDocResult,
  scheduledWorkDefinitionDigest,
  scheduledWorkMetadata,
  serializeScheduledWorkBody,
  type ScheduledWorkOrder,
} from '@craft-agent/shared/scheduled-work'
import { loadContextDoc, upsertContextDoc } from '@craft-agent/shared/workspace-context'
import * as actualWorkflows from '@craft-agent/shared/workflows'
import type { LoadedWorkflow } from '@craft-agent/shared/workflows'
import { supplyScheduledWorkInputs } from './ScheduledWorkInputSupply'

const workflow: LoadedWorkflow = {
  slug: 'process-file',
  path: '/tmp/process-file/WORKFLOW.md',
  source: 'global' as const,
  body: 'Process the supplied file.',
  metadata: {
    name: 'Process File',
    description: 'Processes a file.',
    trigger: {
      type: 'manual' as const,
      inputs: [
        { name: 'file', type: 'string' as const, required: true },
        { name: 'count', type: 'number' as const, required: true, min: 1 },
      ],
    },
    steps: [{ id: 'process', agent: 'youtube-intel', input: 'Process {{trigger.file}}' }],
  },
}

const stringWorkflow: LoadedWorkflow = {
  ...workflow,
  slug: 'process-string-file',
  path: '/tmp/process-string-file/WORKFLOW.md',
  metadata: {
    ...workflow.metadata,
    name: 'Process String File',
    trigger: {
      type: 'manual',
      inputs: [{ name: 'file', type: 'string', required: true }],
    },
  },
}

const typedWorkflow: LoadedWorkflow = {
  ...workflow,
  slug: 'process-typed-file',
  path: '/tmp/process-typed-file/WORKFLOW.md',
  metadata: {
    ...workflow.metadata,
    name: 'Process Typed File',
    trigger: {
      type: 'manual',
      inputs: [
        { name: 'file', type: 'string', required: true },
        { name: 'count', type: 'number', required: true, min: 1 },
        { name: 'publish', type: 'boolean', required: true },
      ],
    },
  },
}

const workflows = new Map([workflow, stringWorkflow, typedWorkflow].map((candidate) => [candidate.slug, candidate]))

// Captured before mock.module re-points the live `actualWorkflows` namespace
// at the mock; calling through it from a fallback recurses forever.
// See google-workspace.test.ts for the full story.
const realLoadGlobalWorkflow = actualWorkflows.loadGlobalWorkflow
const realReadActivatedWorkflows = actualWorkflows.readActivatedWorkflows

mock.module('@craft-agent/shared/workflows', () => ({
  ...actualWorkflows,
  loadGlobalWorkflow: (slug: string) => workflows.get(slug) ?? realLoadGlobalWorkflow(slug),
  readActivatedWorkflows: (rootPath: string) => rootPath.includes('scheduled-input-supply-')
    ? { version: 1, active: [...workflows.keys()] }
    : realReadActivatedWorkflows(rootPath),
}))

const roots: string[] = []
const workspaceId = 'campaign-1'
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

function makeRoot(): string {
  const value = mkdtempSync(join(tmpdir(), 'scheduled-input-supply-'))
  roots.push(value)
  writeAutomationConfig(value)
  return value
}

function automationAction(selectedWorkflow: LoadedWorkflow = workflow) {
  return {
    type: 'queue-work' as const,
    ownerScope: 'campaign' as const,
    calendarVisibility: 'hidden' as const,
    title: 'Process file',
    execution: {
      type: 'workflow-run' as const,
      workflowSlug: selectedWorkflow.slug,
      workflowDigest: scheduledWorkDefinitionDigest({ metadata: selectedWorkflow.metadata, body: selectedWorkflow.body }),
      triggerInputs: {},
    },
    inputBindings: Object.fromEntries(
      (selectedWorkflow.metadata.trigger.inputs ?? []).map((input) => [input.name, { mode: 'ask' as const }]),
    ),
  }
}

function writeAutomationConfig(root: string, action = automationAction()): void {
  const path = resolveAutomationsConfigPath(root)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({
    version: 2,
    automations: {
      SchedulerTick: [{
        id: 'process-file-trigger',
        name: 'Process files',
        cron: '0 9 * * 1',
        actions: [action],
      }],
    },
  }, null, 2)}\n`)
}

function waitingOrder(
  scope: 'campaign' | 'hq' = 'campaign',
  hidden = true,
  selectedWorkflow: LoadedWorkflow = workflow,
): ScheduledWorkOrder {
  const requestedAt = '2026-09-02T14:00:00.000Z'
  const requestedInputs = (selectedWorkflow.metadata.trigger.inputs ?? []).map((input) => input.name)
  const action = automationAction(selectedWorkflow)
  return {
    version: 1,
    id: 'waiting-work',
    owner: scope === 'campaign'
      ? { scope, workspaceId, campaignId: workspaceId }
      : { scope, workspaceId },
    calendarLink: { calendar: scope, itemId: 'waiting-work-calendar' },
    calendarVisibility: hidden ? 'hidden' : 'visible',
    title: 'Process file',
    type: 'workflow-run',
    status: 'needs-setup',
    startAt: requestedAt,
    timezone: 'America/Chicago',
    execution: action.execution,
    inputRefs: [], approvals: [], runs: [],
    attention: { reason: 'input-required', message: `Waiting for: ${requestedInputs.join(', ')}` },
    inputRequest: {
      id: 'waiting-work:input',
      inputs: requestedInputs,
      requestedAt,
      lastTriggeredAt: requestedAt,
      coalescedFireCount: 1,
      fireDefinitionDigests: ['fire-1'],
    },
    automationRef: {
      matcherId: 'process-file-trigger', name: 'Process files', event: 'SchedulerTick',
      definitionDigest: 'fire-1',
      configurationDigest: scheduledWorkDefinitionDigest({
        matcherId: 'process-file-trigger',
        actionIndex: 0,
        event: 'SchedulerTick',
        action,
      }),
    },
    executionKey: { payloadDigest: 'before', idempotencyKey: 'waiting-work:0' },
    createdAt: requestedAt,
    updatedAt: requestedAt,
  }
}

function writeOrder(root: string, order: ScheduledWorkOrder): void {
  upsertContextDoc(root, {
    slug: SCHEDULED_WORK_CONTEXT_SLUG,
    metadata: scheduledWorkMetadata(),
    body: serializeScheduledWorkBody({ version: 1, workspaceId, items: [order], updatedAt: order.updatedAt }),
  })
}

function supply(
  root: string,
  overrides: Partial<Parameters<typeof supplyScheduledWorkInputs>[2]> = {},
  now = '2026-09-02T15:30:00.000Z',
) {
  return supplyScheduledWorkInputs(workspaceId, root, {
    orderId: 'waiting-work', requestId: 'waiting-work:input', source: 'list',
    values: { file: '/vault/art.png', count: 2 },
    sourceEvidenceText: 'Use /vault/art.png and 2 results.',
    sourceAttachments: [],
    ...overrides,
  }, { now: () => new Date(now) })
}

describe('supplyScheduledWorkInputs', () => {
  test('validates all requested values, schedules the work, and makes retries harmless', async () => {
    const root = makeRoot()
    writeOrder(root, waitingOrder())

    await expect(supply(root, { values: { file: '/vault/art.png' } })).rejects.toThrow('Supply every requested')
    await expect(supply(root, { values: { file: '/vault/art.png', count: 'two' } })).rejects.toThrow('must be a number')
    await expect(supply(root, { requestId: 'old-request' })).rejects.toThrow('no longer matches')

    const first = await supply(root)
    expect(first.updated).toBe(true)
    expect(first.order).toMatchObject({
      status: 'scheduled',
      startAt: '2026-09-02T15:30:00.000Z',
      attention: undefined,
      inputRequest: undefined,
      execution: { triggerInputs: { file: '/vault/art.png', count: 2 } },
      inputSupplyReceipt: {
        requestId: 'waiting-work:input', source: 'list', suppliedKeys: ['count', 'file'],
        fireDefinitionDigests: ['fire-1'],
      },
    })
    expect(first.order.executionKey.payloadDigest).not.toBe('before')

    const retry = await supply(root, { expectedUpdatedAt: '2026-09-02T14:00:00.000Z' })
    expect(retry.updated).toBe(false)
    expect(retry.order).toEqual(first.order)
  })

  test('rejects an open input request after its automation changes or disappears', async () => {
    const root = makeRoot()
    writeOrder(root, waitingOrder())
    writeAutomationConfig(root, { ...automationAction(), title: 'Changed process' })

    await expect(supply(root)).rejects.toThrow('changed after requesting inputs')
    writeFileSync(resolveAutomationsConfigPath(root), `${JSON.stringify({ version: 2, automations: {} }, null, 2)}\n`)
    await expect(supply(root)).rejects.toThrow('disabled or no longer exists')
    const parsed = parseScheduledWorkDocResult(
      loadContextDoc(root, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined,
      workspaceId,
    )
    if (!parsed.ok) throw new Error(parsed.error)
    expect(parsed.work.items[0]?.status).toBe('needs-setup')
  })

  test('updates a campaign calendar draft to the supplied start time', async () => {
    const root = makeRoot()
    const order = waitingOrder('campaign', false)
    writeOrder(root, order)
    const item = createCampaignCalendarItem({
      id: order.calendarLink.itemId, campaignId: workspaceId, date: '2026-09-02', time: '09:00',
      timezone: order.timezone, title: order.title, kind: 'scheduled-job', status: 'draft', source: 'workflow',
      scheduledWorkId: order.id,
    })
    upsertContextDoc(root, {
      slug: CAMPAIGN_CALENDAR_CONTEXT_SLUG,
      metadata: campaignCalendarMetadata(),
      body: serializeCampaignCalendarBody({ version: 1, campaignId: workspaceId, items: [item], updatedAt: order.updatedAt }),
    })

    await supply(root)
    const parsed = parseCampaignCalendarDocResult(loadContextDoc(root, CAMPAIGN_CALENDAR_CONTEXT_SLUG) ?? undefined, workspaceId)
    if (!parsed.ok) throw new Error(parsed.error)
    expect(parsed.calendar.items[0]).toMatchObject({ status: 'scheduled', date: '2026-09-02', time: '10:30' })

    const staleItem = { ...parsed.calendar.items[0]!, status: 'draft' as const, time: '09:00' }
    upsertContextDoc(root, {
      slug: CAMPAIGN_CALENDAR_CONTEXT_SLUG,
      metadata: campaignCalendarMetadata(),
      body: serializeCampaignCalendarBody({ ...parsed.calendar, items: [staleItem] }),
    })
    const retry = await supply(
      root,
      { expectedUpdatedAt: '2026-09-02T14:00:00.000Z' },
      '2026-09-02T16:00:00.000Z',
    )
    expect(retry.updated).toBe(false)
    const afterRetry = parseCampaignCalendarDocResult(loadContextDoc(root, CAMPAIGN_CALENDAR_CONTEXT_SLUG) ?? undefined, workspaceId)
    if (!afterRetry.ok) throw new Error(afterRetry.error)
    expect(afterRetry.calendar.items[0]).toEqual(staleItem)
  })

  test('does not admit work when its calendar projection cannot be updated', async () => {
    const root = makeRoot()
    const order = waitingOrder('campaign', false)
    writeOrder(root, order)
    upsertContextDoc(root, {
      slug: CAMPAIGN_CALENDAR_CONTEXT_SLUG,
      metadata: campaignCalendarMetadata(),
      body: 'invalid calendar',
    })

    await expect(supply(root)).rejects.toThrow(/calendar/i)
    const parsed = parseScheduledWorkDocResult(loadContextDoc(root, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined, workspaceId)
    if (!parsed.ok) throw new Error(parsed.error)
    expect(parsed.work.items[0]?.status).toBe('needs-setup')
    expect(parsed.work.items[0]?.inputSupplyReceipt).toBeUndefined()
  })

  test('rejects malformed runtime input before writing', async () => {
    const root = makeRoot()
    writeOrder(root, waitingOrder())
    await expect(supplyScheduledWorkInputs(workspaceId, root, {
      orderId: 'waiting-work', requestId: 'waiting-work:input', source: 'forged', values: null,
    } as never)).rejects.toThrow('Invalid scheduled-work input supply request')
    const parsed = parseScheduledWorkDocResult(loadContextDoc(root, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined, workspaceId)
    if (!parsed.ok) throw new Error(parsed.error)
    expect(parsed.work.items[0]?.status).toBe('needs-setup')
  })

  test('requires and records a post-request Artist Manager message for tool supplies', async () => {
    const root = makeRoot()
    writeAutomationConfig(root, automationAction(stringWorkflow))
    writeOrder(root, waitingOrder('campaign', true, stringWorkflow))
    const logs: unknown[][] = []

    await expect(supply(root, { source: 'tool' })).rejects.toThrow('Invalid scheduled-work input supply request')
    await expect(supply(root, {
      source: 'tool',
      sourceSessionId: 'manager-session',
      sourceMessageId: 'artist-answer',
      sourceMessageAt: '2026-09-02T13:59:00.000Z',
    })).rejects.toThrow(/new artist answer/)

    const result = await supplyScheduledWorkInputs(workspaceId, root, {
      orderId: 'waiting-work', requestId: 'waiting-work:input', values: { file: '/vault/art.png' },
      source: 'tool', sourceSessionId: 'manager-session', sourceMessageId: 'artist-answer',
      sourceMessageAt: '2026-09-02T14:01:00.000Z',
      sourceEvidenceText: 'Use /vault/art.png and 2 results.',
      sourceAttachments: [],
    }, { now: () => new Date('2026-09-02T15:30:00.000Z'), log: { info: (...args) => logs.push(args) } })
    expect(result.order.inputSupplyReceipt).toMatchObject({
      source: 'tool',
      sourceSessionId: 'manager-session',
      sourceMessageId: 'artist-answer',
      sourceMessageAt: '2026-09-02T14:01:00.000Z',
    })
    expect(logs).toMatchObject([[
      '[ScheduledWork] workflow inputs supplied',
      { orderId: 'waiting-work', source: 'tool', suppliedKeys: ['file'], sourceSessionId: 'manager-session', sourceMessageId: 'artist-answer' },
    ]])
  })

  test('refuses numeric and boolean tool inputs while list form supply remains allowed', async () => {
    const root = makeRoot()
    writeAutomationConfig(root, automationAction(typedWorkflow))
    writeOrder(root, waitingOrder('campaign', true, typedWorkflow))
    const values = { file: '/vault/art.png', count: 2, publish: true }

    await expect(supply(root, {
      source: 'tool',
      sourceSessionId: 'manager-session',
      sourceMessageId: 'artist-answer',
      sourceMessageAt: '2026-09-02T14:01:00.000Z',
      sourceEvidenceText: 'Use /vault/art.png, count 2, and publish it.',
      values,
    })).rejects.toThrow(/count, publish.*Needs you form/)

    const waiting = parseScheduledWorkDocResult(
      loadContextDoc(root, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined,
      workspaceId,
    )
    if (!waiting.ok) throw new Error(waiting.error)
    expect(waiting.work.items[0]?.status).toBe('needs-setup')

    const result = await supply(root, { source: 'list', values })
    expect(result.order).toMatchObject({
      status: 'scheduled',
      execution: { triggerInputs: values },
      inputSupplyReceipt: { source: 'list', suppliedKeys: ['count', 'file', 'publish'] },
    })
  })

  test('rejects schema-valid tool values that the artist did not provide or approve', async () => {
    const root = makeRoot()
    writeAutomationConfig(root, automationAction(stringWorkflow))
    writeOrder(root, waitingOrder('campaign', true, stringWorkflow))

    await expect(supply(root, {
      source: 'tool',
      sourceSessionId: 'manager-session',
      sourceMessageId: 'artist-answer',
      sourceMessageAt: '2026-09-02T14:01:00.000Z',
      sourceEvidenceText: 'yes',
      values: { file: '/tmp/unmentioned.wav' },
    })).rejects.toThrow(/did not explicitly provide or approve values for: file/)

    const parsed = parseScheduledWorkDocResult(loadContextDoc(root, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined, workspaceId)
    if (!parsed.ok) throw new Error(parsed.error)
    expect(parsed.work.items[0]?.status).toBe('needs-setup')
    expect(parsed.work.items[0]?.inputSupplyReceipt).toBeUndefined()
  })

  test('enforces a request already linked to a specific session and message', async () => {
    const root = makeRoot()
    const order = waitingOrder()
    order.inputRequest = {
      ...order.inputRequest!,
      sessionId: 'expected-session',
      messageId: 'expected-message',
    }
    writeOrder(root, order)

    await expect(supply(root, {
      source: 'tool',
      sourceSessionId: 'wrong-session',
      sourceMessageId: 'expected-message',
      sourceMessageAt: '2026-09-02T14:01:00.000Z',
    })).rejects.toThrow(/different Artist Manager session/)
    await expect(supply(root, {
      source: 'tool',
      sourceSessionId: 'expected-session',
      sourceMessageId: 'wrong-message',
      sourceMessageAt: '2026-09-02T14:01:00.000Z',
    })).rejects.toThrow(/different artist message/)
  })

  test('does not allow one artist message to supply multiple work requests', async () => {
    const root = makeRoot()
    const first = waitingOrder()
    first.id = 'already-supplied'
    first.status = 'scheduled'
    first.inputRequest = undefined
    first.attention = undefined
    first.inputSupplyReceipt = {
      requestId: 'already-supplied:input', source: 'tool', suppliedKeys: ['count', 'file'],
      fireDefinitionDigests: ['fire-0'], suppliedAt: '2026-09-02T14:01:00.000Z',
      sourceSessionId: 'manager-session', sourceMessageId: 'artist-answer', sourceMessageAt: '2026-09-02T14:01:00.000Z',
    }
    const waiting = waitingOrder()
    upsertContextDoc(root, {
      slug: SCHEDULED_WORK_CONTEXT_SLUG,
      metadata: scheduledWorkMetadata(),
      body: serializeScheduledWorkBody({ version: 1, workspaceId, items: [first, waiting], updatedAt: waiting.updatedAt }),
    })

    await expect(supply(root, {
      source: 'tool', sourceSessionId: 'manager-session', sourceMessageId: 'artist-answer',
      sourceMessageAt: '2026-09-02T14:02:00.000Z',
    })).rejects.toThrow(/already supplied a different work request/)
  })

  test('updates the linked Artist Calendar event for HQ work', async () => {
    const root = makeRoot()
    const order = waitingOrder('hq', false)
    writeOrder(root, order)
    upsertContextDoc(root, {
      slug: ARTIST_CALENDAR_CONTEXT_SLUG,
      metadata: artistCalendarMetadata(),
      body: serializeArtistCalendarBody({
        version: 1,
        events: [{
          id: order.calendarLink.itemId, date: '2026-09-02', time: '09:00', title: order.title,
          scheduledWorkId: order.id, workspaceLinks: [], relatedPersonIds: [],
          createdAt: order.createdAt, updatedAt: order.updatedAt,
        }],
        updatedAt: order.updatedAt,
      }),
    })

    await supply(root)
    const parsed = parseScheduledWorkDocResult(loadContextDoc(root, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined, workspaceId)
    if (!parsed.ok) throw new Error(parsed.error)
    expect(parsed.work.items[0]?.status).toBe('scheduled')
    expect(loadContextDoc(root, ARTIST_CALENDAR_CONTEXT_SLUG)?.body).toContain('"time": "10:30"')
  })
})
