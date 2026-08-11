import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  MIRROR_DISPATCH_GRANT_SCHEMA_VERSION,
  MIRROR_RISK_RESERVATION_SCHEMA_VERSION,
  mirrorChildRiskProjectionSchema,
  mirrorChildSourceSchema,
  mirrorDispatchGrantSchema,
  mirrorExecutionSchema,
  mirrorRiskReservationSchema,
  type MirrorChildRiskProjection,
  type MirrorChildSource,
  type MirrorDispatchGrant,
  type MirrorExecution,
  type MirrorGroup,
  type MirrorRiskReservation,
} from '@trade-god/contracts'

import { sha256 } from './canonical.ts'
import { ExecutionGatewayError } from './errors.ts'

export class FileMirrorExecutionStore {
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly root: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  persistChildSource(source: MirrorChildSource): Promise<MirrorChildSource> {
    return this.withLock(async () => {
      const value = this.verify(source, mirrorChildSourceSchema, 'Mirror child source')
      await this.createOrVerify(this.childSourcePath(value.mirror_child_source_id), value)
      return value
    })
  }

  persistProjection(projection: MirrorChildRiskProjection): Promise<MirrorChildRiskProjection> {
    return this.withLock(async () => {
      const value = this.verify(projection, mirrorChildRiskProjectionSchema, 'Mirror risk projection')
      await this.createOrVerify(this.projectionPath(value.projection_id), value)
      return value
    })
  }

  createParent(parent: MirrorExecution): Promise<MirrorExecution> {
    return this.withLock(async () => {
      const value = this.verify(parent, mirrorExecutionSchema, 'Mirror parent')
      const existing = await this.readOptional(
        this.parentPath(value.mirror_execution_id),
        mirrorExecutionSchema,
        'Mirror parent',
      )
      if (existing) {
        if (sha256(parentIdentity(existing)) !== sha256(parentIdentity(value))) {
          throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Mirror parent identity conflicts.')
        }
        return existing
      }
      await this.createOrVerify(this.parentPath(value.mirror_execution_id), value)
      return this.readParent(value.mirror_execution_id)
    })
  }

  getParent(mirrorExecutionId: string): Promise<MirrorExecution> {
    return this.withLock(() => this.readParent(mirrorExecutionId))
  }

  getProjectionsForParent(parent: MirrorExecution): Promise<MirrorChildRiskProjection[]> {
    return this.withLock(async () => {
      const projections = await Promise.all(parent.children.map((child) => this.readRequired(
        this.projectionPath(`mirror-projection-${sha256(child.intent_id).slice(0, 32)}`),
        mirrorChildRiskProjectionSchema,
        'Mirror risk projection',
      )))
      if (projections.some((projection) => projection.mirror_execution_id !== parent.mirror_execution_id)) {
        throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Mirror projections do not bind the parent.')
      }
      return projections
    })
  }

  updateParent(
    mirrorExecutionId: string,
    mutate: (parent: MirrorExecution) => Omit<MirrorExecution, 'content_checksum'>,
  ): Promise<MirrorExecution> {
    return this.withLock(async () => {
      const current = await this.readParent(mirrorExecutionId)
      const unsigned = mutate(structuredClone(current))
      const next = mirrorExecutionSchema.parse({ ...unsigned, content_checksum: sha256(unsigned) })
      if (next.mirror_execution_id !== current.mirror_execution_id) {
        throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Mirror parent identity is immutable.')
      }
      await this.writeAtomic(this.parentPath(mirrorExecutionId), next)
      return next
    })
  }

  reserve(input: {
    parent: MirrorExecution
    group: MirrorGroup
    projections: MirrorChildRiskProjection[]
  }): Promise<MirrorRiskReservation> {
    return this.withLock(() => this.withGroupReservationLock(input.group.mirror_group_id, async () => {
      const existing = await this.readOptional(
        this.reservationPath(input.parent.mirror_execution_id),
        mirrorRiskReservationSchema,
        'Mirror risk reservation',
      )
      if (existing) {
        const expected = new Map(input.projections.map((projection) => [
          projection.projection_id,
          projection.content_checksum,
        ]))
        if (
          existing.mirror_execution_id !== input.parent.mirror_execution_id
          || existing.mirror_group_id !== input.group.mirror_group_id
          || existing.mirror_group_revision !== input.group.revision
          || existing.group_snapshot_checksum !== input.group.content_checksum
          || existing.projections.length !== expected.size
          || existing.projections.some((projection) => (
            expected.get(projection.projection_id) !== projection.projection_checksum
          ))
        ) {
          throw new ExecutionGatewayError(
            'RECORD_INTEGRITY_FAILURE',
            'Existing Mirror reservation conflicts with current admission evidence.',
          )
        }
        return existing
      }
      if (input.parent.state !== 'planning') {
        throw new ExecutionGatewayError('INVALID_STATE', 'Only a planning Mirror parent can reserve risk.')
      }
      const expectedConnections = new Set(input.parent.children.map((child) => child.connection_id))
      if (
        input.projections.length !== expectedConnections.size
        || input.projections.some((projection) => (
          projection.mirror_execution_id !== input.parent.mirror_execution_id
          || !expectedConnections.has(projection.connection_id)
          || Date.parse(projection.valid_until) <= Date.parse(this.now())
        ))
      ) {
        throw new ExecutionGatewayError(
          'RISK_DENIED',
          'Aggregate reservation requires one fresh exact projection for every child.',
        )
      }
      const aggregateCents = input.projections.reduce(
        (sum, projection) => sum + usdCents(projection.initial_risk_upper_bound_usd),
        0n,
      )
      const active = await this.listActiveReservations(input.group.mirror_group_id)
      const activeCents = active.reduce(
        (sum, reservation) => sum + usdCents(reservation.aggregate_initial_risk_upper_bound_usd),
        0n,
      )
      if (active.length >= input.group.portfolio_limits.max_active_parent_trades) {
        throw new ExecutionGatewayError('RISK_DENIED', 'Mirror Group has no active parent capacity.')
      }
      if (
        activeCents + aggregateCents
        > usdLimitCentsFloor(input.group.portfolio_limits.max_aggregate_initial_risk)
      ) {
        throw new ExecutionGatewayError('RISK_DENIED', 'Mirror Group aggregate risk capacity is exhausted.')
      }
      const timestamp = this.now()
      const unsigned: Omit<MirrorRiskReservation, 'content_checksum'> = {
        mirror_risk_reservation_schema_version: MIRROR_RISK_RESERVATION_SCHEMA_VERSION,
        reservation_id: `mirror-reservation-${sha256(input.parent.mirror_execution_id).slice(0, 32)}`,
        mirror_execution_id: input.parent.mirror_execution_id,
        mirror_group_id: input.group.mirror_group_id,
        mirror_group_revision: input.group.revision,
        group_snapshot_checksum: input.group.content_checksum,
        projections: input.projections.map((projection) => ({
          projection_id: projection.projection_id,
          connection_id: projection.connection_id,
          initial_risk_upper_bound_usd: projection.initial_risk_upper_bound_usd,
          projection_checksum: projection.content_checksum,
        })),
        aggregate_initial_risk_upper_bound_usd: formatCents(aggregateCents),
        active_parent_slot: 1,
        state: 'reserved',
        created_at: timestamp,
        updated_at: timestamp,
      }
      const reservation = mirrorRiskReservationSchema.parse({
        ...unsigned,
        content_checksum: sha256(unsigned),
      })
      await this.createOrVerify(this.reservationPath(input.parent.mirror_execution_id), reservation)
      return reservation
    }))
  }

  async issueGrants(input: {
    parent: MirrorExecution
    expires_at: string
  }): Promise<MirrorDispatchGrant[]> {
    return this.withLock(async () => {
      if (input.parent.state !== 'admitted' || !input.parent.reservation_id) {
        throw new ExecutionGatewayError('INVALID_STATE', 'Dispatch grants require an admitted parent.')
      }
      const reservation = await this.readRequired(
        this.reservationPath(input.parent.mirror_execution_id),
        mirrorRiskReservationSchema,
        'Mirror risk reservation',
      )
      const childConnections = new Set(input.parent.children.map((child) => child.connection_id))
      if (
        reservation.state !== 'reserved'
        || reservation.reservation_id !== input.parent.reservation_id
        || reservation.mirror_execution_id !== input.parent.mirror_execution_id
        || reservation.mirror_group_id !== input.parent.mirror_group_id
        || reservation.mirror_group_revision !== input.parent.mirror_group_revision
        || reservation.group_snapshot_checksum !== input.parent.group_snapshot_checksum
        || reservation.projections.length !== childConnections.size
        || reservation.projections.some((projection) => !childConnections.has(projection.connection_id))
      ) {
        throw new ExecutionGatewayError(
          'RECORD_INTEGRITY_FAILURE',
          'Dispatch grants require the exact active aggregate reservation.',
        )
      }
      await this.createOrVerify(
        this.admittedParentPath(input.parent.mirror_execution_id),
        input.parent,
      )
      const childSetChecksum = sha256(input.parent.children.map((child) => ({
        member_id: child.member_id,
        connection_id: child.connection_id,
        intent_id: child.intent_id,
        planned_quantity: child.planned_quantity,
      })))
      const projectionSetChecksum = sha256(reservation.projections)
      const issuedAt = input.parent.updated_at
      const grants: MirrorDispatchGrant[] = []
      for (const child of input.parent.children) {
        const unsigned: Omit<MirrorDispatchGrant, 'content_checksum'> = {
          mirror_dispatch_grant_schema_version: MIRROR_DISPATCH_GRANT_SCHEMA_VERSION,
          grant_id: `mirror-grant-${sha256({
            parent: input.parent.mirror_execution_id,
            intent: child.intent_id,
          }).slice(0, 32)}`,
          mirror_execution_id: input.parent.mirror_execution_id,
          intent_id: child.intent_id,
          connection_id: child.connection_id,
          admitted_parent_checksum: input.parent.content_checksum,
          complete_child_set_checksum: childSetChecksum,
          reservation_id: reservation.reservation_id,
          reservation_checksum: reservation.content_checksum,
          projection_set_checksum: projectionSetChecksum,
          dispatch_authority: 'fake-provider-test-only',
          issued_at: issuedAt,
          expires_at: input.expires_at,
        }
        const grant = mirrorDispatchGrantSchema.parse({ ...unsigned, content_checksum: sha256(unsigned) })
        await this.createOrVerify(this.grantPath(grant.grant_id), grant)
        grants.push(grant)
      }
      return grants
    })
  }

  cancelReservation(mirrorExecutionId: string): Promise<MirrorRiskReservation | null> {
    return this.withLock(async () => {
      const parent = await this.readParent(mirrorExecutionId)
      if (!['planning', 'admitted'].includes(parent.state) || parent.order_mutation_io_started_at) {
        throw new ExecutionGatewayError(
          'INVALID_STATE',
          'Only a pre-dispatch parent may cancel its risk reservation.',
        )
      }
      const file = this.reservationPath(mirrorExecutionId)
      const current = await this.readOptional(file, mirrorRiskReservationSchema, 'Mirror risk reservation')
      if (!current || current.state === 'released') return current
      const releasingUnsigned: Omit<MirrorRiskReservation, 'content_checksum'> = {
        ...withoutChecksum(current), state: 'releasing', updated_at: this.now(),
      }
      const releasing = mirrorRiskReservationSchema.parse({
        ...releasingUnsigned, content_checksum: sha256(releasingUnsigned),
      })
      await this.writeAtomic(file, releasing)
      const releasedUnsigned: Omit<MirrorRiskReservation, 'content_checksum'> = {
        ...withoutChecksum(releasing), state: 'released', updated_at: this.now(),
      }
      const released = mirrorRiskReservationSchema.parse({
        ...releasedUnsigned, content_checksum: sha256(releasedUnsigned),
      })
      await this.writeAtomic(file, released)
      return released
    })
  }

  getGrant(grantId: string): Promise<MirrorDispatchGrant> {
    return this.withLock(async () => {
      const grant = await this.readOptional(
        this.grantPath(grantId),
        mirrorDispatchGrantSchema,
        'Mirror dispatch grant',
      )
      if (!grant) throw new ExecutionGatewayError('INTENT_NOT_FOUND', 'Mirror dispatch grant was not found.')
      const parent = await this.readRequired(
        this.admittedParentPath(grant.mirror_execution_id),
        mirrorExecutionSchema,
        'Admitted Mirror parent snapshot',
      )
      const reservation = await this.readRequired(
        this.reservationPath(grant.mirror_execution_id),
        mirrorRiskReservationSchema,
        'Mirror risk reservation',
      )
      return this.validateGrantAgainstParent(grant, parent, reservation)
    })
  }

  getGrantsForParent(mirrorExecutionId: string): Promise<MirrorDispatchGrant[]> {
    return this.withLock(async () => {
      const parent = await this.readRequired(
        this.admittedParentPath(mirrorExecutionId),
        mirrorExecutionSchema,
        'Admitted Mirror parent snapshot',
      )
      const reservation = await this.readRequired(
        this.reservationPath(mirrorExecutionId),
        mirrorRiskReservationSchema,
        'Mirror risk reservation',
      )
      const grants: MirrorDispatchGrant[] = []
      for (const child of parent.children) {
        const grantId = `mirror-grant-${sha256({
          parent: mirrorExecutionId,
          intent: child.intent_id,
        }).slice(0, 32)}`
        const grant = await this.readRequired(
          this.grantPath(grantId),
          mirrorDispatchGrantSchema,
          'Mirror dispatch grant',
        )
        grants.push(this.validateGrantAgainstParent(grant, parent, reservation))
      }
      return grants
    })
  }

  private async listActiveReservations(groupId: string): Promise<MirrorRiskReservation[]> {
    let files: string[]
    try { files = await readdir(this.reservationDirectory()) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const reservations = await Promise.all(files.filter((file) => (
      file.endsWith('.json') && !file.endsWith('.lock.json')
    )).map((file) => (
      this.readOptional(
        path.join(this.reservationDirectory(), file),
        mirrorRiskReservationSchema,
        'Mirror risk reservation',
      )
    )))
    return reservations.filter((reservation): reservation is MirrorRiskReservation => Boolean(
      reservation
      && reservation.mirror_group_id === groupId
      && (reservation.state === 'reserved' || reservation.state === 'releasing' || reservation.state === 'halted'),
    ))
  }

  private validateGrantAgainstParent(
    grant: MirrorDispatchGrant,
    parent: MirrorExecution,
    reservation: MirrorRiskReservation,
  ): MirrorDispatchGrant {
    const childSetChecksum = sha256(parent.children.map((child) => ({
      member_id: child.member_id,
      connection_id: child.connection_id,
      intent_id: child.intent_id,
      planned_quantity: child.planned_quantity,
    })))
    const child = parent.children.find((candidate) => candidate.intent_id === grant.intent_id)
    if (
      parent.state !== 'admitted'
      || parent.content_checksum !== grant.admitted_parent_checksum
      || childSetChecksum !== grant.complete_child_set_checksum
      || reservation.state !== 'reserved'
      || reservation.reservation_id !== grant.reservation_id
      || reservation.content_checksum !== grant.reservation_checksum
      || sha256(reservation.projections) !== grant.projection_set_checksum
      || parent.reservation_id !== reservation.reservation_id
      || !child
      || child.connection_id !== grant.connection_id
    ) {
      throw new ExecutionGatewayError(
        'RECORD_INTEGRITY_FAILURE',
        'Mirror dispatch grant does not match the frozen admitted parent and complete child set.',
      )
    }
    return grant
  }

  private async withGroupReservationLock<T>(groupId: string, operation: () => Promise<T>): Promise<T> {
    const file = path.join(this.reservationDirectory(), `${sha256(groupId)}.lock.json`)
    await mkdir(path.dirname(file), { recursive: true })
    const claim = { group_id: groupId, process_id: process.pid, claimed_at: this.now() }
    let claimed = false
    for (let attempt = 0; attempt < 2 && !claimed; attempt += 1) {
      try {
        await writeFile(file, `${JSON.stringify(claim)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
        claimed = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        throw new ExecutionGatewayError(
          'EXECUTION_BUSY',
          'Mirror Group risk admission is locked; stale locks require explicit startup recovery.',
        )
      }
    }
    if (!claimed) throw new ExecutionGatewayError('EXECUTION_BUSY', 'Could not claim Mirror Group risk admission.')
    try { return await operation() } finally {
      await unlink(file).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      })
    }
  }

  private readParent(id: string): Promise<MirrorExecution> {
    return this.readRequired(this.parentPath(id), mirrorExecutionSchema, 'Mirror parent')
  }

  private async readRequired<T>(file: string, schema: { parse(input: unknown): T }, label: string): Promise<T> {
    const value = await this.readOptional(file, schema, label)
    if (!value) throw new ExecutionGatewayError('INTENT_NOT_FOUND', `${label} was not found.`)
    return value
  }

  private async readOptional<T>(
    file: string,
    schema: { parse(input: unknown): T },
    label: string,
  ): Promise<T | null> {
    try {
      return this.verify(JSON.parse(await readFile(file, 'utf8')), schema, label)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private verify<T>(value: unknown, schema: { parse(input: unknown): T }, label: string): T {
    let parsed: T
    try { parsed = schema.parse(value) } catch {
      throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', `${label} is invalid.`)
    }
    const record = parsed as T & { content_checksum: string }
    const { content_checksum: _checksum, ...unsigned } = record
    if (sha256(unsigned) !== record.content_checksum) {
      throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', `${label} failed integrity validation.`)
    }
    return parsed
  }

  private async createOrVerify(file: string, value: { content_checksum: string }): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true })
    try {
      await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = JSON.parse(await readFile(file, 'utf8')) as { content_checksum?: string }
      if (existing.content_checksum !== value.content_checksum) {
        throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Immutable Mirror artifact conflicts.')
      }
    }
  }

  private async writeAtomic(file: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, file)
  }

  private base(): string { return path.join(this.root, 'mirror-groups', 'executions') }
  private parentPath(id: string): string { return path.join(this.base(), sha256(id), 'parent.json') }
  private admittedParentPath(id: string): string { return path.join(this.base(), sha256(id), 'admitted-parent.json') }
  private childSourcePath(id: string): string { return path.join(this.base(), 'child-sources', `${sha256(id)}.json`) }
  private projectionPath(id: string): string { return path.join(this.base(), 'risk-projections', `${sha256(id)}.json`) }
  private reservationDirectory(): string { return path.join(this.root, 'mirror-groups', 'risk-reservations') }
  private reservationPath(id: string): string { return path.join(this.reservationDirectory(), `${sha256(id)}.json`) }
  private grantPath(id: string): string { return path.join(this.root, 'mirror-groups', 'dispatch-grants', `${sha256(id)}.json`) }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue
    let release!: () => void
    this.queue = previous.catch(() => undefined).then(() => new Promise<void>((resolve) => { release = resolve }))
    await previous.catch(() => undefined)
    try { return await operation() } finally { release() }
  }
}

const usdCents = (value: string): bigint => {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) {
    throw new ExecutionGatewayError('RISK_DENIED', 'Mirror USD risk must have at most two decimal places.')
  }
  const [whole, decimals = ''] = value.split('.')
  return BigInt(whole) * 100n + BigInt(decimals.padEnd(2, '0'))
}

const usdLimitCentsFloor = (value: string): bigint => {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new ExecutionGatewayError('RISK_DENIED', 'Mirror USD capacity must be a positive decimal.')
  }
  const [whole, decimals = ''] = value.split('.')
  return BigInt(whole) * 100n + BigInt(decimals.slice(0, 2).padEnd(2, '0'))
}

const parentIdentity = (parent: MirrorExecution) => ({
  mirror_execution_schema_version: parent.mirror_execution_schema_version,
  mirror_execution_id: parent.mirror_execution_id,
  trace_id: parent.trace_id,
  route_id: parent.route_id,
  mirror_group_id: parent.mirror_group_id,
  mirror_group_revision: parent.mirror_group_revision,
  group_snapshot_checksum: parent.group_snapshot_checksum,
  source: parent.source,
  children: parent.children.map((child) => ({
    member_id: child.member_id,
    connection_id: child.connection_id,
    intent_id: child.intent_id,
    planned_quantity: child.planned_quantity,
    quantity_rule_snapshot: child.quantity_rule_snapshot,
  })),
  created_at: parent.created_at,
})

const formatCents = (cents: bigint): string => {
  const whole = cents / 100n
  const remainder = cents % 100n
  return remainder === 0n ? whole.toString() : `${whole}.${remainder.toString().padStart(2, '0')}`
}

const withoutChecksum = <T extends { content_checksum: string }>(value: T): Omit<T, 'content_checksum'> => {
  const { content_checksum: _checksum, ...unsigned } = value
  return unsigned
}
