import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  SOURCE_EXECUTION_BINDING_SCHEMA_VERSION,
  sourceExecutionBindingSchema,
  type SourceExecutionBinding,
} from '@trade-god/contracts'

import { sha256 } from './canonical.ts'
import { ExecutionGatewayError } from './errors.ts'

export type CreateSourceExecutionBindingInput = Omit<
  SourceExecutionBinding,
  'source_execution_binding_schema_version' | 'binding_id' | 'state' | 'created_at' | 'updated_at' | 'content_checksum'
>

export class FileSourceExecutionBindingStore {
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly root: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async getBySource(input: {
    server_id: string
    channel_id: string
    author_id: string
    message_id: string
  }): Promise<SourceExecutionBinding | null> {
    return this.withLock(async () => {
      try {
        const binding = await this.read(this.bindingPath(sourceKey(input)))
        await this.ensureTicketClaim(binding)
        return binding
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
    })
  }

  async getByTicket(ticketId: string): Promise<SourceExecutionBinding | null> {
    return this.withLock(async () => {
      let claim: unknown
      try {
        claim = JSON.parse(await readFile(this.ticketClaimPath(ticketId), 'utf8'))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
      if (!claim || typeof claim !== 'object' || !('binding' in claim)) {
        throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Ticket binding claim is invalid.')
      }
      const binding = this.verifyBinding((claim as { binding: unknown }).binding)
      if (binding.ticket_id !== ticketId) {
        throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Ticket binding identity changed.')
      }
      const key = sourceKey(binding)
      try {
        const current = await this.read(this.bindingPath(key))
        if (!sameBindingEvidence(current, binding)) {
          throw new ExecutionGatewayError(
            'RECORD_INTEGRITY_FAILURE',
            'Ticket binding conflicts with its source binding.',
          )
        }
        return current
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        await this.ensureSourceBinding(binding)
        return binding
      }
    })
  }

  async bind(input: CreateSourceExecutionBindingInput): Promise<SourceExecutionBinding> {
    return this.withLock(async () => {
      const key = sourceKey(input)
      const bindingId = `source-binding-${sha256(key).slice(0, 40)}`
      const timestamp = this.now()
      const unsigned: Omit<SourceExecutionBinding, 'content_checksum'> = {
        source_execution_binding_schema_version: SOURCE_EXECUTION_BINDING_SCHEMA_VERSION,
        binding_id: bindingId,
        ...input,
        state: 'bound',
        created_at: timestamp,
        updated_at: timestamp,
      }
      const binding = sourceExecutionBindingSchema.parse({
        ...unsigned,
        content_checksum: sha256(unsigned),
      })
      await mkdir(this.bindingDirectory(), { recursive: true })

      const ticketClaim = { ticket_id: binding.ticket_id, binding }
      await this.createOrVerify(
        this.ticketClaimPath(binding.ticket_id),
        ticketClaim,
        (current) => JSON.stringify(current) === JSON.stringify(ticketClaim),
        'DiscoTrader ticket is already bound to another source execution.',
      )
      await this.createOrVerify(
        this.bindingPath(key),
        binding,
        (current) => {
          const parsed = this.parse(current)
          return sameBindingEvidence(parsed, binding)
        },
        'Discord source event is already bound to different routing evidence.',
      )
      return this.read(this.bindingPath(key))
    })
  }

  private async ensureTicketClaim(binding: SourceExecutionBinding): Promise<void> {
    const claim = { ticket_id: binding.ticket_id, binding }
    await this.createOrVerify(
      this.ticketClaimPath(binding.ticket_id),
      claim,
      (current) => {
        if (!current || typeof current !== 'object' || !('binding' in current)) return false
        return sameBindingEvidence(
          this.verifyBinding((current as { binding: unknown }).binding),
          binding,
        )
      },
      'DiscoTrader ticket is already bound to another source execution.',
    )
  }

  private async ensureSourceBinding(binding: SourceExecutionBinding): Promise<void> {
    const key = sourceKey(binding)
    await this.createOrVerify(
      this.bindingPath(key),
      binding,
      (current) => sameBindingEvidence(this.verifyBinding(current), binding),
      'Discord source event is already bound to different routing evidence.',
    )
  }

  async hasMirrorBindingForContext(input: {
    server_id?: string
    channel_ids: string[]
    author_id: string
    reply_to_message_id?: string
  }): Promise<boolean> {
    return this.withLock(async () => {
      let files: string[]
      try {
        files = (await readdir(this.bindingDirectory())).filter((file) => file.endsWith('.json'))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
        throw error
      }
      for (const file of files) {
        const binding = await this.read(path.join(this.bindingDirectory(), file))
        if (binding.target.type !== 'mirror-group') continue
        if (binding.author_id !== input.author_id) continue
        if (input.server_id && binding.server_id !== input.server_id) continue
        if (input.reply_to_message_id) {
          if (binding.message_id !== input.reply_to_message_id) continue
        } else if (!input.channel_ids.includes(binding.channel_id)) continue
        return true
      }
      return false
    })
  }

  async markMaterialized(bindingId: string, source: {
    server_id: string
    channel_id: string
    author_id: string
    message_id: string
  }): Promise<SourceExecutionBinding> {
    return this.withLock(async () => {
      const destination = this.bindingPath(sourceKey(source))
      const current = await this.read(destination)
      if (current.binding_id !== bindingId) {
        throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Source binding identity changed.')
      }
      if (current.state === 'materialized') return current
      if (current.state !== 'bound') {
        throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Halted source binding cannot materialize.')
      }
      const { content_checksum: _checksum, ...previous } = current
      const unsigned: Omit<SourceExecutionBinding, 'content_checksum'> = {
        ...previous,
        state: 'materialized',
        updated_at: this.now(),
      }
      const next = sourceExecutionBindingSchema.parse({ ...unsigned, content_checksum: sha256(unsigned) })
      await this.writeAtomic(destination, next)
      return next
    })
  }

  private async read(file: string): Promise<SourceExecutionBinding> {
    const value = this.parse(JSON.parse(await readFile(file, 'utf8')))
    const { content_checksum: _checksum, ...unsigned } = value
    if (sha256(unsigned) !== value.content_checksum) {
      throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Source binding failed integrity validation.')
    }
    return value
  }

  private parse(value: unknown): SourceExecutionBinding {
    try {
      return sourceExecutionBindingSchema.parse(value)
    } catch {
      throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Source binding is invalid.')
    }
  }

  private verifyBinding(value: unknown): SourceExecutionBinding {
    const binding = this.parse(value)
    const { content_checksum: _checksum, ...unsigned } = binding
    if (sha256(unsigned) !== binding.content_checksum) {
      throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Source binding failed integrity validation.')
    }
    return binding
  }

  private async createOrVerify(
    destination: string,
    value: unknown,
    matches: (current: unknown) => boolean,
    conflictMessage: string,
  ): Promise<void> {
    await mkdir(path.dirname(destination), { recursive: true })
    try {
      await writeFile(destination, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: 'utf8', flag: 'wx', mode: 0o600,
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const current = JSON.parse(await readFile(destination, 'utf8'))
      if (!matches(current)) {
        throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', conflictMessage)
      }
    }
  }

  private async writeAtomic(destination: string, value: unknown): Promise<void> {
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, destination)
  }

  private bindingDirectory(): string {
    return path.join(this.root, 'mirror-groups', 'source-bindings')
  }
  private bindingPath(key: string): string {
    return path.join(this.bindingDirectory(), `${sha256(key)}.json`)
  }
  private ticketClaimPath(ticketId: string): string {
    return path.join(this.bindingDirectory(), 'tickets', `${sha256(ticketId)}.json`)
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue
    let release!: () => void
    this.queue = previous.catch(() => undefined).then(() => new Promise<void>((resolve) => { release = resolve }))
    await previous.catch(() => undefined)
    try { return await operation() } finally { release() }
  }
}

const sourceKey = (input: {
  server_id: string
  channel_id: string
  author_id: string
  message_id: string
}): string => [input.server_id, input.channel_id, input.author_id, input.message_id].join(':')

const sameBindingEvidence = (
  left: SourceExecutionBinding,
  right: SourceExecutionBinding,
): boolean => sha256({
  binding_id: left.binding_id,
  source_type: left.source_type,
  server_id: left.server_id,
  channel_id: left.channel_id,
  author_id: left.author_id,
  message_id: left.message_id,
  ticket_id: left.ticket_id,
  ticket_checksum: left.ticket_checksum,
  route_id: left.route_id,
  instrument: left.instrument,
  received_at: left.received_at,
  target: left.target,
  created_at: left.created_at,
}) === sha256({
  binding_id: right.binding_id,
  source_type: right.source_type,
  server_id: right.server_id,
  channel_id: right.channel_id,
  author_id: right.author_id,
  message_id: right.message_id,
  ticket_id: right.ticket_id,
  ticket_checksum: right.ticket_checksum,
  route_id: right.route_id,
  instrument: right.instrument,
  received_at: right.received_at,
  target: right.target,
  created_at: right.created_at,
})
