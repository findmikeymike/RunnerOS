import { describe, expect, test } from 'bun:test'

import {
  ADAPTER_CERTIFICATION_EVIDENCE_SCHEMA_VERSION,
  adapterCertificationEvidenceSchema,
} from '../src/index.ts'

const scenario = {
  scenario_id: 'correct-account-and-environment' as const,
  status: 'pass' as const,
  observed_at: '2026-07-30T15:05:00.000Z',
  evidence_ref: 'evidence-account-match',
}

const capabilities = {
  read_accounts: true,
  read_orders: true,
  read_positions: true,
  read_executions: true,
  submit_market: true,
  submit_limit: true,
  submit_stop: false,
  submit_stop_limit: false,
  native_bracket: true,
  native_oco: true,
  modify_order: false,
  cancel_order: false,
  partial_close: false,
  flatten: false,
  streaming_events: false,
}

const evidence = {
  certification_schema_version: ADAPTER_CERTIFICATION_EVIDENCE_SCHEMA_VERSION,
  certification_id: 'cert-tradovate-paper',
  connection_id: 'connection-apex-paper',
  account_ref: 'account-apex-paper',
  provider_slug: 'tradovate',
  adapter_id: 'tradovate-api',
  adapter_version: '0.1.0',
  transport: 'api' as const,
  environment: 'paper' as const,
  provider_contract_version: 'tradovate-demo-rest-2026-07',
  started_at: '2026-07-30T15:00:00.000Z',
  completed_at: '2026-07-30T15:05:00.000Z',
  scenarios: [scenario],
  soak: {
    required_lifecycles: 50 as const,
    completed_lifecycles: 0,
    duplicate_submissions: 0,
    unprotected_positions: 0,
    unresolved_divergences: 0,
    incomplete_closes: 0,
    evidence_refs: [],
  },
  certified_capabilities: capabilities,
  eligible_certifications: ['read-certified' as const],
  blockers: ['paper-soak: 50 clean entry-to-close lifecycles required'],
  content_checksum: 'a'.repeat(64),
}

describe('adapter certification evidence contract', () => {
  test('accepts version-bound, checksum-bearing evidence', () => {
    expect(adapterCertificationEvidenceSchema.safeParse(evidence).success).toBe(true)
  })

  test('rejects duplicate scenario claims and oversized soak claims', () => {
    expect(adapterCertificationEvidenceSchema.safeParse({
      ...evidence,
      scenarios: [scenario, scenario],
    }).success).toBe(false)
    expect(adapterCertificationEvidenceSchema.safeParse({
      ...evidence,
      soak: { ...evidence.soak, completed_lifecycles: 51 },
    }).success).toBe(false)
  })
})
