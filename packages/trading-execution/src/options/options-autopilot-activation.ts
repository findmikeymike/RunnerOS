import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  optionsAutomationRouteSchema,
  optionsAutopilotAuthoritySchema,
  optionsEntryPolicySchema,
  type OptionsAutopilotAuthority,
  type OptionsAutomationRoute,
  type OptionsCertificationApplication,
  type OptionsConnection,
  type OptionsEntryPolicy,
} from '@trade-god/contracts'

import { canonicalJson, sha256 } from '../canonical.ts'
import { FileOptionsCertificationApplicationStore } from './options-certification-application.ts'
import { FileOptionsAutomationStore } from './options-automation-store.ts'
import { FileOptionsAutopilotAuthorityStore, FileOptionsAutopilotCertificationStore } from './options-autopilot-authority.ts'

export type OptionsAutopilotActivationReview = {
  review_schema_version: 'options-autopilot-activation-review@1'
  review_id: string
  route_id: string
  current_route_revision: number
  current_route_checksum: string
  connection_id: string
  connection_checksum: string
  base_application_id: string
  base_application_checksum: string
  certification_id: string
  certification_checksum: string
  next_policy: OptionsEntryPolicy
  next_route: OptionsAutomationRoute
  valid_until: string
  prepared_at: string
  expires_at: string
  content_checksum: string
}

export class OptionsAutopilotActivationService {
  private readonly reviewDirectory: string

  constructor(
    root: string,
    private readonly automation: FileOptionsAutomationStore,
    private readonly authorities: FileOptionsAutopilotAuthorityStore,
    private readonly certifications: FileOptionsAutopilotCertificationStore,
    private readonly applications: FileOptionsCertificationApplicationStore,
    private readonly resolveConnection: (connectionId: string) => Promise<OptionsConnection>,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.reviewDirectory = path.join(root, 'options-automation', 'activation-reviews')
  }

  async prepare(routeId: string, validUntil: string): Promise<OptionsAutopilotActivationReview> {
    const current = await this.automation.getRoute(routeId)
    if (current.state === 'archived') throw new Error('Removed Discord sources cannot be activated.')
    const connection = await this.resolveConnection(current.connection_id)
    const timestamp = this.now()
    const certification = await this.certifications.getEligible(connection, timestamp)
    const application = await this.applications.getActive(connection, timestamp)
    if (!certification) throw new Error('Automatic paper trading still needs its full broker safety test.')
    if (!application) throw new Error('Apply the current account safety test before enabling automation.')
    if (certification.base_application_id !== application.application_id
      || certification.base_application_checksum !== application.content_checksum) {
      throw new Error('Automatic safety evidence does not match the currently applied account test.')
    }
    const expiry = Date.parse(validUntil)
    if (!Number.isFinite(expiry) || expiry <= Date.parse(timestamp) || expiry > Date.parse(certification.expires_at)) {
      throw new Error('Choose an automation end time inside the current safety-test window.')
    }
    const currentPolicy = await this.automation.getPolicy(current.policy_id, current.policy_revision)
    if (await this.authorities.getActive(current, currentPolicy, connection, timestamp)) {
      throw new Error('This Discord source is already running.')
    }
    const revision = current.revision + 1
    const policyBody = {
      ...currentPolicy,
      revision,
      certification_checksum: certification.content_checksum,
      mandate_expires_at: validUntil,
      expiration_custody: {
        ...currentPolicy.expiration_custody,
        provider_calendar_checksum: certification.provider_calendar_checksum,
        account_exercise_setting_checksum: certification.account_exercise_setting_checksum,
        custody_certification_checksum: certification.custody_certification_checksum,
      },
      created_at: timestamp,
      content_checksum: undefined,
    }
    delete (policyBody as { content_checksum?: string }).content_checksum
    const nextPolicy = optionsEntryPolicySchema.parse({ ...policyBody, content_checksum: sha256(policyBody) })
    const routeBody = {
      ...current,
      revision,
      connection_checksum: connection.content_checksum,
      policy_revision: nextPolicy.revision,
      policy_checksum: nextPolicy.content_checksum,
      state: 'paused' as const,
      updated_at: timestamp,
      content_checksum: undefined,
    }
    delete (routeBody as { content_checksum?: string }).content_checksum
    const nextRoute = optionsAutomationRouteSchema.parse({ ...routeBody, content_checksum: sha256(routeBody) })
    const unsigned = {
      review_schema_version: 'options-autopilot-activation-review@1' as const,
      review_id: `options-autopilot-review-${randomUUID()}`,
      route_id: current.route_id,
      current_route_revision: current.revision,
      current_route_checksum: current.content_checksum,
      connection_id: connection.connection_id,
      connection_checksum: connection.content_checksum,
      base_application_id: application.application_id,
      base_application_checksum: application.content_checksum,
      certification_id: certification.certification_id,
      certification_checksum: certification.content_checksum,
      next_policy: nextPolicy,
      next_route: nextRoute,
      valid_until: validUntil,
      prepared_at: timestamp,
      expires_at: new Date(Date.parse(timestamp) + 2 * 60_000).toISOString(),
    }
    const review = { ...unsigned, content_checksum: sha256(unsigned) }
    await mkdir(this.reviewDirectory, { recursive: true })
    await writeFile(this.reviewPath(review.review_id), `${canonicalJson(review)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    return review
  }

  async commit(reviewId: string, reviewChecksum: string, operatorConfirmed: true): Promise<OptionsAutopilotAuthority> {
    if (operatorConfirmed !== true) throw new Error('Starting automatic paper trading requires explicit confirmation.')
    const review = await this.readReview(reviewId)
    if (review.content_checksum !== reviewChecksum) throw new Error('The automation review changed. Review it again.')
    if (Date.parse(review.expires_at) <= Date.parse(this.now())) throw new Error('The automation review expired. Review it again.')
    const connection = await this.resolveConnection(review.connection_id)
    if (connection.content_checksum !== review.connection_checksum) throw new Error('The broker account changed. Review automation again.')
    const certification = await this.certifications.getEligible(connection, this.now())
    const application = await this.applications.getActive(connection, this.now())
    if (certification?.certification_id !== review.certification_id || certification.content_checksum !== review.certification_checksum
      || application?.application_id !== review.base_application_id || application.content_checksum !== review.base_application_checksum) {
      throw new Error('The account safety evidence changed. Review automation again.')
    }
    const current = await this.automation.getRoute(review.route_id)
    const alreadyApplied = current.revision === review.next_route.revision
      && current.content_checksum === review.next_route.content_checksum
    if (!alreadyApplied && (current.revision !== review.current_route_revision
      || current.content_checksum !== review.current_route_checksum)) {
      throw new Error('The Discord source changed. Review automation again.')
    }
    if (!alreadyApplied) {
      await this.automation.savePolicy(review.next_policy)
      await this.automation.saveRoute(review.next_route)
    }
    const active = await this.authorities.getActive(review.next_route, review.next_policy, connection, this.now())
    if (active) return optionsAutopilotAuthoritySchema.parse(active)
    return this.authorities.activate({
      route: review.next_route,
      policy: review.next_policy,
      connection,
      base_application: application,
      valid_until: review.valid_until,
      operator_confirmed: true,
    })
  }

  private async readReview(reviewId: string): Promise<OptionsAutopilotActivationReview> {
    const review = JSON.parse(await readFile(this.reviewPath(reviewId), 'utf8')) as OptionsAutopilotActivationReview
    if (review.review_schema_version !== 'options-autopilot-activation-review@1' || review.review_id !== reviewId) {
      throw new Error('Automation review identity is invalid.')
    }
    optionsEntryPolicySchema.parse(review.next_policy)
    optionsAutomationRouteSchema.parse(review.next_route)
    const { content_checksum: _checksum, ...unsigned } = review
    if (sha256(unsigned) !== review.content_checksum) throw new Error('Automation review checksum is invalid.')
    return review
  }

  private reviewPath(reviewId: string): string {
    return path.join(this.reviewDirectory, `${sha256(reviewId)}.json`)
  }
}
