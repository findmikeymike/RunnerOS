import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  OPTIONS_CERTIFICATION_APPLICATION_SCHEMA_VERSION,
  optionsCertificationApplicationSchema,
  optionsConnectionSchema,
  type OptionsCertificationApplication,
  type OptionsConnection,
} from '@trade-god/contracts'

import { canonicalJson, sha256 } from '../canonical.ts'
import { FileOptionsCertificationStore } from './options-certification.ts'

export class FileOptionsCertificationApplicationStore {
  private readonly directory: string
  private readonly certifications: FileOptionsCertificationStore

  constructor(private readonly root: string, private readonly now: () => string = () => new Date().toISOString()) {
    this.directory = path.join(root, 'options-certification-applications')
    this.certifications = new FileOptionsCertificationStore(root)
  }

  async apply(input: {
    connection: OptionsConnection
    certification_id: string
    operator_confirmed: true
  }): Promise<OptionsCertificationApplication> {
    const connection = verifyConnection(input.connection)
    if (input.operator_confirmed !== true) throw new Error('Applying a paper safety test requires explicit operator confirmation.')
    const timestamp = this.now()
    const certification = await this.certifications.getEligible(connection, timestamp)
    if (certification?.certification_id !== input.certification_id) {
      throw new Error('The exact current paper safety test is not eligible to apply.')
    }
    const unsigned = {
      application_schema_version: OPTIONS_CERTIFICATION_APPLICATION_SCHEMA_VERSION,
      application_id: `options-cert-application-${randomUUID()}`,
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
      applied_at: timestamp,
      operator_confirmed: true as const,
    }
    const application = optionsCertificationApplicationSchema.parse({ ...unsigned, content_checksum: sha256(unsigned) })
    const directory = path.join(this.directory, connection.connection_id)
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, `${application.application_id}.json`), `${canonicalJson(application)}\n`, {
      encoding: 'utf8', mode: 0o600, flag: 'wx',
    })
    return application
  }

  async getActive(connectionInput: OptionsConnection, at = this.now()): Promise<OptionsCertificationApplication | undefined> {
    const connection = verifyConnection(connectionInput)
    const eligible = await this.certifications.getEligible(connection, at)
    if (!eligible) return undefined
    const applications = await this.list(connection.connection_id)
    return applications
      .sort((left, right) => right.applied_at.localeCompare(left.applied_at))
      .find((application) => application.connection_checksum === connection.content_checksum
        && application.credential_generation === connection.credential_generation
        && application.certification_id === eligible.certification_id
        && application.certification_checksum === eligible.content_checksum
        && application.provider === connection.provider
        && application.environment === connection.environment
        && application.account_ref === connection.account_ref
        && application.adapter_id === connection.adapter_id
        && application.adapter_version === connection.adapter_version
        && application.provider_contract_version === connection.provider_contract_version
        && Date.parse(application.certification_expires_at) > Date.parse(at))
  }

  async list(connectionId: string): Promise<OptionsCertificationApplication[]> {
    const directory = path.join(this.directory, connectionId)
    let names: string[]
    try { names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort() } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    return Promise.all(names.map(async (name) => {
      const application = verifyApplication(JSON.parse(await readFile(path.join(directory, name), 'utf8')))
      if (application.connection_id !== connectionId || name !== `${application.application_id}.json`) {
        throw new Error('Options certification application filename does not match its identity.')
      }
      return application
    }))
  }
}

const verifyApplication = (input: unknown): OptionsCertificationApplication => {
  const value = optionsCertificationApplicationSchema.parse(input)
  const { content_checksum: _checksum, ...unsigned } = value
  if (sha256(unsigned) !== value.content_checksum) throw new Error('Options certification application checksum is invalid.')
  return value
}

const verifyConnection = (input: OptionsConnection): OptionsConnection => {
  const connection = optionsConnectionSchema.parse(input)
  const { content_checksum: _checksum, ...unsigned } = connection
  if (sha256(unsigned) !== connection.content_checksum) throw new Error('Options connection checksum is invalid.')
  return connection
}
