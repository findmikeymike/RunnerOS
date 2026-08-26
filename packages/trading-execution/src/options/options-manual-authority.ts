import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  OPTIONS_AUTHORITY_REVOCATION_SCHEMA_VERSION,
  OPTIONS_MANUAL_PAPER_AUTHORITY_SCHEMA_VERSION,
  optionsAuthorityRevocationSchema,
  optionsConnectionSchema,
  optionsManualPaperAuthoritySchema,
  type OptionsAuthorityRevocation,
  type OptionsCertificationEvidence,
  type OptionsConnection,
  type OptionsManualPaperAuthority,
} from '@trade-god/contracts'

import { canonicalJson, sha256 } from '../canonical.ts'
import { FixedDecimal } from './fixed-decimal.ts'
import { FileOptionsCertificationStore } from './options-certification.ts'

export interface ActivateManualPaperAuthorityInput {
  connection: OptionsConnection
  certification_id: string
  max_debit_per_order: string
  valid_until: string
  operator_confirmed: true
}

export class FileOptionsManualAuthorityStore {
  private readonly activationsDirectory: string
  private readonly revocationsDirectory: string
  private readonly locksDirectory: string
  private readonly certifications: FileOptionsCertificationStore

  constructor(private readonly root: string, private readonly now: () => string = () => new Date().toISOString()) {
    this.activationsDirectory = path.join(root, 'options-authorities', 'activations')
    this.revocationsDirectory = path.join(root, 'options-authorities', 'revocations')
    this.locksDirectory = path.join(root, 'options-authorities', 'locks')
    this.certifications = new FileOptionsCertificationStore(root)
  }

  async activate(input: ActivateManualPaperAuthorityInput): Promise<OptionsManualPaperAuthority> {
    const connection = verifyConnection(input.connection)
    const certification = (await this.certifications.list(connection.connection_id)).find((candidate) => candidate.certification_id === input.certification_id)
    if (!certification) throw new Error('Retained options certification was not found.')
    if (input.operator_confirmed !== true) throw new Error('Manual paper authority requires explicit operator confirmation.')
    this.assertCertification(connection, certification)
    const timestamp = this.now()
    if (Date.parse(certification.expires_at) <= Date.parse(timestamp)) throw new Error('Options certification is expired.')
    if (Date.parse(input.valid_until) <= Date.parse(timestamp) || Date.parse(input.valid_until) > Date.parse(certification.expires_at)) {
      throw new Error('Manual paper authority must expire before its certification.')
    }
    const maximumDebit = FixedDecimal.from(input.max_debit_per_order)
    if (maximumDebit.compare('0') <= 0 || maximumDebit.compare(certification.max_test_debit) > 0) {
      throw new Error('Manual paper debit cannot exceed the certified test debit.')
    }
    return this.withConnectionLock(connection.connection_id, async () => {
      if (await this.getActive(connection, timestamp)) throw new Error('This options account already has active manual paper authority.')
      const unsigned = {
      authority_schema_version: OPTIONS_MANUAL_PAPER_AUTHORITY_SCHEMA_VERSION,
      authority_id: `options-authority-${randomUUID()}`,
      connection_id: connection.connection_id,
      connection_checksum: connection.content_checksum,
      credential_generation: connection.credential_generation,
      certification_id: certification.certification_id,
      certification_checksum: certification.content_checksum,
      certification_expires_at: certification.expires_at,
      provider: connection.provider,
      environment: connection.environment,
      account_ref: connection.account_ref,
      adapter_id: connection.adapter_id,
      adapter_version: connection.adapter_version,
      provider_contract_version: connection.provider_contract_version,
      allowed_contract_id: certification.allowed_contract_id,
      allowed_provider_instrument_id: certification.allowed_provider_instrument_id,
      mode: 'manual-confirmed-paper' as const,
      max_contracts_per_order: 1 as const,
      max_debit_per_order: input.max_debit_per_order,
      valid_from: timestamp,
      valid_until: input.valid_until,
      operator_confirmed_at: timestamp,
      created_at: timestamp,
      }
      const authority = optionsManualPaperAuthoritySchema.parse({ ...unsigned, content_checksum: sha256(unsigned) })
      await this.writeImmutable(this.activationsDirectory, authority.connection_id, `${authority.authority_id}.json`, authority)
      return authority
    })
  }

  async revoke(
    authority: OptionsManualPaperAuthority,
    reason: OptionsAuthorityRevocation['reason'],
  ): Promise<OptionsAuthorityRevocation> {
    const verified = verifyAuthority(authority)
    return this.withConnectionLock(verified.connection_id, async () => {
      const existing = await this.listRevocations(verified.connection_id)
      const duplicate = existing.find((candidate) => candidate.authority_id === verified.authority_id)
      if (duplicate) return duplicate
      const unsigned = {
      revocation_schema_version: OPTIONS_AUTHORITY_REVOCATION_SCHEMA_VERSION,
      revocation_id: `options-revocation-${randomUUID()}`,
      authority_id: verified.authority_id,
      authority_checksum: verified.content_checksum,
      connection_id: verified.connection_id,
      reason,
      revoked_at: this.now(),
      }
      const revocation = optionsAuthorityRevocationSchema.parse({ ...unsigned, content_checksum: sha256(unsigned) })
      await this.writeImmutable(this.revocationsDirectory, revocation.connection_id, `${revocation.revocation_id}.json`, revocation)
      return revocation
    })
  }

  async getActive(connection: OptionsConnection, at = this.now()): Promise<OptionsManualPaperAuthority | undefined> {
    const verifiedConnection = verifyConnection(connection)
    const [authorities, revocations] = await Promise.all([
      this.listAuthorities(verifiedConnection.connection_id),
      this.listRevocations(verifiedConnection.connection_id),
    ])
    const revoked = new Set(revocations.map((item) => item.authority_id))
    const active = authorities.filter((authority) => (
      !revoked.has(authority.authority_id)
      && authority.connection_checksum === verifiedConnection.content_checksum
      && authority.credential_generation === verifiedConnection.credential_generation
      && authority.provider === verifiedConnection.provider
      && authority.environment === verifiedConnection.environment
      && authority.account_ref === verifiedConnection.account_ref
      && authority.adapter_id === verifiedConnection.adapter_id
      && authority.adapter_version === verifiedConnection.adapter_version
      && authority.provider_contract_version === verifiedConnection.provider_contract_version
      && Date.parse(authority.valid_from) <= Date.parse(at)
      && Date.parse(authority.valid_until) > Date.parse(at)
      && Date.parse(authority.certification_expires_at) > Date.parse(at)
    ))
    if (active.length > 1) throw new Error('Multiple active options authorities violate the account boundary.')
    return active[0]
  }

  async revokeForConnection(connectionId: string, reason: OptionsAuthorityRevocation['reason']): Promise<number> {
    const authorities = await this.listAuthorities(connectionId)
    const revocations = await this.listRevocations(connectionId)
    const revoked = new Set(revocations.map((item) => item.authority_id))
    let count = 0
    for (const authority of authorities) {
      if (!revoked.has(authority.authority_id)) {
        await this.revoke(authority, reason)
        count += 1
      }
    }
    return count
  }

  async recoverStaleLocks(singleInstanceAuthority: boolean): Promise<number> {
    if (!singleInstanceAuthority) throw new Error('Options authority lock recovery requires app single-instance authority.')
    await mkdir(this.locksDirectory, { recursive: true })
    const names = (await readdir(this.locksDirectory)).filter((name) => name.endsWith('.lock'))
    await Promise.all(names.map((name) => unlink(path.join(this.locksDirectory, name))))
    return names.length
  }

  private assertCertification(connection: OptionsConnection, certification: OptionsCertificationEvidence): void {
    if (certification.eligible_level !== 'options-sandbox-entry-certified'
      || certification.connection_id !== connection.connection_id
      || certification.connection_checksum !== connection.content_checksum
      || certification.credential_generation !== connection.credential_generation
      || certification.provider !== connection.provider
      || certification.environment !== connection.environment
      || certification.account_ref !== connection.account_ref
      || certification.adapter_id !== connection.adapter_id
      || certification.adapter_version !== connection.adapter_version
      || certification.provider_contract_version !== connection.provider_contract_version) {
      throw new Error('Certification does not bind the exact current options account and adapter.')
    }
  }

  private listAuthorities(connectionId: string): Promise<OptionsManualPaperAuthority[]> {
    return this.listDirectory(this.activationsDirectory, connectionId, verifyAuthority, (value) => `${value.authority_id}.json`)
  }

  private listRevocations(connectionId: string): Promise<OptionsAuthorityRevocation[]> {
    return this.listDirectory(this.revocationsDirectory, connectionId, verifyRevocation, (value) => `${value.revocation_id}.json`)
  }

  private async listDirectory<T extends { connection_id: string }>(
    directory: string,
    connectionId: string,
    verify: (value: unknown) => T,
    filename: (value: T) => string,
  ): Promise<T[]> {
    const target = path.join(directory, connectionId)
    let names: string[]
    try { names = await readdir(target) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    return Promise.all(names.filter((name) => name.endsWith('.json')).sort().map(async (name) => {
      const value = verify(JSON.parse(await readFile(path.join(target, name), 'utf8')))
      if (value.connection_id !== connectionId || filename(value) !== name) throw new Error('Options authority file identity is invalid.')
      return value
    }))
  }

  private async writeImmutable(directory: string, connectionId: string, filename: string, value: unknown): Promise<void> {
    const target = path.join(directory, connectionId)
    await mkdir(target, { recursive: true })
    await writeFile(path.join(target, filename), `${canonicalJson(value)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  }

  private async withConnectionLock<T>(connectionId: string, task: () => Promise<T>): Promise<T> {
    await mkdir(this.locksDirectory, { recursive: true })
    const lock = path.join(this.locksDirectory, `${connectionId}.lock`)
    try {
      await writeFile(lock, `${process.pid}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Options authority is already being changed for this account.')
      throw error
    }
    try { return await task() } finally { await unlink(lock).catch(() => undefined) }
  }
}

const verifyConnection = (input: unknown): OptionsConnection => {
  const connection = optionsConnectionSchema.parse(input)
  const { content_checksum: _checksum, ...unsigned } = connection
  if (sha256(unsigned) !== connection.content_checksum) throw new Error('Options connection checksum is invalid.')
  return connection
}
const verifyAuthority = (input: unknown): OptionsManualPaperAuthority => {
  const authority = optionsManualPaperAuthoritySchema.parse(input)
  const { content_checksum: _checksum, ...unsigned } = authority
  if (sha256(unsigned) !== authority.content_checksum) throw new Error('Options authority checksum is invalid.')
  return authority
}
const verifyRevocation = (input: unknown): OptionsAuthorityRevocation => {
  const revocation = optionsAuthorityRevocationSchema.parse(input)
  const { content_checksum: _checksum, ...unsigned } = revocation
  if (sha256(unsigned) !== revocation.content_checksum) throw new Error('Options authority revocation checksum is invalid.')
  return revocation
}
