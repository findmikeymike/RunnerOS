import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type {
  CertificationScenarioId,
  ExecutionCapabilities,
} from '@trade-god/contracts'

import {
  FileAdapterCertificationStore,
  runAdapterCertification,
  type AdapterCertificationRunner,
  type CertificationScenarioObservation,
  type PaperLifecycleObservation,
} from '../src/index.ts'

const roots: string[] = []
const NOW = '2026-07-30T15:05:00.000Z'

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const capabilities: ExecutionCapabilities = {
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
  modify_order: true,
  cancel_order: true,
  partial_close: true,
  flatten: true,
  streaming_events: false,
}

class Runner implements AdapterCertificationRunner {
  readonly connection_id = 'connection-apex-paper'
  readonly account_ref = 'account-apex-paper'
  readonly provider_slug = 'tradovate'
  readonly adapter_id = 'tradovate-api'
  readonly adapter_version = '0.1.0'
  readonly transport = 'api' as const
  readonly environment = 'paper' as const
  readonly provider_contract_version = 'tradovate-demo-rest-2026-07'
  readonly certified_capabilities = capabilities

  constructor(
    private readonly observeScenario: (
      scenarioId: CertificationScenarioId,
    ) => CertificationScenarioObservation = (scenarioId) => ({
      status: 'pass',
      evidence_ref: `evidence-${scenarioId}`,
    }),
    private readonly observeLifecycle: (
      iteration: number,
    ) => PaperLifecycleObservation = (iteration) => ({
      entry_submissions: 1,
      protected_throughout: true,
      divergence_resolved: true,
      closed: true,
      evidence_ref: `lifecycle-${iteration}`,
    }),
  ) {}

  async runScenario(scenarioId: CertificationScenarioId) {
    return this.observeScenario(scenarioId)
  }

  async runPaperLifecycle(iteration: number) {
    return this.observeLifecycle(iteration)
  }
}

describe('adapter certification', () => {
  test('requires every forced failure scenario and 50 clean paper lifecycles', async () => {
    const evidence = await runAdapterCertification(new Runner(), () => NOW)

    expect(evidence.scenarios).toHaveLength(22)
    expect(evidence.soak.completed_lifecycles).toBe(50)
    expect(evidence.eligible_certifications).toEqual([
      'read-certified',
      'paper-entry-certified',
      'paper-lifecycle-certified',
    ])
    expect(evidence.blockers).toEqual([])
  })

  test('blocks lifecycle certification on unsupported operations', async () => {
    const unsupported = new Set<CertificationScenarioId>([
      'cancel-failure-contained',
      'modify-failure-contained',
      'partial-close-failure-contained',
      'flatten-failure-contained',
    ])
    const evidence = await runAdapterCertification(new Runner((scenarioId) => ({
      status: unsupported.has(scenarioId) ? 'blocked' : 'pass',
      evidence_ref: `evidence-${scenarioId}`,
    })), () => NOW)

    expect(evidence.eligible_certifications).toEqual(['read-certified'])
    expect(evidence.blockers).toContain('flatten-failure-contained: blocked')
  })

  test('cannot certify a lifecycle when the advertised adapter lacks a management capability', async () => {
    const runner = new Runner()
    Object.defineProperty(runner, 'certified_capabilities', {
      value: { ...capabilities, partial_close: false },
    })
    const evidence = await runAdapterCertification(runner, () => NOW)

    expect(evidence.eligible_certifications).toEqual(['read-certified'])
    expect(evidence.blockers).toContain('capability-partial_close: unavailable')
  })

  test('blocks certification on duplicate, unprotected, divergent, or incomplete lifecycle evidence', async () => {
    const evidence = await runAdapterCertification(new Runner(
      undefined,
      (iteration) => ({
        entry_submissions: iteration === 1 ? 2 : 1,
        protected_throughout: iteration !== 2,
        divergence_resolved: iteration !== 3,
        closed: iteration !== 4,
        evidence_ref: `lifecycle-${iteration}`,
      }),
    ), () => NOW)

    expect(evidence.eligible_certifications).toEqual(['read-certified'])
    expect(evidence.soak).toMatchObject({
      duplicate_submissions: 1,
      unprotected_positions: 1,
      unresolved_divergences: 1,
      incomplete_closes: 1,
    })
  })

  test('requires browser confirmation and selector-drift scenarios for browser transport', async () => {
    const runner = new Runner()
    Object.defineProperty(runner, 'transport', { value: 'browser' })
    const evidence = await runAdapterCertification(runner, () => NOW)

    expect(evidence.scenarios.map((result) => result.scenario_id)).toContain(
      'missing-browser-confirmation-unresolved',
    )
    expect(evidence.scenarios.map((result) => result.scenario_id)).toContain(
      'selector-drift-blocked',
    )
  })

  test('persists immutable evidence and detects tampering after restart', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'trade-god-certification-'))
    roots.push(root)
    const evidence = await runAdapterCertification(new Runner(), () => NOW)
    const first = new FileAdapterCertificationStore(root, () => NOW)
    await first.save(evidence)
    expect(await first.get(evidence.certification_id)).toEqual(evidence)

    const file = path.join(root, 'adapter-certifications.json')
    const tampered = (await readFile(file, 'utf8')).replace(
      '"completed_lifecycles": 50',
      '"completed_lifecycles": 49',
    )
    await writeFile(file, tampered)

    const restarted = new FileAdapterCertificationStore(root, () => NOW)
    await expect(restarted.list()).rejects.toThrow('checksum validation')
  })
})
