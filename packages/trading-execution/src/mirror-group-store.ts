import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  MIRROR_GROUP_SCHEMA_VERSION,
  mirrorGroupSchema,
  type MirrorGroup,
  type MirrorQuantityRule,
  type TradingConnection,
} from '@trade-god/contracts'

import { sha256 } from './canonical.ts'
import { ExecutionGatewayError } from './errors.ts'

export interface SaveMirrorGroupMemberInput {
  connection_id: string
  enabled: boolean
  quantity_rule: MirrorQuantityRule
}

export interface SaveMirrorGroupInput {
  mirror_group_id: string
  display_name: string
  environment: MirrorGroup['environment']
  state: MirrorGroup['state']
  dispatch_max_concurrency: number
  max_aggregate_initial_risk: string
  max_active_parent_trades: number
  members: SaveMirrorGroupMemberInput[]
  expected_revision?: number
}

interface MirrorGroupPointer {
  mirror_group_id: string
  revision: number
  content_checksum: string
}

export class FileMirrorGroupStore {
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly root: string,
    private readonly resolveConnection: (connectionId: string) => Promise<TradingConnection>,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async list(): Promise<MirrorGroup[]> {
    return this.withLock(async () => {
      let files: string[]
      try {
        files = await readdir(this.currentDirectory())
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw error
      }
      const groups = await Promise.all(files
        .filter((file) => /^[a-f0-9]{64}\.json$/.test(file))
        .map((file) => this.readPointer(path.join(this.currentDirectory(), file))))
      return groups.sort((a, b) => a.display_name.localeCompare(b.display_name))
    })
  }

  async get(groupId: string): Promise<MirrorGroup> {
    return this.withLock(() => this.getUnlocked(groupId))
  }

  async getRevision(groupId: string, revision: number): Promise<MirrorGroup> {
    return this.withLock(async () => {
      try {
        return await this.readRevision(groupId, revision)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new ExecutionGatewayError(
            'INTENT_NOT_FOUND',
            `Mirror Group ${groupId} revision ${revision} was not found.`,
          )
        }
        throw error
      }
    })
  }

  async save(input: SaveMirrorGroupInput): Promise<MirrorGroup> {
    return this.withLock(async () => {
      const existing = await this.getUnlocked(input.mirror_group_id).catch((error) => {
        if (error instanceof ExecutionGatewayError && error.code === 'INTENT_NOT_FOUND') return undefined
        throw error
      })
      if (existing && input.expected_revision !== existing.revision) {
        throw new ExecutionGatewayError(
          'EXECUTION_BUSY',
          `Mirror Group changed from revision ${input.expected_revision ?? 'unknown'} to ${existing.revision}; reload before saving.`,
        )
      }
      if (!existing && input.expected_revision !== undefined) {
        throw new ExecutionGatewayError('EXECUTION_BUSY', 'Mirror Group does not exist at the expected revision.')
      }
      if (existing && input.environment !== existing.environment) {
        throw new ExecutionGatewayError('ACCOUNT_MISMATCH', 'Mirror Group environment is immutable.')
      }
      if (input.environment !== 'paper') {
        throw new ExecutionGatewayError(
          'CAPABILITY_UNAVAILABLE',
          'Mirror Groups are restricted to paper accounts during the preview rollout.',
        )
      }
      if (input.members.length > 5) {
        throw new ExecutionGatewayError(
          'CAPABILITY_UNAVAILABLE',
          'The first paper Mirror Group rollout is capped at five accounts.',
        )
      }

      const connections = await Promise.all(input.members.map((member) => (
        this.resolveConnection(member.connection_id)
      )))
      const accountKeys = connections.map(providerAccountIdentityKey)
      if (new Set(accountKeys).size !== accountKeys.length) {
        throw new ExecutionGatewayError(
          'ACCOUNT_MISMATCH',
          'A Mirror Group cannot contain the same underlying provider account twice.',
        )
      }
      for (const [index, connection] of connections.entries()) {
        if (connection.environment !== input.environment) {
          throw new ExecutionGatewayError(
            'ACCOUNT_MISMATCH',
            'Every Mirror Group member must use the group environment.',
          )
        }
        if (input.state === 'active' && input.members[index]?.enabled && (
          !connection.enabled
          || connection.state !== 'ready'
          || !connection.certifications.includes('paper-lifecycle-certified')
        )) {
          throw new ExecutionGatewayError(
            'CERTIFICATION_REQUIRED',
            `Account ${connection.display_name} is not enabled, ready, and paper-lifecycle-certified.`,
          )
        }
      }

      const revision = (existing?.revision ?? 0) + 1
      const pending = await this.readRevision(input.mirror_group_id, revision).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      })
      if (pending) {
        if (!mirrorGroupMatchesInput(pending, input)) {
          throw new ExecutionGatewayError(
            'RECORD_INTEGRITY_FAILURE',
            `Mirror Group has an uncommitted conflicting revision ${revision}; it cannot be overwritten.`,
          )
        }
        await this.writeAtomic(this.pointerPath(pending.mirror_group_id), {
          mirror_group_id: pending.mirror_group_id,
          revision: pending.revision,
          content_checksum: pending.content_checksum,
        } satisfies MirrorGroupPointer)
        return structuredClone(pending)
      }
      const timestamp = this.now()
      const unsigned: Omit<MirrorGroup, 'content_checksum'> = {
        mirror_group_schema_version: MIRROR_GROUP_SCHEMA_VERSION,
        mirror_group_id: input.mirror_group_id,
        revision,
        display_name: input.display_name,
        environment: input.environment,
        state: input.state,
        admission_policy: 'all-members-before-order-mutation-io',
        dispatch_policy: {
          mode: 'bounded-parallel',
          max_concurrency: input.dispatch_max_concurrency,
        },
        portfolio_limits: {
          currency: 'USD',
          max_aggregate_initial_risk: input.max_aggregate_initial_risk,
          max_active_parent_trades: input.max_active_parent_trades,
        },
        members: input.members.map((member) => ({
          member_id: `member-${sha256({
            mirror_group_id: input.mirror_group_id,
            connection_id: member.connection_id,
          }).slice(0, 32)}`,
          ...member,
        })),
        created_at: existing?.created_at ?? timestamp,
        updated_at: timestamp,
      }
      const group = mirrorGroupSchema.parse({
        ...unsigned,
        content_checksum: sha256(unsigned),
      })
      await this.writeRevision(group)
      await this.writeAtomic(this.pointerPath(group.mirror_group_id), {
        mirror_group_id: group.mirror_group_id,
        revision: group.revision,
        content_checksum: group.content_checksum,
      } satisfies MirrorGroupPointer)
      return structuredClone(group)
    })
  }

  private async getUnlocked(groupId: string): Promise<MirrorGroup> {
    try {
      return await this.readPointer(this.pointerPath(groupId))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ExecutionGatewayError('INTENT_NOT_FOUND', `Mirror Group ${groupId} was not found.`)
      }
      throw error
    }
  }

  private async readPointer(file: string): Promise<MirrorGroup> {
    const pointer = JSON.parse(await readFile(file, 'utf8')) as Partial<MirrorGroupPointer>
    if (
      typeof pointer.mirror_group_id !== 'string'
      || !Number.isSafeInteger(pointer.revision)
      || Number(pointer.revision) <= 0
      || !/^[a-f0-9]{64}$/.test(pointer.content_checksum ?? '')
    ) {
      throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Mirror Group pointer is invalid.')
    }
    const group = await this.readRevision(pointer.mirror_group_id, Number(pointer.revision))
    if (
      group.mirror_group_id !== pointer.mirror_group_id
      || group.revision !== pointer.revision
      || group.content_checksum !== pointer.content_checksum
    ) {
      throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Mirror Group revision failed integrity validation.')
    }
    return group
  }

  private async readRevision(groupId: string, revision: number): Promise<MirrorGroup> {
    const group = mirrorGroupSchema.parse(JSON.parse(
      await readFile(this.revisionPath(groupId, revision), 'utf8'),
    ))
    const { content_checksum: _checksum, ...unsigned } = group
    if (
      group.mirror_group_id !== groupId
      || group.revision !== revision
      || sha256(unsigned) !== group.content_checksum
    ) {
      throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Mirror Group revision failed integrity validation.')
    }
    return group
  }

  private async writeRevision(group: MirrorGroup): Promise<void> {
    const destination = this.revisionPath(group.mirror_group_id, group.revision)
    await mkdir(path.dirname(destination), { recursive: true })
    try {
      await writeFile(destination, `${JSON.stringify(group, null, 2)}\n`, {
        encoding: 'utf8', flag: 'wx', mode: 0o600,
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const current = mirrorGroupSchema.parse(JSON.parse(await readFile(destination, 'utf8')))
      if (current.content_checksum !== group.content_checksum) {
        throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Mirror Group revision is immutable.')
      }
    }
  }

  private async writeAtomic(destination: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(destination), { recursive: true })
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, destination)
  }

  private currentDirectory(): string { return path.join(this.root, 'mirror-groups', 'groups', 'current') }
  private pointerPath(groupId: string): string {
    return path.join(this.currentDirectory(), `${sha256(groupId)}.json`)
  }
  private revisionPath(groupId: string, revision: number): string {
    return path.join(
      this.root,
      'mirror-groups',
      'groups',
      'revisions',
      sha256(groupId),
      `revision-${revision}.json`,
    )
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue
    let release!: () => void
    this.queue = previous.catch(() => undefined).then(() => new Promise<void>((resolve) => { release = resolve }))
    await previous.catch(() => undefined)
    try { return await operation() } finally { release() }
  }
}

export const providerAccountIdentityKey = (connection: TradingConnection): string => [
  connection.firm.slug,
  connection.platform.slug,
  connection.environment,
  connection.account_ref,
].join(':')

const mirrorGroupMatchesInput = (group: MirrorGroup, input: SaveMirrorGroupInput): boolean => (
  group.mirror_group_id === input.mirror_group_id
  && group.display_name === input.display_name.trim()
  && group.environment === input.environment
  && group.state === input.state
  && group.dispatch_policy.max_concurrency === input.dispatch_max_concurrency
  && group.portfolio_limits.max_aggregate_initial_risk === input.max_aggregate_initial_risk
  && group.portfolio_limits.max_active_parent_trades === input.max_active_parent_trades
  && JSON.stringify(group.members.map(({ connection_id, enabled, quantity_rule }) => ({
    connection_id, enabled, quantity_rule,
  }))) === JSON.stringify(input.members)
)
