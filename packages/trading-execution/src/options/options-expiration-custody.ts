import {
  OPTIONS_EXPIRATION_ASSESSMENT_SCHEMA_VERSION,
  optionsEntryPolicySchema,
  optionsExecutionRecordSchema,
  optionsExpirationAssessmentSchema,
  optionsExpirationScheduleSchema,
  type OptionsEntryPolicy,
  type OptionsExecutionRecord,
  type OptionsExpirationAssessment,
  type OptionsExpirationSchedule,
} from '@trade-god/contracts'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { sha256 } from '../canonical.ts'

export class OptionsExpirationCustodyPlanner {
  assess(input: {
    entry: OptionsExecutionRecord
    policy: OptionsEntryPolicy
    schedule: OptionsExpirationSchedule
    assessed_at: string
    provider_automatic_close_certified: boolean
    provider_do_not_exercise_certified: boolean
  }): OptionsExpirationAssessment {
    const entry = verify(optionsExecutionRecordSchema.parse(input.entry))
    const policy = verify(optionsEntryPolicySchema.parse(input.policy))
    const schedule = verify(optionsExpirationScheduleSchema.parse(input.schedule))
    const expiration = parseCanonicalContract(entry.canonical_contract_id).expiration
    if (entry.connection_id !== schedule.connection_id || entry.account_id !== schedule.account_id
      || entry.canonical_contract_id !== schedule.canonical_contract_id || expiration !== schedule.expiration
      || policy.connection_id !== entry.connection_id || policy.account_id !== entry.account_id
      || policy.expiration_custody.provider_calendar_checksum !== schedule.provider_calendar_checksum
      || policy.expiration_custody.account_exercise_setting_checksum !== schedule.account_exercise_setting_checksum
      || policy.expiration_custody.do_not_exercise_mode !== schedule.do_not_exercise_mode) {
      throw new Error('Expiration custody evidence does not bind the exact account, contract, and policy.')
    }
    const at = Date.parse(input.assessed_at)
    if (!Number.isFinite(at)) throw new Error('Expiration assessment time is invalid.')
    let state: OptionsExpirationAssessment['state']
    let nextDeadline: string | null
    let automaticClose = false
    let operatorRequired = false
    let detail: string
    if (entry.open_quantity === 0) {
      state = 'resolved-flat'; nextDeadline = null; detail = 'The exact option lineage is flat.'
    } else if (at < Date.parse(schedule.automatic_close_start_at)) {
      state = 'monitoring'; nextDeadline = schedule.automatic_close_start_at; detail = 'Position is open and monitored before the certified close window.'
    } else if (at < Date.parse(schedule.operator_escalation_at)) {
      state = 'close-due'; nextDeadline = schedule.operator_escalation_at
      automaticClose = input.provider_automatic_close_certified && input.provider_do_not_exercise_certified
      operatorRequired = !automaticClose
      detail = automaticClose ? 'Certified expiration close is due.' : 'Close the position now; unattended expiration authority is not certified.'
    } else if (at < Date.parse(schedule.broker_order_cutoff_at)) {
      state = 'operator-escalation'; nextDeadline = schedule.broker_order_cutoff_at; operatorRequired = true
      detail = 'Broker order cutoff is approaching. Operator action is required now.'
    } else if (at < Date.parse(schedule.exercise_instruction_cutoff_at)) {
      const providerDne = schedule.do_not_exercise_mode === 'provider-supported' && input.provider_do_not_exercise_certified
      state = providerDne ? 'provider-do-not-exercise-required' : 'manual-do-not-exercise-required'
      nextDeadline = schedule.exercise_instruction_cutoff_at; operatorRequired = true
      detail = providerDne ? 'The certified provider do-not-exercise workflow must complete before cutoff.' : 'Automatic do-not-exercise is unavailable. Contact the broker and confirm instructions before cutoff.'
    } else {
      state = 'custody-halted'; nextDeadline = null; operatorRequired = true
      detail = 'Expiration custody deadline passed with unresolved exposure. Automation remains halted.'
    }
    const unsigned = {
      assessment_schema_version: OPTIONS_EXPIRATION_ASSESSMENT_SCHEMA_VERSION,
      assessment_id: `options-expiration-assessment:${sha256({ entry: entry.content_checksum, schedule: schedule.content_checksum, at: input.assessed_at }).slice(0, 32)}`,
      entry_intent_id: entry.intent_id, entry_record_checksum: entry.content_checksum,
      schedule_checksum: schedule.content_checksum, open_quantity: entry.open_quantity,
      state, next_deadline_at: nextDeadline, automatic_close_allowed: automaticClose,
      operator_action_required: operatorRequired, assessed_at: input.assessed_at, detail,
    }
    return optionsExpirationAssessmentSchema.parse({ ...unsigned, content_checksum: sha256(unsigned) })
  }
}

export class FileOptionsExpirationCustodyStore {
  private readonly schedules: string
  private readonly assessments: string

  constructor(root: string) {
    this.schedules = path.join(root, 'options-automation', 'expiration', 'schedules')
    this.assessments = path.join(root, 'options-automation', 'expiration', 'assessments')
  }

  async saveSchedule(input: OptionsExpirationSchedule): Promise<OptionsExpirationSchedule> {
    const schedule = verify(optionsExpirationScheduleSchema.parse(input))
    await this.writeImmutable(this.schedules, schedule.schedule_id, schedule)
    return schedule
  }

  async getExact(input: {
    connection_id: string
    account_id: string
    canonical_contract_id: string
    provider_calendar_checksum: string
    account_exercise_setting_checksum: string
  }): Promise<OptionsExpirationSchedule | undefined> {
    const matches = (await this.listSchedules()).filter((item) => item.connection_id === input.connection_id
      && item.account_id === input.account_id && item.canonical_contract_id === input.canonical_contract_id
      && item.provider_calendar_checksum === input.provider_calendar_checksum
      && item.account_exercise_setting_checksum === input.account_exercise_setting_checksum)
    if (matches.length > 1) throw new Error('Multiple expiration schedules claim the same exact options custody scope.')
    return matches[0]
  }

  async saveAssessment(input: OptionsExpirationAssessment): Promise<OptionsExpirationAssessment> {
    const assessment = verify(optionsExpirationAssessmentSchema.parse(input))
    await this.writeImmutable(this.assessments, assessment.assessment_id, assessment)
    return assessment
  }

  listSchedules(): Promise<OptionsExpirationSchedule[]> {
    return this.list(this.schedules, (value) => verify(optionsExpirationScheduleSchema.parse(value)))
  }

  async listAssessments(): Promise<OptionsExpirationAssessment[]> {
    return (await this.list(this.assessments, (value) => verify(optionsExpirationAssessmentSchema.parse(value))))
      .sort((left, right) => left.assessed_at.localeCompare(right.assessed_at)
        || left.assessment_id.localeCompare(right.assessment_id))
  }

  private async writeImmutable(directory: string, id: string, value: { content_checksum: string }): Promise<void> {
    await mkdir(directory, { recursive: true })
    const file = path.join(directory, `${sha256(id)}.json`)
    try {
      await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = JSON.parse(await readFile(file, 'utf8')) as { content_checksum?: string }
      if (existing.content_checksum !== value.content_checksum) throw new Error('Expiration custody evidence identity conflicts.')
    }
  }

  private async list<T>(directory: string, parse: (value: unknown) => T): Promise<T[]> {
    let names: string[]
    try { names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort() } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    return Promise.all(names.map(async (name) => parse(JSON.parse(await readFile(path.join(directory, name), 'utf8')))))
  }
}

export class OptionsExpirationCustodySupervisor {
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly options: {
    store: FileOptionsExpirationCustodyStore
    plans(): Promise<Array<{ policy: OptionsEntryPolicy; connection: { connection_id: string; account_ref: string }; contract: { canonical_id: string }; decision: { decision_id: string } }>>
    getRecord(connectionId: string, intentId: string): Promise<OptionsExecutionRecord>
    closePosition(connectionId: string, input: {
      intent_id: string
      request_id: string
      reason: 'expiration-custody'
      quantity: 'all'
      minimum_credit: string
    }): Promise<{ state: string }>
    certification(connectionId: string): Promise<{
      provider_automatic_close_certified: boolean
      provider_do_not_exercise_certified: boolean
      content_checksum: string
    } | undefined>
    now?: () => string
    onError?: (connectionId: string, intentId: string, error: unknown) => void | Promise<void>
    onSuccess?: (connectionId: string, intentId: string) => void | Promise<void>
  }) {}

  sweep(): Promise<number> {
    return this.withLock(async () => {
      const at = this.options.now?.() ?? new Date().toISOString()
      let assessed = 0
      for (const plan of await this.options.plans()) {
        const connectionId = plan.connection.connection_id
        const intentId = plan.decision.decision_id
        try {
          const record = await this.options.getRecord(connectionId, intentId)
          if (record.state !== 'open-position' && record.state !== 'closed-flat' && record.state !== 'canceled-flat') continue
          const schedule = await this.options.store.getExact({
            connection_id: connectionId,
            account_id: plan.connection.account_ref,
            canonical_contract_id: plan.contract.canonical_id,
            provider_calendar_checksum: plan.policy.expiration_custody.provider_calendar_checksum,
            account_exercise_setting_checksum: plan.policy.expiration_custody.account_exercise_setting_checksum,
          })
          if (!schedule) throw new Error('No retained broker expiration schedule matches this exact account and contract.')
          const certification = await this.options.certification(connectionId)
          const exactCertification = certification
            && certification.content_checksum === plan.policy.certification_checksum
            && certification.content_checksum === plan.policy.expiration_custody.custody_certification_checksum
            ? certification
            : undefined
          const assessment = new OptionsExpirationCustodyPlanner().assess({
            entry: record,
            policy: plan.policy,
            schedule,
            assessed_at: at,
            provider_automatic_close_certified: exactCertification?.provider_automatic_close_certified === true,
            provider_do_not_exercise_certified: exactCertification?.provider_do_not_exercise_certified === true,
          })
          await this.options.store.saveAssessment(assessment)
          assessed += 1
          if (assessment.automatic_close_allowed) {
            const result = await this.options.closePosition(connectionId, {
              intent_id: intentId,
              request_id: `options-expiration:${sha256({ intent: intentId, schedule: schedule.content_checksum }).slice(0, 32)}`,
              reason: 'expiration-custody',
              quantity: 'all',
              minimum_credit: '0.01',
            })
            if (!['close-working', 'partially-closed', 'closed-flat'].includes(result.state)) {
              throw new Error(`Certified expiration close is unresolved in ${result.state}.`)
            }
          }
          await this.options.onSuccess?.(connectionId, intentId)
        } catch (error) {
          await this.options.onError?.(connectionId, intentId, error)
        }
      }
      return assessed
    })
  }

  private withLock<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }
}

function verify<T extends { content_checksum: string }>(value: T): T {
  const { content_checksum: _checksum, ...unsigned } = value
  if (sha256(unsigned) !== value.content_checksum) throw new Error('Expiration custody evidence checksum is invalid.')
  return value
}

function parseCanonicalContract(canonicalId: string): { expiration: string } {
  const match = /^USOPT:[A-Z][A-Z0-9.]{0,14}:(\d{4}-\d{2}-\d{2}):[CP]:.+$/.exec(canonicalId)
  if (!match) throw new Error('Canonical option contract identity is invalid.')
  return { expiration: match[1]! }
}
