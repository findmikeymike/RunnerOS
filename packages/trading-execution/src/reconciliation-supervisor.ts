import type { ExecutionLifecycleState, ExecutionRecord } from '@trade-god/contracts'

import type { ExecutionGateway } from './gateway.ts'
import { ExecutionGatewayError } from './errors.ts'

export interface ReconciliationSupervisorHealth {
  running: boolean
  cycle_in_progress: boolean
  last_cycle_started_at?: string
  last_success_at?: string
  consecutive_failures: number
  stale_connection_ids: string[]
  fresh_connection_ids: string[]
}

export interface ExecutionReconciliationSupervisorOptions {
  gateway: Pick<
    ExecutionGateway,
    'list' | 'reconcile' | 'verifyConnectionAccountCoverage' | 'setConnectionKill' | 'activateEmergencyHalt'
  >
  now?: () => string
  intervalMs?: number
  staleAfterMs?: number
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
}

const RECONCILABLE_STATES = new Set<ExecutionLifecycleState>([
  'acknowledged',
  'partially-filled',
  'filled',
  'protecting',
  'protected',
  'closing',
  'submit-unknown',
  'protection-unknown',
])

/** Read-only provider-truth supervision. It can halt new entries, never submit them. */
export class ExecutionReconciliationSupervisor {
  private readonly now: () => string
  private readonly intervalMs: number
  private readonly staleAfterMs: number
  private readonly setTimer: NonNullable<ExecutionReconciliationSupervisorOptions['setTimer']>
  private readonly clearTimer: NonNullable<ExecutionReconciliationSupervisorOptions['clearTimer']>
  private timer?: ReturnType<typeof setTimeout>
  private running = false
  private cycle?: Promise<void>
  private lastCycleStartedAt?: string
  private lastSuccessAt?: string
  private consecutiveFailures = 0
  private readonly staleConnections = new Set<string>()
  private readonly failureSince = new Map<string, number>()
  private readonly lastConnectionSuccess = new Map<string, number>()
  private readonly invalidationEpochs = new Map<string, number>()
  private wakePending = false

  constructor(private readonly options: ExecutionReconciliationSupervisorOptions) {
    this.now = options.now ?? (() => new Date().toISOString())
    // REST is only a low-rate safety sweep. Event-driven provider truth can
    // wake this sooner without multiplying full REST joins per open intent.
    this.intervalMs = Math.max(1_000, options.intervalMs ?? 120_000)
    this.staleAfterMs = Math.max(this.intervalMs, options.staleAfterMs ?? 360_000)
    this.setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay))
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer))
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.schedule(0)
  }

  async stop(): Promise<void> {
    this.running = false
    if (this.timer) this.clearTimer(this.timer)
    this.timer = undefined
    await this.cycle
  }

  invalidate(connectionId: string): void {
    this.lastConnectionSuccess.delete(connectionId)
    this.invalidationEpochs.set(connectionId, (this.invalidationEpochs.get(connectionId) ?? 0) + 1)
    this.wake()
  }

  wake(): void {
    if (!this.running) return
    if (this.cycle) {
      this.wakePending = true
      return
    }
    if (this.timer) this.clearTimer(this.timer)
    this.schedule(0)
  }

  health(): ReconciliationSupervisorHealth {
    return {
      running: this.running,
      cycle_in_progress: Boolean(this.cycle),
      ...(this.lastCycleStartedAt ? { last_cycle_started_at: this.lastCycleStartedAt } : {}),
      ...(this.lastSuccessAt ? { last_success_at: this.lastSuccessAt } : {}),
      consecutive_failures: this.consecutiveFailures,
      stale_connection_ids: [...this.staleConnections].sort(),
      fresh_connection_ids: [...this.lastConnectionSuccess]
        .filter(([connectionId, succeededAt]) => (
          !this.staleConnections.has(connectionId)
          && Date.parse(this.now()) - succeededAt <= this.staleAfterMs
        ))
        .map(([connectionId]) => connectionId)
        .sort(),
    }
  }

  canReleaseConnectionHalt(connectionId: string): boolean {
    const succeededAt = this.lastConnectionSuccess.get(connectionId)
    return (
      succeededAt !== undefined
      && !this.staleConnections.has(connectionId)
      && Date.parse(this.now()) - succeededAt <= this.staleAfterMs
    )
  }

  async runOnce(): Promise<void> {
    if (this.cycle) return this.cycle
    this.cycle = this.performCycle()
      .catch(async () => {
        this.consecutiveFailures += 1
        try {
          await this.options.gateway.activateEmergencyHalt()
        } catch {
          // activateEmergencyHalt latches the process before durable I/O.
        }
      })
      .finally(() => { this.cycle = undefined })
    return this.cycle
  }

  private schedule(delayMs: number): void {
    this.timer = this.setTimer(() => {
      this.timer = undefined
      void this.runOnce().finally(() => {
        if (!this.running) return
        const delay = this.wakePending ? 0 : this.intervalMs
        this.wakePending = false
        this.schedule(delay)
      })
    }, delayMs)
  }

  private async performCycle(): Promise<void> {
    const startedAt = this.now()
    this.lastCycleStartedAt = startedAt
    const records = (await this.options.gateway.list()).filter(isReconcilable)
    const byConnection = groupByConnection(records)
    const cycleEpochs = new Map(this.invalidationEpochs)
    for (const connectionId of cycleEpochs.keys()) {
      if (!byConnection.has(connectionId)) byConnection.set(connectionId, [])
    }
    for (const connectionId of this.failureSince.keys()) {
      if (!byConnection.has(connectionId) && !this.invalidationEpochs.has(connectionId)) {
        this.failureSince.delete(connectionId)
        this.staleConnections.delete(connectionId)
      }
    }
    let failures = 0
    for (const [connectionId, connectionRecords] of byConnection) {
      let connectionFailed = false
      let immediateHalt = false
      try {
        for (const record of connectionRecords) {
          await this.options.gateway.reconcile(record.intent.intent_id)
        }
        await this.options.gateway.verifyConnectionAccountCoverage(connectionId)
      } catch (error) {
        connectionFailed = true
        immediateHalt = isImmediateTruthFailure(error)
        failures += 1
      }
      if (connectionFailed) {
        this.lastConnectionSuccess.delete(connectionId)
        const firstFailure = this.failureSince.get(connectionId) ?? Date.parse(startedAt)
        this.failureSince.set(connectionId, firstFailure)
        if (immediateHalt || Date.parse(startedAt) - firstFailure >= this.staleAfterMs) {
          this.staleConnections.add(connectionId)
          await this.options.gateway.setConnectionKill(connectionId, true)
        }
      } else {
        this.failureSince.delete(connectionId)
        this.staleConnections.delete(connectionId)
        const capturedEpoch = cycleEpochs.get(connectionId)
        const currentEpoch = this.invalidationEpochs.get(connectionId)
        if (capturedEpoch === undefined || currentEpoch === capturedEpoch) {
          if (capturedEpoch !== undefined) this.invalidationEpochs.delete(connectionId)
          this.lastConnectionSuccess.set(connectionId, Date.parse(startedAt))
        }
      }
    }
    if (failures === 0) {
      this.lastSuccessAt = startedAt
      this.consecutiveFailures = 0
    } else {
      this.consecutiveFailures += 1
    }
  }
}

const isImmediateTruthFailure = (error: unknown): boolean => (
  error instanceof ExecutionGatewayError
  && new Set([
    'ACCOUNT_MISMATCH',
    'ENVIRONMENT_MISMATCH',
    'RECONCILIATION_DIVERGENCE',
    'RECORD_INTEGRITY_FAILURE',
    'INTENT_CHECKSUM_MISMATCH',
  ]).has(error.code)
)

const isReconcilable = (record: ExecutionRecord): boolean => (
  Boolean(record.command) && RECONCILABLE_STATES.has(record.state)
)

const groupByConnection = (records: ExecutionRecord[]): Map<string, ExecutionRecord[]> => {
  const grouped = new Map<string, ExecutionRecord[]>()
  for (const record of records) {
    const values = grouped.get(record.intent.connection_id) ?? []
    values.push(record)
    grouped.set(record.intent.connection_id, values)
  }
  return grouped
}
