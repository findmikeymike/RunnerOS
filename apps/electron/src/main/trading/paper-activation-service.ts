import { randomUUID } from 'node:crypto'

import {
  PAPER_ACTIVATION_EVENT_SCHEMA_VERSION,
  PAPER_ACTIVATION_REVIEW_SCHEMA_VERSION,
  paperActivationEventSchema,
  paperActivationReviewSchema,
  type PaperActivationBlocker,
  type PaperActivationConnectionEvidence,
  type PaperActivationEvent,
  type PaperActivationPendingIntent,
  type PaperActivationReview,
  type ExecutionAccountSnapshot,
} from '@trade-god/contracts'
import {
  ExecutionGatewayError,
  FilePaperActivationStore,
  sha256,
  type ExecutionGateway,
  type FileDiscoTraderIntentSource,
  type FileStandingAuthorizationStore,
} from '@trade-god/execution'

import type { TradingConnectionService } from './trading-connection-service.ts'

interface ActivationGateway extends Pick<
  ExecutionGateway,
  | 'list'
  | 'readControl'
  | 'captureFlatAccountSnapshot'
  | 'dismissPendingIntent'
  | 'commitPaperActivationRelease'
  | 'setGlobalKill'
  | 'activateEmergencyHalt'
> {}

interface ActivationState {
  adapter_set_checksum: string
  control_checksum: string
  connections: PaperActivationConnectionEvidence[]
  pending_intents: PaperActivationPendingIntent[]
  blockers: PaperActivationBlocker[]
}

export class PaperActivationService {
  constructor(private readonly options: {
    gateway: ActivationGateway
    connections: TradingConnectionService
    authorizations: Pick<FileStandingAuthorizationStore, 'getActive'>
    sources: Pick<FileDiscoTraderIntentSource, 'get'>
    journal: FilePaperActivationStore
    adapterSetChecksum: () => string
    now: () => string
  }) {}

  async prepareReview(): Promise<PaperActivationReview> {
    const state = await this.captureState()
    const createdAt = this.options.now()
    const unsigned = {
      review_schema_version: PAPER_ACTIVATION_REVIEW_SCHEMA_VERSION,
      review_id: `paper-activation-review-${randomUUID()}`,
      ...state,
      ready: state.blockers.length === 0,
      created_at: createdAt,
      expires_at: new Date(Date.parse(createdAt) + 60_000).toISOString(),
      state_checksum: this.stateChecksum(state),
    }
    const review = paperActivationReviewSchema.parse({
      ...unsigned,
      content_checksum: sha256(unsigned),
    })
    return this.options.journal.saveReview(review)
  }

  async commitReview(reviewId: string, reviewChecksum: string): Promise<PaperActivationEvent> {
    const review = await this.options.journal.getReview(reviewId)
    if (review.content_checksum !== reviewChecksum) {
      throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Paper activation review checksum changed.')
    }
    if (!review.ready || Date.parse(review.expires_at) <= Date.parse(this.options.now())) {
      throw new ExecutionGatewayError('KILL_SWITCH_ENABLED', 'Paper activation review is blocked or expired.')
    }
    const current = await this.captureState()
    if (current.blockers.length > 0 || this.stateChecksum(current) !== review.state_checksum) {
      throw new ExecutionGatewayError(
        'RECORD_INTEGRITY_FAILURE',
        'Paper activation state changed after operator review.',
      )
    }
    const releaseId = `paper-activation-release-${randomUUID()}`
    const planned = review.pending_intents.map((intent) => ({
      intent_id: intent.intent_id,
      decision: 'cancel' as const,
      outcome: 'planned' as const,
    }))
    const prepared = await this.appendEvent({
      releaseId,
      review,
      status: 'prepared',
      snapshots: current.connections.map(connectionEvidenceSnapshot),
      results: planned,
      detail: 'Exact flat account truth and pre-activation pending-intent cancellation plan prepared.',
    })
    const results: PaperActivationEvent['intent_results'] = []
    try {
      for (const pending of review.pending_intents) {
        try {
          const canceled = await this.options.gateway.dismissPendingIntent(
            pending.intent_id,
            pending.execution_record_checksum,
          )
          results.push({
            intent_id: pending.intent_id,
            decision: 'cancel',
            outcome: 'canceled',
            final_state: canceled.state,
          })
        } catch (error) {
          results.push({
            intent_id: pending.intent_id,
            decision: 'cancel',
            outcome: 'failed',
            error: error instanceof Error ? error.message : 'Pending intent cancellation failed.',
          })
          throw error
        }
      }
      let dismissed: PaperActivationEvent | undefined
      const finalSnapshots = await this.options.gateway.commitPaperActivationRelease({
        release_id: releaseId,
        state_checksum: review.state_checksum,
        expected_control_checksum: review.control_checksum,
        review_expires_at: review.expires_at,
        connection_ids: review.connections.map((connection) => connection.connection_id),
        assert_release_current: async () => {
          if (Date.parse(this.options.now()) >= Date.parse(review.expires_at)) {
            throw new ExecutionGatewayError(
              'INTENT_EXPIRED',
              'Paper activation review expired before the atomic control release.',
            )
          }
          for (const evidence of review.connections) {
            const authorization = await this.options.authorizations.getActive(evidence.connection_id)
            if (
              !authorization
              || authorization.authorization_id !== evidence.authorization_id
              || sha256(authorization) !== evidence.authorization_checksum
            ) {
              throw new ExecutionGatewayError(
                'AUTHORIZATION_EXPIRED',
                `Standing mandate for ${evidence.connection_id} expired or changed before release.`,
              )
            }
          }
        },
        persist_release_evidence: async (snapshots: ExecutionAccountSnapshot[]) => {
          dismissed = await this.appendEvent({
            releaseId,
            review,
            status: 'dismissed',
            snapshots: snapshots.map(accountSnapshotEvidence),
            results,
            detail: 'Every reviewed pending intent was canceled and every provider account was re-proved flat under the release lock.',
          })
          return {
            release_event_id: dismissed.event_id,
            release_event_checksum: dismissed.content_checksum,
          }
        },
      })
      if (!dismissed) throw new Error('Paper activation release evidence was not persisted.')
      return await this.appendEvent({
        releaseId,
        review,
        status: 'released',
        snapshots: finalSnapshots.map(accountSnapshotEvidence),
        results,
        detail: 'Persistent global new-entry halt released after exact reviewed cancellation.',
      })
    } catch (error) {
      await this.failClosed(releaseId, review, prepared.account_snapshots, results, error)
      throw error
    }
  }

  async recoverIncomplete(): Promise<void> {
    await this.options.gateway.setGlobalKill(true)
    for (const event of await this.options.journal.listIncomplete()) {
      const review = await this.options.journal.getReview(event.review_id)
      await this.appendEvent({
        releaseId: event.release_id,
        review,
        status: 'halted',
        snapshots: event.account_snapshots,
        results: event.intent_results,
        detail: 'Startup re-latched the global halt after an incomplete activation release.',
      })
    }
  }

  private async captureState(): Promise<ActivationState> {
    const [control, statuses, records] = await Promise.all([
      this.options.gateway.readControl(),
      this.options.connections.list(),
      this.options.gateway.list(),
    ])
    const blockers: PaperActivationBlocker[] = []
    if (!control.global_kill) blockers.push({
      code: 'global-halt-not-active',
      detail: 'A paper activation review requires the persistent global new-entry halt.',
    })
    const enabled = statuses.filter(({ connection }) => connection.enabled)
    if (enabled.length === 0) blockers.push({
      code: 'no-enabled-paper-account',
      detail: 'No explicitly enabled paper account is ready for activation review.',
    })
    const connections: PaperActivationConnectionEvidence[] = []
    for (const status of enabled) {
      const connection = status.connection
      const certificationBinding = connection.adapter_certifications?.find((binding) => (
        binding.levels.includes('paper-lifecycle-certified')
      ))
      const certification = certificationBinding
        ? status.certification_evidence.find((evidence) => (
            evidence.certification_id === certificationBinding.certification_id
          ))
        : undefined
      const authorization = await this.options.authorizations.getActive(connection.connection_id)
      if (
        connection.environment !== 'paper'
        || connection.environment_class !== 'rehearsal'
        || connection.state !== 'ready'
        || !connection.certifications.includes('paper-lifecycle-certified')
        || !certificationBinding
        || !certification
      ) blockers.push({
        code: 'paper-certification-required',
        connection_id: connection.connection_id,
        detail: 'Enabled account lacks exact retained paper lifecycle certification.',
      })
      if (
        !status.provider_read_fresh
        || !status.provider_read_verification
        || status.provider_read_verification.position_count !== 0
        || status.provider_read_verification.working_order_count !== 0
      ) blockers.push({
        code: 'fresh-flat-provider-proof-required',
        connection_id: connection.connection_id,
        detail: 'Enabled account needs a fresh flat read-only provider proof.',
      })
      if (!authorization) blockers.push({
        code: 'active-standing-mandate-required',
        connection_id: connection.connection_id,
        detail: 'Enabled account needs an active exact standing mandate.',
      })
      if (
        certification
        && status.provider_read_verification
        && status.provider_read_fresh
        && authorization
      ) {
        try {
          const snapshot = await this.options.gateway.captureFlatAccountSnapshot(connection.connection_id)
          connections.push({
            connection_id: connection.connection_id,
            connection_checksum: sha256(connection),
            provider_verification_id: status.provider_read_verification.verification_id,
            provider_verification_checksum: status.provider_read_verification.content_checksum,
            release_snapshot_id: snapshot.account_snapshot_id,
            release_snapshot_checksum: sha256(snapshot),
            release_snapshot_captured_at: snapshot.captured_at,
            release_position_count: 0,
            release_working_order_count: 0,
            certification_id: certification.certification_id,
            certification_checksum: certification.content_checksum,
            authorization_id: authorization.authorization_id,
            authorization_checksum: sha256(authorization),
            authorized_symbols: authorization.scope.symbols,
            max_contracts: authorization.scope.max_contracts,
            allowed_sides: authorization.scope.allowed_sides,
            allowed_order_types: authorization.scope.allowed_order_types,
            session_start: authorization.scope.session_start,
            session_end: authorization.scope.session_end,
            max_daily_loss: authorization.scope.max_daily_loss,
            max_open_risk: authorization.scope.max_open_risk,
            authorization_expires_at: authorization.expires_at,
          })
        } catch (error) {
          blockers.push({
            code: 'release-time-flat-proof-failed',
            connection_id: connection.connection_id,
            detail: error instanceof Error ? error.message : 'Release-time provider truth failed.',
          })
        }
      }
    }
    const pendingIntents: PaperActivationPendingIntent[] = []
    const terminalStates = new Set(['risk-denied', 'closed', 'rejected', 'canceled', 'expired', 'error'])
    for (const record of records) {
      if (
        record.state !== 'created'
        && record.state !== 'approved'
        && !terminalStates.has(record.state)
      ) blockers.push({
        code: 'active-or-uncertain-execution',
        connection_id: record.intent.connection_id,
        detail: `Execution ${record.intent.intent_id} is ${record.state}; activation requires every account lineage to be terminal or explicitly reviewable.`,
      })
    }
    for (const record of records.filter((candidate) => (
      candidate.state === 'created' || candidate.state === 'approved'
    ))) {
      if (record.intent.source.type !== 'discord') {
        blockers.push({
          code: 'non-discord-pending-intent',
          connection_id: record.intent.connection_id,
          detail: `Pending intent ${record.intent.intent_id} is not backed by Discord source evidence.`,
        })
        continue
      }
      try {
        const artifact = await this.options.sources.get(record.intent.intent_id)
        if (
          artifact.intent.intent_id !== record.intent.intent_id
          || artifact.intent.content_checksum !== record.intent.content_checksum
        ) {
          throw new ExecutionGatewayError(
            'RECORD_INTEGRITY_FAILURE',
            `Source artifact does not match pending intent ${record.intent.intent_id}.`,
          )
        }
        pendingIntents.push({
          intent_id: record.intent.intent_id,
          intent_checksum: record.intent.content_checksum,
          execution_record_checksum: sha256(record),
          connection_id: record.intent.connection_id,
          source_id: record.intent.source.source_id,
          source_artifact_checksum: sha256(artifact),
          source_ticket_checksum: artifact.source_ticket_sha256,
          symbol: record.intent.instrument.symbol,
          side: record.intent.side,
          quantity: record.intent.quantity,
          state: record.state,
          created_at: record.created_at,
          valid_until: record.intent.valid_until,
        })
      } catch (error) {
        blockers.push({
          code: 'pending-source-evidence-unavailable',
          connection_id: record.intent.connection_id,
          detail: error instanceof Error ? error.message : `Source evidence missing for ${record.intent.intent_id}.`,
        })
      }
    }
    return {
      adapter_set_checksum: this.options.adapterSetChecksum(),
      control_checksum: sha256(control),
      connections: connections.sort((a, b) => a.connection_id.localeCompare(b.connection_id)),
      pending_intents: pendingIntents.sort((a, b) => a.intent_id.localeCompare(b.intent_id)),
      blockers: blockers.sort((a, b) => `${a.code}:${a.connection_id ?? ''}`.localeCompare(`${b.code}:${b.connection_id ?? ''}`)),
    }
  }

  private stateChecksum(state: ActivationState): string {
    return sha256({
      adapter_set_checksum: state.adapter_set_checksum,
      control_checksum: state.control_checksum,
      connections: state.connections.map((evidence) => ({
        connection_id: evidence.connection_id,
        connection_checksum: evidence.connection_checksum,
        provider_verification_id: evidence.provider_verification_id,
        provider_verification_checksum: evidence.provider_verification_checksum,
        certification_id: evidence.certification_id,
        certification_checksum: evidence.certification_checksum,
        authorization_id: evidence.authorization_id,
        authorization_checksum: evidence.authorization_checksum,
        authorized_symbols: evidence.authorized_symbols,
        max_contracts: evidence.max_contracts,
        allowed_sides: evidence.allowed_sides,
        allowed_order_types: evidence.allowed_order_types,
        session_start: evidence.session_start,
        session_end: evidence.session_end,
        max_daily_loss: evidence.max_daily_loss,
        max_open_risk: evidence.max_open_risk,
        authorization_expires_at: evidence.authorization_expires_at,
      })),
      pending_intents: state.pending_intents,
      blockers: state.blockers,
    })
  }

  private async appendEvent(input: {
    releaseId: string
    review: PaperActivationReview
    status: PaperActivationEvent['status']
    snapshots: PaperActivationEvent['account_snapshots']
    results: PaperActivationEvent['intent_results']
    detail: string
  }): Promise<PaperActivationEvent> {
    const unsigned = {
      event_schema_version: PAPER_ACTIVATION_EVENT_SCHEMA_VERSION,
      event_id: `paper-activation-event-${randomUUID()}`,
      release_id: input.releaseId,
      review_id: input.review.review_id,
      review_checksum: input.review.content_checksum,
      state_checksum: input.review.state_checksum,
      status: input.status,
      account_snapshots: input.snapshots,
      intent_results: input.results,
      detail: input.detail,
      occurred_at: this.options.now(),
    }
    return this.options.journal.appendEvent(paperActivationEventSchema.parse({
      ...unsigned,
      content_checksum: sha256(unsigned),
    }))
  }

  private async failClosed(
    releaseId: string,
    review: PaperActivationReview,
    snapshots: PaperActivationEvent['account_snapshots'],
    results: PaperActivationEvent['intent_results'],
    error: unknown,
  ): Promise<void> {
    try {
      await this.options.gateway.setGlobalKill(true)
    } catch {
      await this.options.gateway.activateEmergencyHalt().catch(() => undefined)
    }
    await this.appendEvent({
      releaseId,
      review,
      status: 'halted',
      snapshots,
      results,
      detail: error instanceof Error ? error.message : 'Paper activation failed closed.',
    }).catch(() => undefined)
  }
}

const connectionEvidenceSnapshot = (
  evidence: PaperActivationConnectionEvidence,
): PaperActivationEvent['account_snapshots'][number] => ({
  connection_id: evidence.connection_id,
  snapshot_id: evidence.release_snapshot_id,
  snapshot_checksum: evidence.release_snapshot_checksum,
  captured_at: evidence.release_snapshot_captured_at,
  position_count: 0,
  working_order_count: 0,
})

const accountSnapshotEvidence = (
  snapshot: ExecutionAccountSnapshot,
): PaperActivationEvent['account_snapshots'][number] => ({
  connection_id: snapshot.connection_id,
  snapshot_id: snapshot.account_snapshot_id,
  snapshot_checksum: sha256(snapshot),
  captured_at: snapshot.captured_at,
  position_count: 0,
  working_order_count: 0,
})
