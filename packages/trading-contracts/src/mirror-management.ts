import { z } from 'zod'

import { decimalStringSchema, identifierSchema, sha256Schema, utcTimestampSchema } from './common.ts'
import {
  discordManagementLogicalActionSchema,
  discordManagementMessageSchema,
  discordManagementResolutionStrategySchema,
} from './discord-management.ts'
import { executionManagementPayloadSchema } from './execution.ts'

export const MIRROR_MANAGEMENT_RECEIPT_SCHEMA_VERSION = 'mirror-management-receipt@1'
export const EXECUTION_NO_EXPOSURE_PROOF_SCHEMA_VERSION = 'execution-no-exposure-proof@1'
export const MIRROR_OWNERSHIP_RELEASE_JOURNAL_SCHEMA_VERSION = 'mirror-ownership-release-journal@1'

export const executionNoExposureProofSchema = z.object({
  proof_schema_version: z.literal(EXECUTION_NO_EXPOSURE_PROOF_SCHEMA_VERSION),
  proof_id: identifierSchema,
  intent_id: identifierSchema,
  connection_id: identifierSchema,
  account_ref: identifierSchema,
  account_snapshot_id: identifierSchema,
  account_snapshot_checksum: sha256Schema,
  execution_record_checksum: sha256Schema,
  positions_count: z.literal(0),
  working_orders_count: z.literal(0),
  captured_at: utcTimestampSchema,
  evidence_refs: z.array(identifierSchema).min(1).max(100),
  content_checksum: sha256Schema,
}).strict()

export const mirrorOwnershipReleaseJournalSchema = z.object({
  release_journal_schema_version: z.literal(MIRROR_OWNERSHIP_RELEASE_JOURNAL_SCHEMA_VERSION),
  journal_id: identifierSchema,
  mirror_execution_id: identifierSchema,
  intent_ids: z.array(identifierSchema).min(2).max(20),
  proofs: z.array(executionNoExposureProofSchema).min(2).max(20),
  state: z.enum(['prepared', 'released']),
  created_at: utcTimestampSchema,
  updated_at: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict().superRefine((journal, context) => {
  if (
    new Set(journal.intent_ids).size !== journal.intent_ids.length
    || new Set(journal.proofs.map((proof) => proof.intent_id)).size !== journal.proofs.length
    || journal.intent_ids.length !== journal.proofs.length
    || journal.intent_ids.some((intentId, index) => journal.proofs[index]?.intent_id !== intentId)
  ) {
    context.addIssue({
      code: 'custom', path: ['proofs'],
      message: 'Mirror ownership release journal requires one ordered proof per unique child intent',
    })
  }
})

export const mirrorManagementInstructionSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('partial-close'),
    sizing: z.discriminatedUnion('basis', [
      z.object({
        basis: z.literal('fraction'),
        fraction: z.number().positive().lt(1),
      }).strict(),
      z.object({
        basis: z.literal('quantity'),
        quantity: z.number().int().positive().max(10_000),
      }).strict(),
    ]),
    source_phrase: z.string().trim().min(1).max(500),
  }).strict(),
  z.object({
    operation: z.literal('flatten'),
    reason: z.string().trim().min(1).max(500),
    source_phrase: z.string().trim().min(1).max(500),
  }).strict(),
  z.object({
    operation: z.literal('move-stop'),
    target: z.discriminatedUnion('basis', [
      z.object({ basis: z.literal('breakeven') }).strict(),
      z.object({
        basis: z.literal('explicit'),
        price: decimalStringSchema.refine((value) => !value.startsWith('-') && value !== '0'),
      }).strict(),
    ]),
    source_phrase: z.string().trim().min(1).max(500),
  }).strict(),
  z.object({
    operation: z.literal('reconcile'),
    reason: z.literal('stopped-out'),
    source_phrase: z.string().trim().min(1).max(500),
  }).strict(),
])

export const mirrorManagementChildActionSchema = z.object({
  index: z.number().int().nonnegative().max(20),
  logical_action: discordManagementLogicalActionSchema,
  request_id: identifierSchema,
  concrete_payload: executionManagementPayloadSchema.optional(),
  status: z.enum(['pending', 'executing', 'completed', 'failed']),
  management_command_id: identifierSchema.optional(),
  gateway_receipt_id: identifierSchema.optional(),
  evidence_refs: z.array(identifierSchema).max(100).optional(),
  completed_at: utcTimestampSchema.optional(),
  error: z.string().trim().min(1).max(1_000).optional(),
}).strict().superRefine((action, context) => {
  if (action.status === 'completed' && (
    !action.completed_at
    || !action.gateway_receipt_id
    || !action.evidence_refs?.length
  )) {
    context.addIssue({
      code: 'custom', path: ['status'],
      message: 'Completed Mirror actions require time, gateway receipt, and evidence',
    })
  }
  if (
    action.status === 'completed'
    && action.logical_action.operation !== 'reconcile'
    && !action.management_command_id
  ) {
    context.addIssue({
      code: 'custom', path: ['management_command_id'],
      message: 'Completed Mirror mutations require a gateway command ID',
    })
  }
  if (
    action.logical_action.operation !== 'reconcile'
    && (action.status === 'executing' || action.status === 'completed')
    && !action.concrete_payload
  ) {
    context.addIssue({
      code: 'custom', path: ['concrete_payload'],
      message: 'Issued Mirror mutations require an exact concrete payload',
    })
  }
  if (action.status === 'failed' && !action.error) {
    context.addIssue({ code: 'custom', path: ['error'], message: 'Failed Mirror actions require an error' })
  }
})

export const mirrorManagementChildSchema = z.object({
  parent_child_index: z.number().int().nonnegative().max(19),
  member_id: identifierSchema,
  connection_id: identifierSchema,
  intent_id: identifierSchema,
  status: z.enum(['terminal', 'prepared', 'executing', 'completed', 'failed', 'blocked']),
  actions: z.array(mirrorManagementChildActionSchema).max(20),
  execution_record_checksum: sha256Schema.optional(),
  no_exposure_proof: executionNoExposureProofSchema.optional(),
  error: z.string().trim().min(1).max(1_000).optional(),
}).strict().superRefine((child, context) => {
  if ((child.status === 'failed' || child.status === 'blocked') && !child.error) {
    context.addIssue({ code: 'custom', path: ['error'], message: 'Failed Mirror children require an error' })
  }
  if (child.status === 'completed' && child.actions.some((action) => action.status !== 'completed')) {
    context.addIssue({ code: 'custom', path: ['actions'], message: 'Completed child actions must all complete' })
  }
  if (child.status === 'terminal' && child.actions.length > 0) {
    context.addIssue({ code: 'custom', path: ['actions'], message: 'Terminal children cannot receive actions' })
  }
  if ((child.status === 'completed' || child.status === 'terminal') && !child.execution_record_checksum) {
    context.addIssue({
      code: 'custom', path: ['execution_record_checksum'],
      message: 'Completed and terminal children require exact gateway record truth',
    })
  }
  if (child.status === 'terminal' && (
    !child.no_exposure_proof
    || child.no_exposure_proof.intent_id !== child.intent_id
    || child.no_exposure_proof.connection_id !== child.connection_id
    || child.no_exposure_proof.execution_record_checksum !== child.execution_record_checksum
  )) {
    context.addIssue({
      code: 'custom', path: ['no_exposure_proof'],
      message: 'Terminal children require a checksum-bound provider no-exposure proof',
    })
  }
  child.actions.forEach((action, index) => {
    if (action.index !== index) {
      context.addIssue({
        code: 'custom', path: ['actions', index, 'index'],
        message: 'Mirror child action indexes must be sequential',
      })
    }
  })
})

export const mirrorManagementReceiptSchema = z.object({
  mirror_management_receipt_schema_version: z.literal(MIRROR_MANAGEMENT_RECEIPT_SCHEMA_VERSION),
  receipt_id: identifierSchema,
  source_message: discordManagementMessageSchema,
  resolution_strategy: discordManagementResolutionStrategySchema.optional(),
  candidate_mirror_execution_ids: z.array(identifierSchema).max(100),
  mirror_execution_id: identifierSchema.optional(),
  symbol_evidence: identifierSchema.optional(),
  status: z.enum([
    'blocked', 'deferred', 'prepared', 'executing', 'completed', 'partial', 'halted',
  ]),
  logical_actions: z.array(mirrorManagementInstructionSchema).max(20),
  children: z.array(mirrorManagementChildSchema).max(20),
  evidence: z.array(z.string().trim().min(1).max(500)).max(100),
  error: z.string().trim().min(1).max(1_000).optional(),
  created_at: utcTimestampSchema,
  updated_at: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict().superRefine((receipt, context) => {
  if (
    ['prepared', 'executing', 'completed', 'partial', 'halted'].includes(receipt.status)
    && !receipt.mirror_execution_id
  ) {
    context.addIssue({
      code: 'custom', path: ['mirror_execution_id'],
      message: 'Actionable Mirror management requires one resolved parent',
    })
  }
  if (
    ['blocked', 'deferred', 'partial', 'halted'].includes(receipt.status)
    && !receipt.error
  ) {
    context.addIssue({ code: 'custom', path: ['error'], message: 'Non-complete Mirror receipts require an error' })
  }
  if (receipt.status === 'completed' && receipt.children.some((child) => (
    child.status !== 'completed' && child.status !== 'terminal'
  ))) {
    context.addIssue({ code: 'custom', path: ['children'], message: 'Completed parent requires safe child completion' })
  }
  receipt.children.forEach((child, index) => {
    if (child.parent_child_index !== index) {
      context.addIssue({
        code: 'custom', path: ['children', index, 'parent_child_index'],
        message: 'Mirror children must retain frozen parent order',
      })
    }
    if (child.status !== 'terminal' && child.actions.length !== receipt.logical_actions.length) {
      context.addIssue({
        code: 'custom', path: ['children', index, 'actions'],
        message: 'Every active child must persist the complete logical action matrix',
      })
    }
    child.actions.forEach((action, actionIndex) => {
      const instruction = receipt.logical_actions[actionIndex]
      let matches = false
      if (
        instruction
        && action.logical_action.operation === instruction.operation
        && action.logical_action.source_phrase === instruction.source_phrase
      ) {
        if (instruction.operation === 'partial-close' && action.logical_action.operation === 'partial-close') {
          matches = instruction.sizing.basis === 'fraction'
            || action.logical_action.quantity === instruction.sizing.quantity
        } else {
          matches = JSON.stringify(action.logical_action) === JSON.stringify(instruction)
        }
      }
      if (!matches) {
        context.addIssue({
          code: 'custom', path: ['children', index, 'actions', actionIndex, 'logical_action'],
          message: 'Child logical actions must match the frozen parent action order',
        })
      }
    })
  })
  if (Date.parse(receipt.updated_at) < Date.parse(receipt.created_at)) {
    context.addIssue({ code: 'custom', path: ['updated_at'], message: 'Receipt update cannot precede creation' })
  }
})

export type MirrorManagementChildAction = z.infer<typeof mirrorManagementChildActionSchema>
export type MirrorManagementChild = z.infer<typeof mirrorManagementChildSchema>
export type MirrorManagementReceipt = z.infer<typeof mirrorManagementReceiptSchema>
export type ExecutionNoExposureProof = z.infer<typeof executionNoExposureProofSchema>
export type MirrorOwnershipReleaseJournal = z.infer<typeof mirrorOwnershipReleaseJournalSchema>
export type MirrorManagementInstruction = z.infer<typeof mirrorManagementInstructionSchema>
