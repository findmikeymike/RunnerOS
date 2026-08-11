import type { ExecutionAuthorization, ExecutionRecord } from '@trade-god/contracts'

import { canonicalJson } from './canonical.ts'
import type { ExecutionGateway } from './gateway.ts'
import type { FileStandingAuthorizationStore } from './standing-authorization-store.ts'

export interface ExecutionCoordinationResult {
  intent_id: string
  state: ExecutionRecord['state']
  outcome: 'executed' | 'risk-denied' | 'inert' | 'failed'
  error?: string
}

export class PaperExecutionCoordinator {
  private queue: Promise<void> = Promise.resolve()
  private readonly authorizationEpoch = new Map<string, number>()

  constructor(
    private readonly gateway: Pick<
      ExecutionGateway,
      'readControl' | 'get' | 'list' | 'evaluateAndApprove' | 'execute'
    >,
    private readonly authorizations: Pick<
      FileStandingAuthorizationStore,
      'getActive' | 'save' | 'revoke'
    >,
    private readonly hasProviderAdapters: () => boolean,
  ) {}

  coordinate(intentId: string): Promise<ExecutionRecord> {
    return this.withLock(() => this.coordinateLocked(intentId))
  }

  saveAuthorization(authorization: ExecutionAuthorization): Promise<ExecutionAuthorization> {
    this.bumpAuthorizationEpoch(authorization.connection_id)
    return this.withLock(() => this.authorizations.save(authorization))
  }

  revokeAuthorization(connectionId: string): Promise<boolean> {
    this.bumpAuthorizationEpoch(connectionId)
    return this.withLock(() => this.authorizations.revoke(connectionId))
  }

  async coordinatePending(): Promise<ExecutionCoordinationResult[]> {
    return this.withLock(async () => {
      const pending = (await this.gateway.list()).filter(
        (record) => record.state === 'created' || record.state === 'approved',
      )
      const results: ExecutionCoordinationResult[] = []
      for (const record of pending) {
        try {
          const coordinated = await this.coordinateLocked(record.intent.intent_id)
          results.push({
            intent_id: coordinated.intent.intent_id,
            state: coordinated.state,
            outcome: coordinated.state === 'risk-denied'
              ? 'risk-denied'
              : coordinated.state === 'created' || coordinated.state === 'approved'
                ? 'inert'
                : 'executed',
          })
        } catch (error) {
          results.push({
            intent_id: record.intent.intent_id,
            state: (await this.gateway.get(record.intent.intent_id)).state,
            outcome: 'failed',
            error: error instanceof Error ? error.message : 'Unknown coordination failure.',
          })
        }
      }
      return results
    })
  }

  private async coordinateLocked(intentId: string): Promise<ExecutionRecord> {
    let record = await this.gateway.get(intentId)
    if (record.state !== 'created' && record.state !== 'approved') return record
    if (!this.hasProviderAdapters()) return record
    if ((await this.gateway.readControl()).global_kill) return record

    const authorizationEpoch = this.authorizationEpoch.get(record.intent.connection_id) ?? 0
    const authorization = await this.authorizations.getActive(record.intent.connection_id)
    if (
      !authorization
      || (this.authorizationEpoch.get(record.intent.connection_id) ?? 0) !== authorizationEpoch
    ) return record

    if (record.state === 'created') {
      record = await this.gateway.evaluateAndApprove(intentId, authorization)
    }
    if (record.state !== 'approved') return record
    if ((this.authorizationEpoch.get(record.intent.connection_id) ?? 0) !== authorizationEpoch) {
      return record
    }
    const currentAuthorization = await this.authorizations.getActive(record.intent.connection_id)
    if (
      (this.authorizationEpoch.get(record.intent.connection_id) ?? 0) !== authorizationEpoch
      || !currentAuthorization
      || !record.authorization
      || canonicalJson(record.authorization) !== canonicalJson(currentAuthorization)
    ) return record
    return this.gateway.execute(intentId)
  }

  private bumpAuthorizationEpoch(connectionId: string): void {
    this.authorizationEpoch.set(
      connectionId,
      (this.authorizationEpoch.get(connectionId) ?? 0) + 1,
    )
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue
    let release!: () => void
    this.queue = previous.catch(() => undefined).then(() => new Promise<void>((resolve) => {
      release = resolve
    }))
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
    }
  }
}
