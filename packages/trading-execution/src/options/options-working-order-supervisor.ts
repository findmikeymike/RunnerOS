import type {
  OptionsAutomationPlan,
  OptionsAutomationReceipt,
  OptionsExecutionRecord,
  OptionsManagementRecord,
} from '@trade-god/contracts'

import { sha256 } from '../canonical.ts'

type ReceiptStore = {
  list(): Promise<OptionsAutomationReceipt[]>
  update(receiptId: string, expectedChecksum: string, changes: Partial<OptionsAutomationReceipt>): Promise<OptionsAutomationReceipt>
}

type PlanStore = { list(): Promise<OptionsAutomationPlan[]> }
type Runtime = {
  getRecord(intentId: string): Promise<OptionsExecutionRecord>
  cancelWorkingEntry(input: { intent_id: string; request_id: string; reason: 'signal-no-fill' }): Promise<OptionsManagementRecord>
}

/** Cancels only the unfilled remainder of an automatic entry after its frozen
 * decision window. Confirmed fills stay open and under normal position custody. */
export class OptionsWorkingOrderSupervisor {
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly options: {
    receipts: ReceiptStore
    plans: PlanStore
    resolveRuntime(connectionId: string): Promise<Runtime>
    now?: () => string
    onReceiptError?: (receipt: OptionsAutomationReceipt, error: unknown) => void | Promise<void>
    onReceiptSuccess?: (receipt: OptionsAutomationReceipt) => void | Promise<void>
  }) {}

  sweep(): Promise<number> {
    return this.withLock(async () => {
      const at = this.options.now?.() ?? new Date().toISOString()
      const plans = await this.options.plans.list()
      let handled = 0
      for (const receipt of await this.options.receipts.list()) {
        if (!this.needsReview(receipt, at)) continue
        try {
          handled += await this.processReceipt(receipt, plans, at)
          await this.options.onReceiptSuccess?.(receipt)
        } catch (error) {
          await this.options.onReceiptError?.(receipt, error)
        }
      }
      return handled
    })
  }

  private async processReceipt(receipt: OptionsAutomationReceipt, plans: OptionsAutomationPlan[], at: string): Promise<number> {
        const plan = plans.find((candidate) => candidate.receipt_id === receipt.receipt_id)
        if (!plan || !receipt.execution_intent_id || !receipt.connection_id
          || plan.decision.decision_id !== receipt.execution_intent_id
          || plan.connection.connection_id !== receipt.connection_id) {
          throw new Error(`Expired options receipt ${receipt.receipt_id} has no exact frozen execution plan.`)
        }
        if (Date.parse(at) < Date.parse(plan.decision.valid_until)) return 0
        const runtime = await this.options.resolveRuntime(receipt.connection_id)
        const record = await runtime.getRecord(receipt.execution_intent_id)
        if (record.intent_id !== plan.decision.decision_id || record.connection_id !== plan.connection.connection_id
          || record.canonical_contract_id !== plan.contract.canonical_id) {
          throw new Error('Expired options entry no longer matches its frozen account and contract lineage.')
        }
        if (record.state === 'canceled-flat' || record.state === 'not-sent' || record.state === 'closed-flat') {
          await this.transition(receipt, 'flat', 'The unfilled options entry is canceled and the account is flat.', at)
          return 1
        }
        if (record.state === 'open-position') {
          await this.transition(receipt, 'active', 'The entry window ended; the filled position remains open and tracked.', at)
          return 1
        }
        if (record.state !== 'working' && record.state !== 'partially-filled') {
          throw new Error(`Expired options entry is unresolved in ${record.state}; no cancellation retry was sent.`)
        }
        const requestId = `options-timeout:${sha256({ receipt: receipt.receipt_id, plan: plan.content_checksum, intent: record.intent_id }).slice(0, 32)}`
        const result = await runtime.cancelWorkingEntry({
          intent_id: record.intent_id,
          request_id: requestId,
          reason: 'signal-no-fill',
        })
        if (result.state === 'entry-canceled') {
          await this.transition(receipt, 'flat', 'The signal entry window ended; its unfilled order was canceled.', at)
        } else if (result.state === 'position-open') {
          await this.transition(receipt, 'active', 'The signal entry window ended; the unfilled remainder was canceled and confirmed fills remain open.', at)
        } else {
          await this.transition(receipt, 'halted', 'The expired entry cancellation is not yet proven. This account remains blocked for recovery.', at,
            ['OPTIONS_WORKING_ORDER_TIMEOUT_CANCEL_UNKNOWN'])
        }
        return 1
  }

  private needsReview(receipt: OptionsAutomationReceipt, at: string): boolean {
    return receipt.state === 'working'
      || (receipt.state === 'halted'
        && receipt.reason_codes.includes('OPTIONS_WORKING_ORDER_TIMEOUT_CANCEL_UNKNOWN')
        && Date.parse(at) >= Date.parse(receipt.updated_at))
  }

  private transition(receipt: OptionsAutomationReceipt, state: 'flat' | 'active' | 'halted', detail: string, at: string,
    reasonCodes: string[] = ['OPTIONS_WORKING_ORDER_WINDOW_CLOSED']): Promise<OptionsAutomationReceipt> {
    return this.options.receipts.update(receipt.receipt_id, receipt.content_checksum, {
      state,
      reason_codes: reasonCodes,
      detail,
      updated_at: at,
    })
  }

  private withLock<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }
}
