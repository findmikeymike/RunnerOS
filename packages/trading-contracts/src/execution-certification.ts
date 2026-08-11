import { z } from 'zod'

import {
  identifierSchema,
  semverSchema,
  sha256Schema,
  utcTimestampSchema,
} from './common.ts'
import {
  executionCapabilitiesSchema,
  executionCertificationSchema,
  executionEnvironmentSchema,
  executionTransportSchema,
} from './execution.ts'

export const ADAPTER_CERTIFICATION_EVIDENCE_SCHEMA_VERSION = 'adapter-certification-evidence@1'

export const certificationScenarioIdSchema = z.enum([
  'correct-account-and-environment',
  'wrong-account-rejected',
  'wrong-environment-rejected',
  'expired-auth-rejected',
  'stale-or-mismatched-auth-rejected',
  'duplicate-submit-suppressed',
  'provider-rejection-http-200-detected',
  'network-loss-before-send-safe',
  'network-loss-after-send-no-retry',
  'missing-browser-confirmation-unresolved',
  'selector-drift-blocked',
  'full-fill-reconciled',
  'partial-fill-reconciled',
  'no-fill-reconciled',
  'bracket-or-protection-failure-contained',
  'multi-bracket-failure-contained',
  'multi-bracket-protected-lifecycle',
  'cancel-failure-contained',
  'modify-failure-contained',
  'partial-close-failure-contained',
  'flatten-failure-contained',
  'restart-in-flight-recovered',
  'provider-divergence-contained',
  'daily-loss-limit-blocked',
  'trailing-drawdown-blocked',
  'cutoff-or-rollover-blocked',
])

export const certificationScenarioResultSchema = z.object({
  scenario_id: certificationScenarioIdSchema,
  status: z.enum(['pass', 'fail', 'blocked']),
  observed_at: utcTimestampSchema,
  evidence_ref: identifierSchema,
  detail: z.string().trim().min(1).max(500).optional(),
}).strict()

export const adapterCertificationEvidenceSchema = z.object({
  certification_schema_version: z.literal(ADAPTER_CERTIFICATION_EVIDENCE_SCHEMA_VERSION),
  certification_id: identifierSchema,
  connection_id: identifierSchema,
  account_ref: identifierSchema,
  provider_slug: identifierSchema,
  adapter_id: identifierSchema,
  adapter_version: semverSchema,
  transport: executionTransportSchema,
  environment: executionEnvironmentSchema,
  provider_contract_version: z.string().trim().min(1).max(120),
  started_at: utcTimestampSchema,
  completed_at: utcTimestampSchema,
  scenarios: z.array(certificationScenarioResultSchema).max(30),
  soak: z.object({
    required_lifecycles: z.literal(50),
    completed_lifecycles: z.number().int().min(0).max(50),
    duplicate_submissions: z.number().int().nonnegative(),
    unprotected_positions: z.number().int().nonnegative(),
    unresolved_divergences: z.number().int().nonnegative(),
    incomplete_closes: z.number().int().nonnegative(),
    evidence_refs: z.array(identifierSchema).max(50),
  }).strict(),
  certified_capabilities: executionCapabilitiesSchema,
  eligible_certifications: z.array(executionCertificationSchema).max(5),
  blockers: z.array(z.string().trim().min(1).max(500)).max(30),
  content_checksum: sha256Schema,
}).strict().superRefine((evidence, context) => {
  if (Date.parse(evidence.completed_at) < Date.parse(evidence.started_at)) {
    context.addIssue({
      code: 'custom',
      path: ['completed_at'],
      message: 'Certification completion cannot precede its start',
    })
  }
  const scenarioIds = evidence.scenarios.map((result) => result.scenario_id)
  if (new Set(scenarioIds).size !== scenarioIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['scenarios'],
      message: 'Certification scenarios must be unique',
    })
  }
})

export type CertificationScenarioId = z.infer<typeof certificationScenarioIdSchema>
export type CertificationScenarioResult = z.infer<typeof certificationScenarioResultSchema>
export type AdapterCertificationEvidence = z.infer<typeof adapterCertificationEvidenceSchema>
