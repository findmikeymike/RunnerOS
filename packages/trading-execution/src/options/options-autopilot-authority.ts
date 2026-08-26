import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  OPTIONS_AUTOPILOT_AUTHORITY_SCHEMA_VERSION,
  OPTIONS_AUTOPILOT_CERTIFICATION_SCHEMA_VERSION,
  OPTIONS_AUTOPILOT_REVOCATION_SCHEMA_VERSION,
  optionsAutopilotAuthoritySchema,
  optionsAutopilotCertificationEvidenceSchema,
  optionsAutopilotRevocationSchema,
  optionsAutomationRouteSchema,
  optionsCertificationApplicationSchema,
  optionsConnectionSchema,
  optionsEntryPolicySchema,
  type OptionsAutopilotAuthority,
  type OptionsAutopilotCertificationEvidence,
  type OptionsAutopilotRevocation,
  type OptionsAutomationRoute,
  type OptionsCertificationApplication,
  type OptionsConnection,
  type OptionsEntryPolicy,
} from '@trade-god/contracts'

import { canonicalJson, sha256 } from '../canonical.ts'
import { FileOptionsAutopilotCertificationJournal } from './options-autopilot-certification.ts'

export class FileOptionsAutopilotCertificationStore {
  private readonly directory: string
  constructor(private readonly root: string) { this.directory = path.join(root, 'options-automation', 'certifications') }

  async save(input: OptionsAutopilotCertificationEvidence): Promise<OptionsAutopilotCertificationEvidence> {
    const evidence = verify(input, optionsAutopilotCertificationEvidenceSchema, 'Options autopilot certification')
    if (!await this.hasExactJournal(evidence)) {
      throw new Error('Options autopilot certification is missing its exact retained provider journal.')
    }
    await writeImmutable(this.directory, `${sha256(evidence.certification_id)}.json`, evidence)
    return evidence
  }

  async getEligible(connection: OptionsConnection, at: string): Promise<OptionsAutopilotCertificationEvidence | undefined> {
    const exact = verify(connection, optionsConnectionSchema, 'Options connection')
    const candidates = await this.listCurrentEvidence()
    const eligible = candidates.filter((evidence) => evidence.eligible_level === 'options-paper-autopilot-certified'
      && evidence.connection_id === exact.connection_id
      && evidence.connection_checksum === exact.content_checksum
      && evidence.credential_generation === exact.credential_generation
      && evidence.provider === exact.provider
      && evidence.environment === exact.environment
      && evidence.account_id === exact.account_ref
      && evidence.adapter_id === exact.adapter_id
      && evidence.adapter_version === exact.adapter_version
      && evidence.provider_contract_version === exact.provider_contract_version
      && Date.parse(evidence.expires_at) > Date.parse(at))
    const journalBound = []
    for (const evidence of eligible) {
      if (await this.hasExactJournal(evidence)) journalBound.push(evidence)
    }
    if (journalBound.length > 1) throw new Error('Multiple active options autopilot certifications violate exact authority.')
    return journalBound[0]
  }

  private async hasExactJournal(evidence: OptionsAutopilotCertificationEvidence): Promise<boolean> {
    try {
      const journal = new FileOptionsAutopilotCertificationJournal(this.root, evidence.certification_session_id, evidence.connection_id)
      const events = await journal.list()
      const expectedKinds = ['session',
        ...Array.from({ length: evidence.scenarios.length }, () => 'scenario'),
        ...Array.from({ length: evidence.completed_lifecycle_count }, () => 'lifecycle'),
        'custody', 'final-truth']
      if (!(events.at(-1)?.content_checksum === evidence.journal_head_checksum
        && events.length === expectedKinds.length
        && events.every((event, index) => event.kind === expectedKinds[index]))) return false
      const session = asRecord(events[0]?.evidence_payload)
      if (session.connection_checksum !== evidence.connection_checksum
        || session.application_checksum !== evidence.base_application_checksum
        || session.expires_at !== evidence.expires_at) return false
      let cursor = 1
      for (const scenario of evidence.scenarios) {
        const payload = asRecord(events[cursor]?.evidence_payload); cursor += 1
        if (payload.scenario !== scenario.scenario || payload.status !== scenario.status || payload.detail !== scenario.detail
          || sha256(payload.evidence) !== scenario.evidence_checksum
          || events[cursor - 1]?.observed_at !== scenario.observed_at) return false
      }
      for (const lifecycle of evidence.lifecycle_evidence) {
        const payload = asRecord(events[cursor]?.evidence_payload); cursor += 1
        if (payload.lifecycle_id !== lifecycle.lifecycle_id || payload.completed_at !== lifecycle.completed_at
          || sha256(payload.evidence) !== lifecycle.evidence_checksum) return false
      }
      const custody = asRecord(events[cursor]?.evidence_payload); cursor += 1
      if (custody.provider_automatic_close_certified !== evidence.provider_automatic_close_certified
        || custody.provider_do_not_exercise_certified !== evidence.provider_do_not_exercise_certified
        || sha256(custody.provider_calendar_evidence) !== evidence.provider_calendar_checksum
        || sha256(custody.account_exercise_setting_evidence) !== evidence.account_exercise_setting_checksum
        || sha256(custody.custody_certification_evidence) !== evidence.custody_certification_checksum) return false
      const finalTruth = asRecord(events[cursor]?.evidence_payload)
      return finalTruth.position_quantity === evidence.final_position_quantity
        && finalTruth.working_order_count === evidence.final_working_order_count
    } catch { return false }
  }

  private async listCurrentEvidence(): Promise<OptionsAutopilotCertificationEvidence[]> {
    let names: string[]
    try { names = (await readdir(this.directory)).filter((name) => name.endsWith('.json')).sort() } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const evidence: OptionsAutopilotCertificationEvidence[] = []
    for (const name of names) {
      const raw = JSON.parse(await readFile(path.join(this.directory, name), 'utf8')) as Record<string, unknown>
      if (raw.certification_schema_version !== OPTIONS_AUTOPILOT_CERTIFICATION_SCHEMA_VERSION) continue
      const exact = verify(raw, optionsAutopilotCertificationEvidenceSchema, 'Options autopilot certification')
      if (name !== `${sha256(exact.certification_id)}.json`) throw new Error('Options autopilot certification filename identity is invalid.')
      evidence.push(exact)
    }
    return evidence
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Certification journal payload is invalid.')
  return value as Record<string, unknown>
}

export class FileOptionsAutopilotAuthorityStore {
  private readonly activations: string
  private readonly revocations: string
  private readonly locks: string
  private readonly certifications: FileOptionsAutopilotCertificationStore

  constructor(root: string, private readonly now: () => string = () => new Date().toISOString()) {
    this.activations = path.join(root, 'options-automation', 'authorities')
    this.revocations = path.join(root, 'options-automation', 'revocations')
    this.locks = path.join(root, 'options-automation', 'authority-locks')
    this.certifications = new FileOptionsAutopilotCertificationStore(root)
  }

  async activate(input: {
    route: OptionsAutomationRoute
    policy: OptionsEntryPolicy
    connection: OptionsConnection
    base_application: OptionsCertificationApplication
    valid_until: string
    operator_confirmed: true
  }): Promise<OptionsAutopilotAuthority> {
    const route = verify(input.route, optionsAutomationRouteSchema, 'Options route')
    const policy = verify(input.policy, optionsEntryPolicySchema, 'Options policy')
    const connection = verify(input.connection, optionsConnectionSchema, 'Options connection')
    const application = verify(input.base_application, optionsCertificationApplicationSchema, 'Options certification application')
    const timestamp = this.now()
    const certification = await this.certifications.getEligible(connection, timestamp)
    if (!certification) throw new Error('Exact options autopilot certification is unavailable.')
    if (route.state !== 'paused') throw new Error('Finish and pause the exact options route before activation review.')
    if (input.operator_confirmed !== true) throw new Error('Automatic paper authority requires explicit confirmation.')
    if (route.policy_id !== policy.policy_id || route.policy_revision !== policy.revision || route.policy_checksum !== policy.content_checksum
      || route.connection_id !== connection.connection_id || route.connection_checksum !== connection.content_checksum
      || route.account_id !== connection.account_ref || route.provider !== connection.provider || route.environment !== connection.environment
      || policy.source_route_id !== route.route_id || policy.connection_id !== connection.connection_id
      || policy.account_id !== connection.account_ref || policy.certification_checksum !== certification.content_checksum
      || policy.required_certification !== 'options-paper-autopilot-certified'
      || application.connection_id !== connection.connection_id || application.connection_checksum !== connection.content_checksum
      || certification.base_application_id !== application.application_id
      || certification.base_application_checksum !== application.content_checksum
      || certification.base_certification_id !== application.certification_id
      || certification.base_certification_checksum !== application.certification_checksum) {
      throw new Error('Options autopilot authority evidence does not bind one exact route, policy, account, and certification.')
    }
    const expiry = Math.min(Date.parse(input.valid_until), Date.parse(policy.mandate_expires_at), Date.parse(certification.expires_at))
    if (!Number.isFinite(expiry) || expiry !== Date.parse(input.valid_until) || expiry <= Date.parse(timestamp)) {
      throw new Error('Options autopilot authority must expire inside policy and certification limits.')
    }
    return this.withRouteLock(route.route_id, async () => {
      if (await this.getAnyActiveForRoute(route.route_id, connection.connection_id, timestamp)) {
        throw new Error('This options route already has active automatic authority; revoke it before changing revisions.')
      }
      const unsigned = {
      authority_schema_version: OPTIONS_AUTOPILOT_AUTHORITY_SCHEMA_VERSION,
      authority_id: `options-autopilot-${randomUUID()}`, route_id: route.route_id, route_revision: route.revision,
      route_checksum: route.content_checksum, policy_id: policy.policy_id, policy_revision: policy.revision,
      policy_checksum: policy.content_checksum, connection_id: connection.connection_id,
      connection_checksum: connection.content_checksum, credential_generation: connection.credential_generation,
      provider: connection.provider, environment: connection.environment, account_id: connection.account_ref,
      adapter_id: connection.adapter_id, adapter_version: connection.adapter_version,
      provider_contract_version: connection.provider_contract_version, certification_id: certification.certification_id,
      certification_checksum: certification.content_checksum, certification_level: 'options-paper-autopilot-certified' as const,
      certification_expires_at: certification.expires_at, certification_application_id: application.application_id,
      certification_application_checksum: application.content_checksum, mode: 'automatic-paper' as const,
      valid_from: timestamp, valid_until: input.valid_until, operator_confirmed_at: timestamp, created_at: timestamp,
      }
      const authority = optionsAutopilotAuthoritySchema.parse({ ...unsigned, content_checksum: sha256(unsigned) })
      await writeImmutable(this.activations, `${sha256(authority.authority_id)}.json`, authority)
      return authority
    })
  }

  async getActive(route: OptionsAutomationRoute, policy: OptionsEntryPolicy, connection: OptionsConnection, at = this.now()): Promise<OptionsAutopilotAuthority | undefined> {
    const authorities = await listVerified(this.activations, optionsAutopilotAuthoritySchema, 'Options autopilot authority')
    const revocations = await listVerified(this.revocations, optionsAutopilotRevocationSchema, 'Options autopilot revocation')
    const revoked = new Set(revocations.map((item) => item.authority_id))
    const active = authorities.filter((authority) => !revoked.has(authority.authority_id)
      && authority.route_id === route.route_id && authority.route_revision === route.revision && authority.route_checksum === route.content_checksum
      && authority.policy_id === policy.policy_id && authority.policy_revision === policy.revision && authority.policy_checksum === policy.content_checksum
      && authority.connection_id === connection.connection_id && authority.connection_checksum === connection.content_checksum
      && authority.credential_generation === connection.credential_generation
      && Date.parse(authority.valid_from) <= Date.parse(at) && Date.parse(authority.valid_until) > Date.parse(at)
      && Date.parse(authority.certification_expires_at) > Date.parse(at))
    if (active.length > 1) throw new Error('Multiple active automatic authorities violate exact options route authority.')
    return active[0]
  }

  async revoke(authority: OptionsAutopilotAuthority, reason: OptionsAutopilotRevocation['reason']): Promise<OptionsAutopilotRevocation> {
    const exact = verify(authority, optionsAutopilotAuthoritySchema, 'Options autopilot authority')
    return this.withRouteLock(exact.route_id, async () => {
      const existing = (await listVerified(this.revocations, optionsAutopilotRevocationSchema, 'Options autopilot revocation'))
        .find((item) => item.authority_id === exact.authority_id)
      if (existing) return existing
      const unsigned = {
        revocation_schema_version: OPTIONS_AUTOPILOT_REVOCATION_SCHEMA_VERSION,
        revocation_id: `options-autopilot-revocation-${randomUUID()}`, authority_id: exact.authority_id,
        authority_checksum: exact.content_checksum, route_id: exact.route_id, connection_id: exact.connection_id,
        reason, revoked_at: this.now(),
      }
      const revocation = optionsAutopilotRevocationSchema.parse({ ...unsigned, content_checksum: sha256(unsigned) })
      await writeImmutable(this.revocations, `${sha256(revocation.revocation_id)}.json`, revocation)
      return revocation
    })
  }

  async recoverStaleLocks(singleInstanceAuthority: boolean): Promise<number> {
    if (!singleInstanceAuthority) throw new Error('Options autopilot authority recovery requires app single-instance authority.')
    await mkdir(this.locks, { recursive: true })
    const names = (await readdir(this.locks)).filter((name) => name.endsWith('.lock'))
    await Promise.all(names.map((name) => unlink(path.join(this.locks, name))))
    return names.length
  }

  private async getAnyActiveForRoute(routeId: string, connectionId: string, at: string): Promise<OptionsAutopilotAuthority | undefined> {
    const authorities = await listVerified(this.activations, optionsAutopilotAuthoritySchema, 'Options autopilot authority')
    const revocations = await listVerified(this.revocations, optionsAutopilotRevocationSchema, 'Options autopilot revocation')
    const revoked = new Set(revocations.map((item) => item.authority_id))
    const active = authorities.filter((authority) => !revoked.has(authority.authority_id)
      && authority.route_id === routeId && authority.connection_id === connectionId
      && Date.parse(authority.valid_from) <= Date.parse(at) && Date.parse(authority.valid_until) > Date.parse(at)
      && Date.parse(authority.certification_expires_at) > Date.parse(at))
    if (active.length > 1) throw new Error('Multiple active automatic authorities violate exact options route authority.')
    return active[0]
  }

  private async withRouteLock<T>(routeId: string, operation: () => Promise<T>): Promise<T> {
    await mkdir(this.locks, { recursive: true })
    const lock = path.join(this.locks, `${sha256(routeId)}.lock`)
    try {
      await writeFile(lock, `${process.pid}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('This options route authority is already being changed.')
      throw error
    }
    try { return await operation() } finally { await unlink(lock).catch(() => undefined) }
  }
}

async function writeImmutable(directory: string, filename: string, value: unknown): Promise<void> {
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, filename), `${canonicalJson(value)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
}

async function listVerified<T extends { content_checksum: string }>(directory: string, schema: { parse(value: unknown): T }, label: string): Promise<T[]> {
  let names: string[]
  try { names = await readdir(directory) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return Promise.all(names.filter((name) => name.endsWith('.json')).sort().map(async (name) => verify(JSON.parse(await readFile(path.join(directory, name), 'utf8')), schema, label)))
}

function verify<T extends { content_checksum: string }>(input: unknown, schema: { parse(value: unknown): T }, label: string): T {
  const value = schema.parse(input)
  const { content_checksum: _checksum, ...unsigned } = value
  if (sha256(unsigned) !== value.content_checksum) throw new Error(`${label} checksum is invalid.`)
  return value
}
