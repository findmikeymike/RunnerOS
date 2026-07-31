import { describe, expect, test } from 'bun:test'

import {
  EXECUTION_AUTHORIZATION_SCHEMA_VERSION,
  EXTERNAL_AUTHORIZATION_BASIS_SCHEMA_VERSION,
  ORDER_INTENT_SCHEMA_VERSION,
  TRADING_CONNECTION_SCHEMA_VERSION,
  executionAuthorizationSchema,
  externalAuthorizationBasisSchema,
  orderIntentSchema,
  tradingConnectionSchema,
} from '../src/index.ts'

const checksum = 'a'.repeat(64)
const actionDigest = 'b'.repeat(64)

const connection = {
  connection_schema_version: TRADING_CONNECTION_SCHEMA_VERSION,
  connection_id: 'connection-apex-tradovate-paper',
  display_name: 'Apex Tradovate Paper',
  firm: { slug: 'apex', name: 'Apex Trader Funding' },
  platform: { slug: 'tradovate', name: 'Tradovate' },
  environment: 'paper',
  environment_class: 'rehearsal',
  transport_preference: 'api',
  account_ref: 'account-ref-apex-paper',
  account_display: { label: 'APEX-1234', last4: '1234' },
  credential_ref: 'credential-ref-tradovate',
  risk_policy_ref: 'risk-policy-apex-paper-v1',
  authorization_basis_ref: 'authorization-basis-apex',
  approval_policy_ref: 'approval-policy-paper',
  state: 'ready',
  capabilities: {
    read_accounts: true,
    read_orders: true,
    read_positions: true,
    read_executions: true,
    submit_market: true,
    submit_limit: true,
    submit_stop: true,
    submit_stop_limit: true,
    native_bracket: true,
    native_oco: true,
    modify_order: true,
    cancel_order: true,
    partial_close: true,
    flatten: true,
    streaming_events: true,
  },
  certifications: [
    'read-certified',
    'paper-entry-certified',
    'paper-lifecycle-certified',
  ],
  enabled: true,
  created_at: '2026-07-30T15:00:00.000Z',
  updated_at: '2026-07-30T15:00:00.000Z',
} as const

const intent = {
  intent_schema_version: ORDER_INTENT_SCHEMA_VERSION,
  intent_id: 'intent-es-long-1',
  source: {
    type: 'discord',
    source_id: 'discord-message-123',
    author_id: 'discord-user-456',
  },
  connection_id: connection.connection_id,
  instrument: {
    canonical_id: 'CME:ESU6',
    symbol: 'ESU6',
    exchange: 'XCME',
    expiry: '2026-09',
  },
  side: 'buy',
  quantity: 1,
  entry: { type: 'market' },
  protection: {
    stop_loss: { type: 'ticks', value: '8' },
    take_profit: { type: 'ticks', value: '12' },
  },
  time_in_force: 'day',
  created_at: '2026-07-30T15:05:00.000Z',
  valid_until: '2026-07-30T15:06:00.000Z',
  content_checksum: checksum,
} as const

describe('execution contracts', () => {
  test('accepts a paper API connection and immutable futures order intent', () => {
    expect(tradingConnectionSchema.parse(connection)).toMatchObject({
      connection_id: connection.connection_id,
      environment_class: 'rehearsal',
    })
    expect(orderIntentSchema.parse(intent)).toMatchObject({
      intent_id: intent.intent_id,
      quantity: 1,
    })
  })

  test('treats evaluation and performance accounts as consequential', () => {
    expect(tradingConnectionSchema.safeParse({
      ...connection,
      environment: 'performance',
      environment_class: 'rehearsal',
    }).success).toBe(false)

    expect(tradingConnectionSchema.safeParse({
      ...connection,
      environment: 'performance',
      environment_class: 'consequential',
      consequential_enabled_until: '2026-07-30T16:00:00.000Z',
    }).success).toBe(true)
  })

  test('requires browser sessions for browser routes and immutable Discord authors', () => {
    expect(tradingConnectionSchema.safeParse({
      ...connection,
      transport_preference: 'browser',
      credential_ref: undefined,
    }).success).toBe(false)

    expect(orderIntentSchema.safeParse({
      ...intent,
      source: { type: 'discord', source_id: 'discord-message-123' },
    }).success).toBe(false)
  })

  test('requires per-order authorization to bind the exact intent and action digest', () => {
    const authorization = {
      authorization_schema_version: EXECUTION_AUTHORIZATION_SCHEMA_VERSION,
      authorization_id: 'authorization-1',
      connection_id: connection.connection_id,
      mode: 'per-order',
      intent_id: intent.intent_id,
      action_digest: actionDigest,
      scope: {
        symbols: ['ESU6'],
        max_contracts: 1,
        allowed_sides: ['buy'],
        allowed_order_types: ['market'],
        session_start: '2026-07-30T15:00:00.000Z',
        session_end: '2026-07-30T16:00:00.000Z',
        max_daily_loss: '500',
        max_open_risk: '200',
      },
      issued_by: 'operator-michael',
      issued_at: '2026-07-30T15:04:00.000Z',
      expires_at: '2026-07-30T15:06:00.000Z',
    }
    expect(executionAuthorizationSchema.safeParse(authorization).success).toBe(true)
    expect(executionAuthorizationSchema.safeParse({
      ...authorization,
      action_digest: undefined,
    }).success).toBe(false)
  })

  test('requires evidence for owner or prior-written authorization', () => {
    const basis = {
      authorization_basis_schema_version: EXTERNAL_AUTHORIZATION_BASIS_SCHEMA_VERSION,
      authorization_basis_id: 'basis-apex-owner',
      firm_slug: 'apex',
      account_ref: connection.account_ref,
      kind: 'owner-authorization',
      recorded_by: 'operator-michael',
      effective_at: '2026-07-30T15:00:00.000Z',
    }
    expect(externalAuthorizationBasisSchema.safeParse(basis).success).toBe(false)
    expect(externalAuthorizationBasisSchema.safeParse({
      ...basis,
      evidence_ref: 'evidence-apex-owner-consent',
    }).success).toBe(true)
  })

  test('rejects fractional quantity, absent protection, and stale validity windows', () => {
    expect(orderIntentSchema.safeParse({ ...intent, quantity: 0.5 }).success).toBe(false)
    expect(orderIntentSchema.safeParse({ ...intent, protection: {} }).success).toBe(false)
    expect(orderIntentSchema.safeParse({
      ...intent,
      valid_until: intent.created_at,
    }).success).toBe(false)
  })
})
