import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  PAPER_ACTIVATION_EVENT_SCHEMA_VERSION,
  paperActivationEventSchema,
} from '@trade-god/contracts'
import { FilePaperActivationStore, sha256 } from '@trade-god/execution'

import { PaperActivationService } from '../paper-activation-service.ts'

const NOW = '2026-08-11T15:00:00.000Z'
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const connection = {
  connection_schema_version: 'trading-connection@1',
  connection_id: 'connection-paper-one',
  display_name: 'Paper One',
  firm: { slug: 'apex', name: 'Apex' },
  platform: { slug: 'tradovate', name: 'Tradovate' },
  environment: 'paper',
  environment_class: 'rehearsal',
  transport_preference: 'api',
  account_ref: '123',
  account_display: { label: 'PAPER-123' },
  credential_ref: 'credential-paper-one',
  risk_policy_ref: 'risk-paper',
  authorization_basis_ref: 'basis-paper',
  approval_policy_ref: 'approval-paper',
  state: 'ready',
  capabilities: {},
  certifications: ['paper-lifecycle-certified'],
  adapter_certifications: [{
    certification_id: 'cert-paper-one',
    adapter_id: 'fake-api',
    adapter_version: '1.0.0',
    provider_contract_version: 'fake-provider-at-1',
    transport: 'api',
    capabilities_checksum: '1'.repeat(64),
    levels: ['paper-lifecycle-certified'],
  }],
  enabled: true,
  created_at: NOW,
  updated_at: NOW,
}

const certification = {
  certification_id: 'cert-paper-one',
  content_checksum: '2'.repeat(64),
}

const providerProof = {
  verification_id: 'provider-proof-one',
  content_checksum: '3'.repeat(64),
  position_count: 0,
  working_order_count: 0,
}

const authorization = {
  authorization_id: 'authorization-paper-one',
  connection_id: connection.connection_id,
  scope: {
    symbols: ['ESU6'],
    max_contracts: 1,
    allowed_sides: ['buy', 'sell'],
    allowed_order_types: ['market', 'limit'],
    session_start: NOW,
    session_end: '2026-08-11T16:00:00.000Z',
    max_daily_loss: '500',
    max_open_risk: '100',
  },
  expires_at: '2026-08-11T16:00:00.000Z',
}

const makeRecord = (intentId = 'intent-paper-one') => ({
  record_schema_version: 'execution-record@1',
  intent: {
    intent_id: intentId,
    content_checksum: '4'.repeat(64),
    connection_id: connection.connection_id,
    source: { type: 'discord', source_id: `source-${intentId}` },
    instrument: { symbol: 'ESU6' },
    side: 'buy',
    quantity: 1,
    valid_until: '2026-08-11T15:05:00.000Z',
  },
  state: 'created',
  created_at: NOW,
  updated_at: NOW,
})

const setup = async (options: {
  enabled?: boolean
  pending?: boolean
  failCommit?: boolean
  now?: () => string
  beforeReleaseAssertion?: () => void
  eventFeedState?: 'subscribed' | 'reconnecting' | 'gap'
} = {}) => {
  const root = await mkdtemp(path.join(tmpdir(), 'paper-activation-service-'))
  roots.push(root)
  const journal = new FilePaperActivationStore(root, () => NOW)
  const records: any[] = options.pending === false ? [] : [makeRecord()]
  const control: any = {
    control_schema_version: 'execution-control@1',
    global_kill: true,
    connection_kills: [connection.connection_id],
    source_kills: [],
    updated_at: NOW,
  }
  const commits: any[] = []
  let haltWrites = 0
  const gateway = {
    list: async () => structuredClone(records),
    readControl: async () => structuredClone(control),
    connectionHaltEpoch: () => 0,
    captureFlatAccountSnapshot: async () => ({
      account_snapshot_schema_version: 'execution-account-snapshot@1',
      account_snapshot_id: 'release-snapshot-one',
      connection_id: connection.connection_id,
      account_ref: connection.account_ref,
      environment: 'paper',
      captured_at: NOW,
      can_trade: true,
      positions: [],
      working_orders: [],
    }),
    dismissPendingIntent: async (intentId: string, checksum: string) => {
      const record = records.find((candidate) => candidate.intent.intent_id === intentId)
      if (!record || sha256(record) !== checksum) throw new Error('review drift')
      record.state = 'canceled'
      record.updated_at = NOW
      return structuredClone(record)
    },
    commitPaperActivationRelease: async (input: any) => {
      const snapshots = [{
        account_snapshot_schema_version: 'execution-account-snapshot@1',
        account_snapshot_id: 'release-snapshot-final',
        connection_id: connection.connection_id,
        account_ref: connection.account_ref,
        environment: 'paper',
        captured_at: NOW,
        can_trade: true,
        positions: [],
        working_orders: [],
      }]
      await input.persist_release_evidence(snapshots)
      options.beforeReleaseAssertion?.()
      await input.assert_release_current()
      if (options.failCommit) throw new Error('simulated control write failure')
      commits.push(input)
      control.global_kill = false
      control.connection_kills = control.connection_kills.filter((id: string) => !input.connection_ids.includes(id))
      control.updated_at = NOW
      return snapshots
    },
    setGlobalKill: async (enabled: boolean) => {
      haltWrites += 1
      control.global_kill = enabled
    },
    activateEmergencyHalt: async () => { control.global_kill = true },
  }
  const service = new PaperActivationService({
    gateway: gateway as any,
    connections: {
      list: async () => options.enabled === false ? [] : [{
        connection,
        certification_evidence: [certification],
        provider_read_fresh: true,
        provider_read_verification: providerProof,
      }],
    } as any,
    authorizations: { getActive: async () => authorization as any },
    sources: {
      get: async (intentId: string) => ({
        intent_id: intentId,
        source_ticket_sha256: '5'.repeat(64),
        intent: records.find((record) => record.intent.intent_id === intentId)?.intent,
      }) as any,
    },
    journal,
    adapterSetChecksum: () => '6'.repeat(64),
    eventFeedHealth: () => ({
      connection_id: connection.connection_id,
      state: options.eventFeedState ?? 'subscribed',
      reconnect_attempt: 0,
      last_hint_at: NOW,
    }),
    now: options.now ?? (() => NOW),
  })
  return { service, journal, records, control, commits, haltWrites: () => haltWrites }
}

describe('paper activation service', () => {
  test('reviews exact flat truth and cancels every old ticket before releasing', async () => {
    const { service, journal, records, control, commits } = await setup()
    const review = await service.prepareReview()
    expect(review).toMatchObject({ ready: true })
    expect(review.pending_intents).toHaveLength(1)
    expect(review.connections).toHaveLength(1)

    const released = await service.commitReview(review.review_id, review.content_checksum)
    expect(released.status).toBe('released')
    expect(records[0].state).toBe('canceled')
    expect(control).toMatchObject({ global_kill: false, connection_kills: [] })
    expect(commits[0]).toMatchObject({
      release_id: expect.any(String),
      expected_control_checksum: review.control_checksum,
      connection_ids: [connection.connection_id],
    })
    expect((await journal.listEvents()).map((event) => event.status))
      .toEqual(['prepared', 'dismissed', 'released'])
  })

  test('refuses state drift without canceling or releasing anything', async () => {
    const { service, records, commits, control } = await setup()
    const review = await service.prepareReview()
    records.push(makeRecord('intent-paper-two'))

    await expect(service.commitReview(review.review_id, review.content_checksum))
      .rejects.toThrow('state changed')
    expect(records.map((record) => record.state)).toEqual(['created', 'created'])
    expect(commits).toEqual([])
    expect(control.global_kill).toBe(true)
  })

  test('returns concrete blockers and never offers release without an enabled account', async () => {
    const { service } = await setup({ enabled: false, pending: false })
    const review = await service.prepareReview()
    expect(review.ready).toBe(false)
    expect(review.blockers.map((blocker) => blocker.code)).toContain('no-enabled-paper-account')
    await expect(service.commitReview(review.review_id, review.content_checksum))
      .rejects.toThrow('blocked or expired')
  })

  test('keeps paper activation halted until the exact-account provider feed is subscribed', async () => {
    const { service } = await setup({ eventFeedState: 'reconnecting' })

    const review = await service.prepareReview()

    expect(review.ready).toBe(false)
    expect(review.blockers.map((blocker) => blocker.code)).toContain('provider-event-feed-required')
  })

  test('blocks any pending intent that lacks exact Discord source evidence', async () => {
    const { service, records } = await setup()
    records[0].intent.source = { type: 'manual', source_id: 'manual-source-one' }
    const review = await service.prepareReview()
    expect(review.ready).toBe(false)
    expect(review.blockers.map((blocker) => blocker.code)).toContain('non-discord-pending-intent')
    expect(review.pending_intents).toEqual([])
  })

  test('blocks release while any execution is active or uncertain even if the account snapshot is flat', async () => {
    const { service, records } = await setup()
    records[0].state = 'submit-unknown'
    const review = await service.prepareReview()
    expect(review.ready).toBe(false)
    expect(review.blockers.map((blocker) => blocker.code)).toContain('active-or-uncertain-execution')
  })

  test('re-latches startup halt for an incomplete durable release', async () => {
    const { service, journal, control, haltWrites } = await setup({ pending: false })
    const review = await service.prepareReview()
    const unsigned = {
      event_schema_version: PAPER_ACTIVATION_EVENT_SCHEMA_VERSION,
      event_id: 'event-prepared-crash',
      release_id: 'release-crash-one',
      review_id: review.review_id,
      review_checksum: review.content_checksum,
      state_checksum: review.state_checksum,
      status: 'prepared' as const,
      account_snapshots: [],
      intent_results: [],
      detail: 'Prepared before simulated crash.',
      occurred_at: NOW,
    }
    await journal.appendEvent(paperActivationEventSchema.parse({
      ...unsigned,
      content_checksum: sha256(unsigned),
    }))
    control.global_kill = false

    await service.recoverIncomplete()
    expect(control.global_kill).toBe(true)
    expect(haltWrites()).toBe(1)
    expect((await journal.listEvents()).at(-1)?.status).toBe('halted')
  })

  test('fails closed when the final control write cannot be committed', async () => {
    const { service, journal, control, records, haltWrites } = await setup({ failCommit: true })
    const review = await service.prepareReview()

    await expect(service.commitReview(review.review_id, review.content_checksum))
      .rejects.toThrow('simulated control write failure')
    expect(records[0].state).toBe('canceled')
    expect(control.global_kill).toBe(true)
    expect(haltWrites()).toBe(1)
    expect((await journal.listEvents()).map((event) => event.status))
      .toEqual(['prepared', 'dismissed', 'halted'])
  })

  test('refuses a review that expires during provider work', async () => {
    let current = NOW
    const { service, control } = await setup({
      now: () => current,
      beforeReleaseAssertion: () => { current = '2026-08-11T15:01:00.000Z' },
    })
    const review = await service.prepareReview()

    await expect(service.commitReview(review.review_id, review.content_checksum))
      .rejects.toThrow('expired')
    expect(control.global_kill).toBe(true)
  })
})
