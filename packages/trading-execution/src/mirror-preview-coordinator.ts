import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  MIRROR_EXECUTION_PREVIEW_SCHEMA_VERSION,
  discoTraderTicketSchema,
  mirrorExecutionPreviewSchema,
  type DiscoTraderTicket,
  type MirrorExecutionPreview,
  type MirrorGroup,
  type TradingConnection,
} from '@trade-god/contracts'

import { sha256 } from './canonical.ts'
import { ExecutionGatewayError } from './errors.ts'
import { providerAccountIdentityKey } from './mirror-group-store.ts'
import {
  convertDiscoTraderTicket,
  type DiscoTraderInstrumentRoute,
} from './sources/discotrader-intent-source.ts'

export interface MirrorPreviewInput {
  ticket: DiscoTraderTicket
  route_id: string
  group: MirrorGroup
  instrument: DiscoTraderInstrumentRoute
  received_at: string
}

export class FileMirrorPreviewCoordinator {
  constructor(
    private readonly root: string,
    private readonly resolveConnection: (connectionId: string) => Promise<TradingConnection>,
  ) {}

  async preview(input: MirrorPreviewInput): Promise<MirrorExecutionPreview> {
    const ticket = discoTraderTicketSchema.parse(input.ticket)
    const ticketChecksum = sha256(ticket)
    const mirrorExecutionId = mirrorExecutionIdFor(ticket, input.group)
    const existing = await this.get(mirrorExecutionId).catch((error) => {
      if (error instanceof ExecutionGatewayError && error.code === 'INTENT_NOT_FOUND') return undefined
      throw error
    })
    if (existing) {
      if (
        existing.source.ticket_checksum !== ticketChecksum
        || existing.group_snapshot_checksum !== input.group.content_checksum
        || existing.route_id !== input.route_id
      ) {
        throw new ExecutionGatewayError(
          'RECORD_INTEGRITY_FAILURE',
          'Mirror preview identity conflicts with existing source or routing evidence.',
        )
      }
      return existing
    }

    const groupReasons: string[] = []
    try {
      convertDiscoTraderTicket(ticket, {
        connection_id: 'mirror-preview-validation',
        source_id: input.route_id,
        instrument: input.instrument,
        valid_for_ms: 5 * 60_000,
      }, input.received_at)
    } catch {
      groupReasons.push('MIRROR_SOURCE_INELIGIBLE')
    }
    if (input.group.state !== 'active') groupReasons.push('MIRROR_GROUP_NOT_ACTIVE')
    if (input.group.environment !== 'paper') groupReasons.push('MIRROR_PAPER_ONLY')
    if (ticket.action.intent === 'add') groupReasons.push('MIRROR_ADD_UNSUPPORTED')

    const children = await Promise.all(input.group.members
      .filter((member) => member.enabled)
      .map(async (member) => {
        const reasons: string[] = []
        const connection = await this.resolveConnection(member.connection_id).catch(() => undefined)
        if (!connection) reasons.push('MIRROR_CONNECTION_MISSING')
        else {
          if (connection.environment !== input.group.environment) reasons.push('MIRROR_ENVIRONMENT_MISMATCH')
          if (!connection.enabled || connection.state !== 'ready') reasons.push('MIRROR_MEMBER_UNREADY')
          if (!connection.certifications.includes('paper-lifecycle-certified')) {
            reasons.push('MIRROR_MEMBER_UNCERTIFIED')
          }
        }
        const plannedQuantity = member.quantity_rule.mode === 'source-quantity'
          ? ticket.contracts
          : member.quantity_rule.contracts
        if (plannedQuantity > member.quantity_rule.max_contracts) reasons.push('MIRROR_MEMBER_QUANTITY_EXCEEDED')
        const risk = computePriceDistanceRiskEstimate(ticket, input.instrument, plannedQuantity)
        if (!risk) reasons.push('MIRROR_RISK_UNBOUNDED')
        return {
          member_id: member.member_id,
          connection_id: member.connection_id,
          child_intent_id: `intent-mirror-${sha256({
            ticket_id: ticket.id,
            message_id: ticket.provenance.messageId,
            mirror_group_id: input.group.mirror_group_id,
            mirror_group_revision: input.group.revision,
            member_id: member.member_id,
            connection_id: member.connection_id,
          }).slice(0, 40)}`,
          provider_account_key: connection ? providerAccountIdentityKey(connection) : `missing:${member.connection_id}`,
          planned_quantity: plannedQuantity,
          quantity_rule_snapshot: member.quantity_rule,
          readiness: reasons.length ? 'blocked' as const : 'ready' as const,
          blocking_reasons: reasons,
          ...(risk ? { estimated_price_distance_risk_usd: risk } : {}),
        }
      }))

    if (children.length < 2) groupReasons.push('MIRROR_ENABLED_MEMBER_COUNT')
    const accountKeys = children.map((child) => child.provider_account_key)
    if (new Set(accountKeys).size !== accountKeys.length) groupReasons.push('MIRROR_DUPLICATE_ACCOUNT')
    const childReasons = children.flatMap((child) => child.blocking_reasons)
    const risks = children.map((child) => child.estimated_price_distance_risk_usd)
    const aggregateRisk = risks.every((risk): risk is string => Boolean(risk))
      ? sumUsd(risks as string[])
      : undefined
    if (
      aggregateRisk
      && compareDecimals(aggregateRisk, input.group.portfolio_limits.max_aggregate_initial_risk) > 0
    ) {
      groupReasons.push('MIRROR_AGGREGATE_RISK_DENIED')
    }
    const blockingReasons = [...new Set([...groupReasons, ...childReasons])]
    const unsigned: Omit<MirrorExecutionPreview, 'content_checksum'> = {
      mirror_execution_preview_schema_version: MIRROR_EXECUTION_PREVIEW_SCHEMA_VERSION,
      mirror_execution_id: mirrorExecutionId,
      route_id: input.route_id,
      mirror_group_id: input.group.mirror_group_id,
      mirror_group_revision: input.group.revision,
      group_snapshot_checksum: input.group.content_checksum,
      source: {
        ticket_id: ticket.id,
        message_id: ticket.provenance.messageId,
        author_id: ticket.provenance.authorId!,
        ticket_checksum: ticketChecksum,
        instrument_canonical_id: input.instrument.canonical_id,
      },
      state: blockingReasons.length ? 'blocked' : 'ready',
      children,
      ...(aggregateRisk ? { aggregate_estimated_price_distance_risk_usd: aggregateRisk } : {}),
      blocking_reasons: blockingReasons,
      execution_blockers: [
        'MIRROR_CHILD_RISK_PROJECTION_UNIMPLEMENTED',
        'MIRROR_DISPATCH_GRANTS_UNIMPLEMENTED',
      ],
      order_mutation_allowed: false,
      created_at: ticket.createdAt,
    }
    const preview = mirrorExecutionPreviewSchema.parse({ ...unsigned, content_checksum: sha256(unsigned) })
    await this.persist(preview)
    return preview
  }

  async get(mirrorExecutionId: string): Promise<MirrorExecutionPreview> {
    try {
      const preview = mirrorExecutionPreviewSchema.parse(JSON.parse(
        await readFile(this.previewPath(mirrorExecutionId), 'utf8'),
      ))
      const { content_checksum: _checksum, ...unsigned } = preview
      if (sha256(unsigned) !== preview.content_checksum) {
        throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Mirror preview failed integrity validation.')
      }
      return preview
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ExecutionGatewayError('INTENT_NOT_FOUND', `Mirror preview ${mirrorExecutionId} was not found.`)
      }
      throw error
    }
  }

  private async persist(preview: MirrorExecutionPreview): Promise<void> {
    const destination = this.previewPath(preview.mirror_execution_id)
    await mkdir(path.dirname(destination), { recursive: true })
    try {
      await writeFile(destination, `${JSON.stringify(preview, null, 2)}\n`, {
        encoding: 'utf8', flag: 'wx', mode: 0o600,
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = await this.get(preview.mirror_execution_id)
      if (existing.content_checksum !== preview.content_checksum) {
        throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Mirror preview is immutable.')
      }
    }
  }

  private previewPath(mirrorExecutionId: string): string {
    return path.join(this.root, 'mirror-groups', 'previews', `${sha256(mirrorExecutionId)}.json`)
  }
}

export const mirrorExecutionIdFor = (
  ticket: DiscoTraderTicket,
  group: Pick<MirrorGroup, 'mirror_group_id' | 'revision'>,
): string => `mirror-${sha256({
  ticket_id: ticket.id,
  message_id: ticket.provenance.messageId,
  mirror_group_id: group.mirror_group_id,
  mirror_group_revision: group.revision,
}).slice(0, 40)}`

const computePriceDistanceRiskEstimate = (
  ticket: DiscoTraderTicket,
  instrument: DiscoTraderInstrumentRoute,
  quantity: number,
): string | undefined => {
  let distance: string | undefined
  if (ticket.stop === undefined) {
    distance = String(ticket.stopDistancePoints)
  } else if (ticket.entry !== undefined) {
    distance = String(Math.abs(ticket.entry - ticket.stop))
  }
  if (!distance || /[eE]/.test(distance)) return undefined
  try {
    return multiplyUsdUpward([distance, instrument.point_value_usd, String(quantity)])
  } catch {
    return undefined
  }
}

const fraction = (value: string): { numerator: bigint; scale: bigint } => {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error('Invalid decimal')
  const [whole, decimals = ''] = value.split('.')
  return { numerator: BigInt(`${whole}${decimals}`), scale: 10n ** BigInt(decimals.length) }
}

const multiplyUsdUpward = (values: string[]): string => {
  let numerator = 1n
  let scale = 1n
  for (const value of values) {
    const parsed = fraction(value)
    numerator *= parsed.numerator
    scale *= parsed.scale
  }
  const cents = (numerator * 100n + scale - 1n) / scale
  return formatCents(cents)
}

const sumUsd = (values: string[]): string => formatCents(values.reduce((sum, value) => {
  const parsed = fraction(value)
  return sum + (parsed.numerator * 100n) / parsed.scale
}, 0n))

const formatCents = (cents: bigint): string => {
  const dollars = cents / 100n
  const remainder = cents % 100n
  return remainder === 0n ? dollars.toString() : `${dollars}.${remainder.toString().padStart(2, '0')}`
}

const compareDecimals = (left: string, right: string): number => {
  const a = fraction(left)
  const b = fraction(right)
  const difference = a.numerator * b.scale - b.numerator * a.scale
  return difference < 0n ? -1 : difference > 0n ? 1 : 0
}
