import { z } from 'zod'

import { decimalStringSchema, identifierSchema, semverSchema, utcTimestampSchema } from './common.ts'

export const TRADE_ALERT_SCHEMA_VERSION = '1.0.0' as const

export const tradeAlertSourceSchema = z.enum(['tradingview', 'discord', 'workflow'])
export const tradeAlertSeveritySchema = z.enum(['info', 'watch', 'warning', 'critical'])
export const tradeAlertDirectionSchema = z.enum(['long', 'short', 'flat', 'none'])
export const tradeAlertStatusSchema = z.enum(['new', 'acknowledged'])

export const tradeAlertSchema = z.object({
  schema_version: z.literal(TRADE_ALERT_SCHEMA_VERSION),
  id: identifierSchema,
  source: tradeAlertSourceSchema,
  source_ref: identifierSchema.optional(),
  received_at: utcTimestampSchema,
  occurred_at: utcTimestampSchema.optional(),
  symbol: identifierSchema,
  title: z.string().min(1).max(240),
  message: z.string().min(1).max(2_000).optional(),
  severity: tradeAlertSeveritySchema,
  direction: tradeAlertDirectionSchema,
  status: tradeAlertStatusSchema,
  price: decimalStringSchema.optional(),
  exchange: identifierSchema.optional(),
  interval: z.string().min(1).max(40).optional(),
}).strict()

export const tradingViewAlertPayloadSchema = z.object({
  secret: z.string().min(16).max(512),
  ticker: z.string().min(1).max(160).optional(),
  symbol: z.string().min(1).max(160).optional(),
  action: z.string().min(1).max(80).optional(),
  title: z.string().min(1).max(240).optional(),
  message: z.string().min(1).max(2_000).optional(),
  severity: tradeAlertSeveritySchema.optional(),
  price: z.union([z.string(), z.number()]).optional(),
  time: z.string().min(1).max(80).optional(),
  timestamp: z.string().min(1).max(80).optional(),
  exchange: z.string().min(1).max(160).optional(),
  interval: z.string().min(1).max(40).optional(),
  alert_id: z.string().min(1).max(160).optional(),
}).passthrough().superRefine((payload, context) => {
  if (!payload.ticker && !payload.symbol) {
    context.addIssue({
      code: 'custom',
      path: ['ticker'],
      message: 'ticker or symbol is required',
    })
  }
})

export const tradeAlertIngestionStatusSchema = z.object({
  state: z.enum(['ready', 'disabled', 'unavailable']),
  local_url: z.string().url().optional(),
  public_url: z.string().url().optional(),
  authentication: z.literal('json-body-secret'),
  public_relay_connected: z.boolean(),
  message: z.string().max(500).optional(),
}).strict()

export const tradeAlertWebhookSetupSchema = z.object({
  delivery_url: z.string().url(),
  local_url: z.string().url(),
  public_url: z.string().url().optional(),
  json_body_template: z.string().min(1).max(4_000),
}).strict()

export type TradeAlert = z.infer<typeof tradeAlertSchema>
export type TradeAlertSeverity = z.infer<typeof tradeAlertSeveritySchema>
export type TradeAlertDirection = z.infer<typeof tradeAlertDirectionSchema>
export type TradingViewAlertPayload = z.infer<typeof tradingViewAlertPayloadSchema>
export type TradeAlertIngestionStatus = z.infer<typeof tradeAlertIngestionStatusSchema>
export type TradeAlertWebhookSetup = z.infer<typeof tradeAlertWebhookSetupSchema>
