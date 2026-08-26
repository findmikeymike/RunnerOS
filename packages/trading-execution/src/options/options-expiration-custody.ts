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
