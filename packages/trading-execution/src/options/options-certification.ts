import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  OPTIONS_CERTIFICATION_EVIDENCE_SCHEMA_VERSION,
  optionsCertificationEvidenceSchema,
  optionsCertificationScenarioSchema,
  type OptionsCertificationEvidence,
  type OptionsCertificationScenario,
  type OptionsConnection,
} from '@trade-god/contracts'

import { canonicalJson, sha256 } from '../canonical.ts'
import { FixedDecimal } from './fixed-decimal.ts'

export interface OptionsCertificationScenarioObservation {
  status: 'pass' | 'fail' | 'blocked'
  detail: string
  evidence: unknown
}

export interface RestrictedOptionsCertificationRunner {
  readonly certification_session_id: string
  readonly connection_id: string
  readonly account_ref: string
  readonly provider: 'ibkr' | 'webull'
  readonly environment: 'paper' | 'sandbox'
  readonly adapter_id: string
  readonly adapter_version: string
  readonly provider_contract_version: string
  readonly allowed_contract_id: string
  readonly allowed_provider_instrument_id: string
  readonly client_order_prefix: string
  runScenario(
    scenario: OptionsCertificationScenario,
    scope: { max_test_debit: string; expires_at: string },
  ): Promise<OptionsCertificationScenarioObservation>
  finalTruth(): Promise<{
    position_quantity: number
    working_order_count: number
    mutation_count: number
    evidence: unknown
  }>
  journalHeadChecksum(): Promise<string>
}

export interface StartOptionsCertificationInput {
  connection: OptionsConnection
  max_test_debit: string
  expires_at: string
}

export const optionsCertificationChecksum = (
  evidence: Omit<OptionsCertificationEvidence, 'content_checksum'> | OptionsCertificationEvidence,
): string => {
  const { content_checksum: _ignored, ...unsigned } = evidence as OptionsCertificationEvidence
  return sha256(unsigned)
}

export async function runRestrictedOptionsCertification(
  input: StartOptionsCertificationInput,
  runner: RestrictedOptionsCertificationRunner,
  now: () => string = () => new Date().toISOString(),
): Promise<OptionsCertificationEvidence> {
  const connection = input.connection
  assertRunnerScope(connection, runner)
  if (connection.state !== 'read-only-verified' || !connection.read_only || connection.execution_enabled) {
    throw new Error('Options certification requires an exact verified read-only account.')
  }
  const startedAt = now()
  if (Date.parse(input.expires_at) <= Date.parse(startedAt)) throw new Error('Certification session is already expired.')
  const maxDebit = FixedDecimal.from(input.max_test_debit)
  if (maxDebit.compare('0') <= 0 || maxDebit.compare('1000') > 0) {
    throw new Error('Certification maximum test debit must be between $0 and $1,000.')
  }
  const scenarios = []
  for (const scenario of optionsCertificationScenarioSchema.options) {
    let observation: OptionsCertificationScenarioObservation
    if (Date.parse(now()) >= Date.parse(input.expires_at)) {
      observation = { status: 'blocked', detail: 'Certification session expired.', evidence: { scenario, expired: true } }
    } else try {
      observation = await runner.runScenario(scenario, {
        max_test_debit: input.max_test_debit,
        expires_at: input.expires_at,
      })
    } catch (error) {
      observation = {
        status: 'fail',
        detail: safeError(error),
        evidence: { scenario, error: safeError(error) },
      }
    }
    if (!['pass', 'fail', 'blocked'].includes(observation.status)
      || typeof observation.detail !== 'string'
      || !observation.detail.trim()
      || observation.detail.length > 300) {
      throw new Error(`Certification runner returned invalid evidence for ${scenario}.`)
    }
    scenarios.push({
      scenario,
      status: observation.status,
      evidence_checksum: sha256(observation.evidence),
      detail: observation.detail,
      observed_at: now(),
    })
  }
  const finalTruth = await runner.finalTruth()
  const journalHeadChecksum = await runner.journalHeadChecksum()
  const allPassed = scenarios.every((scenario) => scenario.status === 'pass')
    && finalTruth.position_quantity === 0
    && finalTruth.working_order_count === 0
    && finalTruth.mutation_count >= 4
  const unsigned = {
    certification_schema_version: OPTIONS_CERTIFICATION_EVIDENCE_SCHEMA_VERSION,
    certification_id: `options-cert-${randomUUID()}`,
    certification_session_id: runner.certification_session_id,
    journal_head_checksum: journalHeadChecksum,
    connection_id: connection.connection_id,
    connection_checksum: connection.content_checksum,
    credential_generation: connection.credential_generation,
    provider: connection.provider,
    environment: connection.environment,
    account_ref: connection.account_ref,
    adapter_id: connection.adapter_id,
    adapter_version: connection.adapter_version,
    provider_contract_version: connection.provider_contract_version,
    max_test_debit: input.max_test_debit,
    client_order_prefix: runner.client_order_prefix,
    allowed_contract_id: runner.allowed_contract_id,
    allowed_provider_instrument_id: runner.allowed_provider_instrument_id,
    started_at: startedAt,
    completed_at: now(),
    expires_at: input.expires_at,
    scenarios,
    mutation_count: finalTruth.mutation_count,
    final_position_quantity: finalTruth.position_quantity,
    final_working_order_count: finalTruth.working_order_count,
    final_truth_evidence_checksum: sha256(finalTruth.evidence),
    eligible_level: allPassed ? 'options-sandbox-entry-certified' as const : null,
  }
  return optionsCertificationEvidenceSchema.parse({
    ...unsigned,
    content_checksum: sha256(unsigned),
  })
}

export class FileOptionsCertificationStore {
  private readonly directory: string

  constructor(private readonly root: string) {
    this.directory = path.join(root, 'options-certifications')
  }

  async save(evidence: OptionsCertificationEvidence): Promise<OptionsCertificationEvidence> {
    const verified = verifyEvidence(evidence)
    if (!(await this.hasExactJournalBinding(verified))) {
      throw new Error('Options certification evidence is missing its exact completed provider journal.')
    }
    const directory = path.join(this.directory, verified.connection_id)
    await mkdir(directory, { recursive: true })
    const file = path.join(directory, `${verified.certification_id}.json`)
    try {
      await writeFile(file, `${canonicalJson(verified)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = verifyEvidence(JSON.parse(await readFile(file, 'utf8')))
      if (canonicalJson(existing) !== canonicalJson(verified)) throw new Error('Immutable options certification ID collision.')
    }
    return verified
  }

  async list(connectionId: string): Promise<OptionsCertificationEvidence[]> {
    const directory = path.join(this.directory, connectionId)
    let names: string[]
    try { names = await readdir(directory) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const current: OptionsCertificationEvidence[] = []
    for (const name of names.filter((candidate) => candidate.endsWith('.json')).sort()) {
      const raw = JSON.parse(await readFile(path.join(directory, name), 'utf8')) as Record<string, unknown>
      if (raw.certification_schema_version !== OPTIONS_CERTIFICATION_EVIDENCE_SCHEMA_VERSION) continue
      const evidence = verifyEvidence(raw)
      if (name !== `${evidence.certification_id}.json` || evidence.connection_id !== connectionId) {
        throw new Error('Options certification filename does not match its identity.')
      }
      current.push(evidence)
    }
    return current
  }

  async getEligible(connection: OptionsConnection, now: string): Promise<OptionsCertificationEvidence | undefined> {
    const candidates = (await this.list(connection.connection_id)).filter((evidence) => (
      evidence.eligible_level === 'options-sandbox-entry-certified'
      && evidence.connection_checksum === connection.content_checksum
      && evidence.credential_generation === connection.credential_generation
      && evidence.adapter_id === connection.adapter_id
      && evidence.adapter_version === connection.adapter_version
      && evidence.provider_contract_version === connection.provider_contract_version
      && Date.parse(evidence.expires_at) > Date.parse(now)
    ))
    for (const evidence of candidates.sort((left, right) => right.completed_at.localeCompare(left.completed_at))) {
      if (await this.hasExactJournalBinding(evidence)) return evidence
    }
    return undefined
  }

  private async hasExactJournalBinding(evidence: OptionsCertificationEvidence): Promise<boolean> {
    const directory = path.join(this.root, 'options-certification-sessions', evidence.certification_session_id)
    let names: string[]
    try { names = (await readdir(directory)).filter((name) => /^\d{4}\.json$/.test(name)).sort() } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
    let prior: string | null = null
    let foundFinalFlat = false
    let foundCompletion = false
    for (const [index, name] of names.entries()) {
      const event = JSON.parse(await readFile(path.join(directory, name), 'utf8')) as Record<string, unknown>
      const checksum = typeof event.content_checksum === 'string' ? event.content_checksum : ''
      const { content_checksum: _checksum, ...unsigned } = event
      if (event.journal_schema_version !== 'options-certification-journal-event@1'
        || event.session_id !== evidence.certification_session_id
        || event.connection_id !== evidence.connection_id
        || event.sequence !== index + 1
        || event.previous_event_checksum !== prior
        || name !== `${String(index + 1).padStart(4, '0')}.json`
        || sha256(unsigned) !== checksum) return false
      if (checksum === evidence.journal_head_checksum
        && event.scenario === 'final-flat-zero-orders'
        && event.phase === 'completed') foundFinalFlat = true
      const payload = event.safe_payload as Record<string, unknown> | undefined
      if (foundFinalFlat
        && event.scenario === 'session'
        && event.phase === 'completed'
        && payload?.certification_id === evidence.certification_id
        && payload?.certification_checksum === evidence.content_checksum) foundCompletion = true
      prior = checksum
    }
    return foundFinalFlat && foundCompletion
  }
}

const verifyEvidence = (input: unknown): OptionsCertificationEvidence => {
  const evidence = optionsCertificationEvidenceSchema.parse(input)
  if (optionsCertificationChecksum(evidence) !== evidence.content_checksum) {
    throw new Error('Options certification evidence checksum is invalid.')
  }
  return evidence
}

const assertRunnerScope = (connection: OptionsConnection, runner: RestrictedOptionsCertificationRunner): void => {
  if (runner.connection_id !== connection.connection_id
    || runner.account_ref !== connection.account_ref
    || runner.provider !== connection.provider
    || runner.environment !== connection.environment
    || runner.adapter_id !== connection.adapter_id
    || runner.adapter_version !== connection.adapter_version
    || runner.provider_contract_version !== connection.provider_contract_version
    || !/^tgcert-[a-z0-9-]{1,16}$/.test(runner.client_order_prefix)) {
    throw new Error('Certification runner does not match the exact installed account and adapter.')
  }
}

const safeError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/[\r\n]+/g, ' ').slice(0, 300)
}
