import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  OPTIONS_AUTOPILOT_CERTIFICATION_SCHEMA_VERSION,
  optionsAutopilotCertificationEvidenceSchema,
  optionsAutopilotCertificationScenarioSchema,
  optionsCertificationApplicationSchema,
  optionsConnectionSchema,
  type OptionsAutopilotCertificationEvidence,
  type OptionsAutopilotCertificationScenario,
  type OptionsCertificationApplication,
  type OptionsConnection,
} from '@trade-god/contracts'

import { canonicalJson, sha256 } from '../canonical.ts'

type AutopilotJournalEvent = {
  journal_schema_version: 'options-autopilot-certification-journal-event@1'
  session_id: string
  sequence: number
  connection_id: string
  kind: 'session' | 'scenario' | 'lifecycle' | 'custody' | 'final-truth'
  evidence_payload: unknown
  evidence_checksum: string
  previous_event_checksum: string | null
  observed_at: string
  content_checksum: string
}

export class FileOptionsAutopilotCertificationJournal {
  private readonly directory: string
  constructor(root: string, readonly session_id: string, private readonly connectionId: string) {
    this.directory = path.join(root, 'options-autopilot-certification-sessions', session_id)
  }

  async append(kind: AutopilotJournalEvent['kind'], evidence: unknown, observedAt: string): Promise<AutopilotJournalEvent> {
    const prior = await this.list()
    const unsigned = {
      journal_schema_version: 'options-autopilot-certification-journal-event@1' as const,
      session_id: this.session_id, sequence: prior.length + 1, connection_id: this.connectionId,
      kind, evidence_payload: evidence, evidence_checksum: sha256(evidence), previous_event_checksum: prior.at(-1)?.content_checksum ?? null,
      observed_at: observedAt,
    }
    const event = { ...unsigned, content_checksum: sha256(unsigned) }
    await mkdir(this.directory, { recursive: true })
    await writeFile(path.join(this.directory, `${String(event.sequence).padStart(4, '0')}.json`), `${canonicalJson(event)}\n`, {
      encoding: 'utf8', mode: 0o600, flag: 'wx',
    })
    return event
  }

  async list(): Promise<AutopilotJournalEvent[]> {
    let names: string[]
    try { names = (await readdir(this.directory)).filter((name) => /^\d{4}\.json$/.test(name)).sort() } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const events: AutopilotJournalEvent[] = []
    for (const [index, name] of names.entries()) {
      const event = JSON.parse(await readFile(path.join(this.directory, name), 'utf8')) as AutopilotJournalEvent
      const { content_checksum: _checksum, ...unsigned } = event
      if (event.journal_schema_version !== 'options-autopilot-certification-journal-event@1'
        || event.session_id !== this.session_id || event.connection_id !== this.connectionId
        || event.sequence !== index + 1 || name !== `${String(event.sequence).padStart(4, '0')}.json`
        || event.previous_event_checksum !== (events.at(-1)?.content_checksum ?? null)
        || sha256(unsigned) !== event.content_checksum) throw new Error('Options autopilot certification journal integrity is invalid.')
      events.push(event)
    }
    return events
  }

  async headChecksum(): Promise<string> {
    const head = (await this.list()).at(-1)
    if (!head) throw new Error('Options autopilot certification journal is empty.')
    return head.content_checksum
  }
}

export interface RestrictedOptionsAutopilotCertificationRunner {
  readonly certification_session_id: string
  readonly connection_id: string
  runScenario(scenario: OptionsAutopilotCertificationScenario): Promise<{ status: 'pass' | 'fail' | 'blocked'; detail: string; evidence: unknown }>
  cleanLifecycles(): Promise<Array<{ lifecycle_id: string; completed_at: string; evidence: unknown }>>
  custodyTruth(): Promise<{
    provider_automatic_close_certified: boolean
    provider_do_not_exercise_certified: boolean
    provider_calendar_evidence: unknown
    account_exercise_setting_evidence: unknown
    custody_certification_evidence: unknown
  }>
  finalTruth(): Promise<{ position_quantity: number; working_order_count: number; evidence: unknown }>
}

export async function runRestrictedOptionsAutopilotCertification(input: {
  connection: OptionsConnection
  base_application: OptionsCertificationApplication
  expires_at: string
}, runner: RestrictedOptionsAutopilotCertificationRunner, journal: FileOptionsAutopilotCertificationJournal,
now: () => string = () => new Date().toISOString()): Promise<OptionsAutopilotCertificationEvidence> {
  const connection = optionsConnectionSchema.parse(input.connection)
  const application = optionsCertificationApplicationSchema.parse(input.base_application)
  const { content_checksum: _connectionChecksum, ...unsignedConnection } = connection
  const { content_checksum: _applicationChecksum, ...unsignedApplication } = application
  if (sha256(unsignedConnection) !== connection.content_checksum || sha256(unsignedApplication) !== application.content_checksum) {
    throw new Error('Autopilot certification input checksum is invalid.')
  }
  if (runner.connection_id !== connection.connection_id || journal.session_id !== runner.certification_session_id) {
    throw new Error('Autopilot runner does not bind the exact account and session.')
  }
  if (application.connection_id !== connection.connection_id
    || application.connection_checksum !== connection.content_checksum
    || application.credential_generation !== connection.credential_generation) {
    throw new Error('Autopilot certification requires the exact applied account safety test.')
  }
  const startedAt = now()
  if (Date.parse(input.expires_at) <= Date.parse(startedAt)
    || Date.parse(input.expires_at) > Date.parse(application.certification_expires_at)) {
    throw new Error('Autopilot certification expiry must stay inside the applied account test.')
  }
  if ((await journal.list()).length !== 0) throw new Error('Autopilot certification requires a new empty retained journal.')
  await journal.append('session', { connection_checksum: connection.content_checksum,
    application_checksum: application.content_checksum, expires_at: input.expires_at }, startedAt)
  const scenarios = []
  for (const scenario of optionsAutopilotCertificationScenarioSchema.options) {
    let observation: Awaited<ReturnType<RestrictedOptionsAutopilotCertificationRunner['runScenario']>>
    try { observation = await runner.runScenario(scenario) } catch (error) {
      observation = { status: 'fail', detail: error instanceof Error ? error.message.slice(0, 300) : 'Scenario failed.', evidence: { scenario, failed: true } }
    }
    if (!observation.detail.trim() || observation.detail.length > 300) throw new Error(`Autopilot scenario returned invalid detail for ${scenario}.`)
    const observedAt = now()
    scenarios.push({ scenario, status: observation.status, detail: observation.detail,
      evidence_checksum: sha256(observation.evidence), observed_at: observedAt })
    await journal.append('scenario', { scenario, ...observation }, observedAt)
  }
  const lifecycles = await runner.cleanLifecycles()
  const uniqueLifecycleIds = new Set(lifecycles.map((item) => item.lifecycle_id))
  if (uniqueLifecycleIds.size !== lifecycles.length) throw new Error('Autopilot lifecycle evidence contains duplicate identities.')
  for (const lifecycle of lifecycles) await journal.append('lifecycle', lifecycle, lifecycle.completed_at)
  const custody = await runner.custodyTruth()
  await journal.append('custody', custody, now())
  const finalTruth = await runner.finalTruth()
  await journal.append('final-truth', finalTruth, now())
  const allPassed = scenarios.every((item) => item.status === 'pass') && lifecycles.length >= 50
    && custody.provider_automatic_close_certified && custody.provider_do_not_exercise_certified
    && finalTruth.position_quantity === 0 && finalTruth.working_order_count === 0
  const unsigned = {
    certification_schema_version: OPTIONS_AUTOPILOT_CERTIFICATION_SCHEMA_VERSION,
    certification_id: `options-autopilot-cert-${randomUUID()}`,
    certification_session_id: runner.certification_session_id,
    journal_head_checksum: await journal.headChecksum(),
    connection_id: connection.connection_id, connection_checksum: connection.content_checksum,
    credential_generation: connection.credential_generation, provider: connection.provider,
    environment: connection.environment, account_id: connection.account_ref,
    adapter_id: connection.adapter_id, adapter_version: connection.adapter_version,
    provider_contract_version: connection.provider_contract_version,
    base_certification_id: application.certification_id,
    base_certification_checksum: application.certification_checksum,
    base_application_id: application.application_id,
    base_application_checksum: application.content_checksum,
    started_at: startedAt, completed_at: now(), expires_at: input.expires_at,
    scenarios, completed_lifecycle_count: lifecycles.length,
    lifecycle_evidence: lifecycles.map((item) => ({ lifecycle_id: item.lifecycle_id,
      evidence_checksum: sha256(item.evidence), completed_at: item.completed_at })),
    provider_automatic_close_certified: custody.provider_automatic_close_certified,
    provider_do_not_exercise_certified: custody.provider_do_not_exercise_certified,
    provider_calendar_checksum: sha256(custody.provider_calendar_evidence),
    account_exercise_setting_checksum: sha256(custody.account_exercise_setting_evidence),
    custody_certification_checksum: sha256(custody.custody_certification_evidence),
    final_position_quantity: finalTruth.position_quantity, final_working_order_count: finalTruth.working_order_count,
    eligible_level: allPassed ? 'options-paper-autopilot-certified' as const : null,
  }
  return optionsAutopilotCertificationEvidenceSchema.parse({ ...unsigned, content_checksum: sha256(unsigned) })
}
