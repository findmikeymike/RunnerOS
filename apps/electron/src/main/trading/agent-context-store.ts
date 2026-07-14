import { randomUUID } from 'node:crypto'
import { link, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  AGENT_CONTEXT_DELIVERY_RECEIPT_SCHEMA_VERSION,
  AGENT_CONTEXT_REFERENCE_SCHEMA_VERSION,
  agentContextDeliveryReceiptSchema,
  agentContextReferenceSchema,
  agentMarketSnapshotSchema,
  identifierSchema,
  type AgentContextDeliveryReceipt,
  type AgentContextReference,
  type AgentMarketSnapshot,
} from '@trade-god/contracts'
import { assertAgentMarketSnapshotIntegrity } from '@trade-god/market-state'

interface StoredContextEnvelope {
  reference: AgentContextReference
  snapshot: AgentMarketSnapshot
}

export class AgentContextStore {
  constructor(
    private readonly rootDirectory: string,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly nextDeliveryId: () => string = () => `context-delivery-${randomUUID()}`,
  ) {}

  async publish(snapshotValue: unknown): Promise<AgentContextReference> {
    const snapshot = assertAgentMarketSnapshotIntegrity(snapshotValue)
    const reference = agentContextReferenceSchema.parse({
      reference_schema_version: AGENT_CONTEXT_REFERENCE_SCHEMA_VERSION,
      context_id: `market-context-${snapshot.snapshot_content_sha256}`,
      context_schema_version: snapshot.snapshot_schema_version,
      content_sha256: snapshot.snapshot_content_sha256,
      snapshot_id: snapshot.snapshot_id,
      trace_id: snapshot.trace_id,
      instrument_id: snapshot.instrument.id,
      created_at: this.now(),
      authority: snapshot.authority,
    })
    const destination = this.contextFile(reference.context_id)
    try {
      await this.atomicCreate(destination, { reference, snapshot })
      return reference
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
      const existing = await this.readEnvelope(destination)
      this.assertReferenceMatchesSnapshot(existing.reference, snapshot)
      return existing.reference
    }
  }

  async queue(
    referenceValue: unknown,
    consumer: { agentId: string; capability: string },
  ): Promise<AgentContextDeliveryReceipt> {
    const reference = agentContextReferenceSchema.parse(referenceValue)
    await this.resolveReference(reference)
    const receipt = agentContextDeliveryReceiptSchema.parse({
      delivery_receipt_schema_version: AGENT_CONTEXT_DELIVERY_RECEIPT_SCHEMA_VERSION,
      delivery_id: identifierSchema.parse(this.nextDeliveryId()),
      trace_id: reference.trace_id,
      consumer: {
        agent_id: identifierSchema.parse(consumer.agentId),
        capability: identifierSchema.parse(consumer.capability),
      },
      delivery_mode: 'reference',
      context: reference,
      status: 'queued',
      queued_at: this.now(),
    })
    await this.atomicCreate(this.deliveryFile(receipt.delivery_id), receipt)
    return receipt
  }

  async resolveForConsumer(
    deliveryIdValue: string,
    consumerAgentIdValue: string,
  ): Promise<{ receipt: AgentContextDeliveryReceipt; snapshot: AgentMarketSnapshot }> {
    const deliveryId = identifierSchema.parse(deliveryIdValue)
    const consumerAgentId = identifierSchema.parse(consumerAgentIdValue)
    const destination = this.deliveryFile(deliveryId)
    const receipt = agentContextDeliveryReceiptSchema.parse(JSON.parse(await readFile(destination, 'utf8')))
    if (receipt.consumer.agent_id !== consumerAgentId) throw new Error('Agent context delivery belongs to a different consumer.')
    const snapshot = await this.resolveReference(receipt.context)
    if (receipt.status === 'resolved') return { receipt, snapshot }
    const resolved = agentContextDeliveryReceiptSchema.parse({ ...receipt, status: 'resolved', resolved_at: this.now() })
    await this.atomicWrite(destination, resolved)
    return { receipt: resolved, snapshot }
  }

  async readDelivery(deliveryIdValue: string): Promise<AgentContextDeliveryReceipt> {
    const deliveryId = identifierSchema.parse(deliveryIdValue)
    return agentContextDeliveryReceiptSchema.parse(JSON.parse(await readFile(this.deliveryFile(deliveryId), 'utf8')))
  }

  private async resolveReference(referenceValue: unknown): Promise<AgentMarketSnapshot> {
    const reference = agentContextReferenceSchema.parse(referenceValue)
    const envelope = await this.readEnvelope(this.contextFile(reference.context_id))
    if (JSON.stringify(envelope.reference) !== JSON.stringify(reference)) {
      throw new Error('Agent context reference does not match its stored envelope.')
    }
    this.assertReferenceMatchesSnapshot(reference, envelope.snapshot)
    return envelope.snapshot
  }

  private assertReferenceMatchesSnapshot(reference: AgentContextReference, snapshotValue: unknown): void {
    const snapshot = assertAgentMarketSnapshotIntegrity(snapshotValue)
    if (
      reference.content_sha256 !== snapshot.snapshot_content_sha256
      || reference.snapshot_id !== snapshot.snapshot_id
      || reference.trace_id !== snapshot.trace_id
      || reference.instrument_id !== snapshot.instrument.id
      || reference.context_schema_version !== snapshot.snapshot_schema_version
      || JSON.stringify(reference.authority) !== JSON.stringify(snapshot.authority)
    ) throw new Error('Agent context reference identity does not match its snapshot.')
  }

  private async readEnvelope(file: string): Promise<StoredContextEnvelope> {
    const value = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    return {
      reference: agentContextReferenceSchema.parse(value.reference),
      snapshot: agentMarketSnapshotSchema.parse(value.snapshot),
    }
  }

  private contextFile(contextId: string): string {
    return path.join(this.rootDirectory, 'contexts', `${safeStorageId(contextId)}.json`)
  }
  private deliveryFile(deliveryId: string): string {
    return path.join(this.rootDirectory, 'deliveries', `${safeStorageId(deliveryId)}.json`)
  }

  private async atomicWrite(destination: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(destination), { recursive: true })
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, destination)
  }

  private async atomicCreate(destination: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(destination), { recursive: true })
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    try { await link(temporary, destination) } finally { await unlink(temporary).catch(() => undefined) }
  }
}

function isAlreadyExists(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')
}

function safeStorageId(value: string): string {
  const parsed = identifierSchema.parse(value)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(parsed)) throw new TypeError('Storage identity contains unsafe path characters.')
  return parsed
}
