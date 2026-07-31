import { createHash } from 'node:crypto'

import type {
  ExecutionAuthorization,
  ExecutionReceipt,
  OrderIntent,
  TradingConnection,
} from '@trade-god/contracts'

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    )
  }
  return value
}

export const canonicalJson = (value: unknown): string => JSON.stringify(canonicalize(value))

export const sha256 = (value: unknown): string => (
  createHash('sha256').update(canonicalJson(value)).digest('hex')
)

export const computeOrderIntentChecksum = (
  intent: Omit<OrderIntent, 'content_checksum'> | OrderIntent,
): string => {
  const { content_checksum: _ignored, ...payload } = intent as OrderIntent
  return sha256(payload)
}

export const computeActionDigest = (
  intent: OrderIntent,
  connection: TradingConnection,
): string => sha256({
  intent_id: intent.intent_id,
  intent_checksum: intent.content_checksum,
  connection_id: connection.connection_id,
  account_ref: connection.account_ref,
  environment: connection.environment,
  instrument: intent.instrument,
  side: intent.side,
  quantity: intent.quantity,
  entry: intent.entry,
  protection: intent.protection,
  time_in_force: intent.time_in_force,
})

export const computeIdempotencyKey = (
  intent: OrderIntent,
  connection: TradingConnection,
  authorization: ExecutionAuthorization,
  actionDigest: string,
): string => sha256({
  intent_id: intent.intent_id,
  connection_id: connection.connection_id,
  authorization_id: authorization.authorization_id,
  action_digest: actionDigest,
})

export const computeExecutionReceiptChecksum = (
  receipt: Omit<ExecutionReceipt, 'content_checksum'> | ExecutionReceipt,
): string => {
  const { content_checksum: _ignored, ...payload } = receipt as ExecutionReceipt
  return sha256(payload)
}
