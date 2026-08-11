import { z } from 'zod'

import { identifierSchema, sha256Schema, utcTimestampSchema } from './common.ts'
import {
  discordManagementMessageSchema,
  discordManagementResolutionStrategySchema,
} from './discord-management.ts'

export const DISCORD_MANAGEMENT_FAMILY_RECEIPT_SCHEMA_VERSION = 'discord-management-family-receipt@1'

export const discordManagementFamilyTargetSchema = z.discriminatedUnion('family', [
  z.object({ family: z.literal('single'), intent_id: identifierSchema }).strict(),
  z.object({ family: z.literal('mirror'), mirror_execution_id: identifierSchema }).strict(),
])

export const discordManagementFamilyReceiptSchema = z.object({
  family_receipt_schema_version: z.literal(DISCORD_MANAGEMENT_FAMILY_RECEIPT_SCHEMA_VERSION),
  receipt_id: identifierSchema,
  source_message: discordManagementMessageSchema,
  status: z.enum(['resolved', 'blocked', 'deferred']),
  candidates: z.array(discordManagementFamilyTargetSchema).max(200),
  target: discordManagementFamilyTargetSchema.optional(),
  resolution_strategy: discordManagementResolutionStrategySchema.optional(),
  evidence: z.array(z.string().trim().min(1).max(500)).max(100),
  error: z.string().trim().min(1).max(1_000).optional(),
  created_at: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict().superRefine((receipt, context) => {
  if (receipt.status === 'resolved' && (!receipt.target || !receipt.resolution_strategy)) {
    context.addIssue({
      code: 'custom', path: ['target'],
      message: 'Resolved Discord management requires one frozen family target and strategy',
    })
  }
  if (receipt.status !== 'resolved' && !receipt.error) {
    context.addIssue({
      code: 'custom', path: ['error'],
      message: 'Blocked or deferred family resolution requires a reason',
    })
  }
})

export type DiscordManagementFamilyTarget = z.infer<typeof discordManagementFamilyTargetSchema>
export type DiscordManagementFamilyReceipt = z.infer<typeof discordManagementFamilyReceiptSchema>
