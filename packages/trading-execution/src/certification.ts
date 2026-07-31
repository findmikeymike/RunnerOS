import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  ADAPTER_CERTIFICATION_EVIDENCE_SCHEMA_VERSION,
  adapterCertificationEvidenceSchema,
  type AdapterCertificationEvidence,
  type CertificationScenarioId,
  type CertificationScenarioResult,
  type ExecutionCapabilities,
  type ExecutionEnvironment,
  type ExecutionTransport,
} from '@trade-god/contracts'

import { canonicalJson, sha256 } from './canonical.ts'

export const COMMON_CERTIFICATION_SCENARIOS = [
  'correct-account-and-environment',
  'wrong-account-rejected',
  'wrong-environment-rejected',
  'expired-auth-rejected',
  'stale-or-mismatched-auth-rejected',
  'duplicate-submit-suppressed',
  'provider-rejection-http-200-detected',
  'network-loss-before-send-safe',
  'network-loss-after-send-no-retry',
  'full-fill-reconciled',
  'partial-fill-reconciled',
  'no-fill-reconciled',
  'bracket-or-protection-failure-contained',
  'cancel-failure-contained',
  'modify-failure-contained',
  'partial-close-failure-contained',
  'flatten-failure-contained',
  'restart-in-flight-recovered',
  'provider-divergence-contained',
  'daily-loss-limit-blocked',
  'trailing-drawdown-blocked',
  'cutoff-or-rollover-blocked',
] as const satisfies readonly CertificationScenarioId[]

export const BROWSER_CERTIFICATION_SCENARIOS = [
  'missing-browser-confirmation-unresolved',
  'selector-drift-blocked',
] as const satisfies readonly CertificationScenarioId[]

export const requiredCertificationScenarios = (
  transport: ExecutionTransport,
): CertificationScenarioId[] => [
  ...COMMON_CERTIFICATION_SCENARIOS,
  ...(transport === 'browser' ? BROWSER_CERTIFICATION_SCENARIOS : []),
]

export interface CertificationScenarioObservation {
  status: 'pass' | 'fail' | 'blocked'
  evidence_ref: string
  detail?: string
}

export interface PaperLifecycleObservation {
  entry_submissions: number
  protected_throughout: boolean
  divergence_resolved: boolean
  closed: boolean
  evidence_ref: string
}

export interface AdapterCertificationRunner {
  readonly connection_id: string
  readonly account_ref: string
  readonly provider_slug: string
  readonly adapter_id: string
  readonly adapter_version: string
  readonly transport: ExecutionTransport
  readonly environment: ExecutionEnvironment
  readonly provider_contract_version: string
  readonly certified_capabilities: ExecutionCapabilities
  runScenario(scenarioId: CertificationScenarioId): Promise<CertificationScenarioObservation>
  runPaperLifecycle(iteration: number): Promise<PaperLifecycleObservation>
}

export const computeAdapterCertificationChecksum = (
  evidence: Omit<AdapterCertificationEvidence, 'content_checksum'> | AdapterCertificationEvidence,
): string => {
  const { content_checksum: _ignored, ...payload } = evidence as AdapterCertificationEvidence
  return sha256(payload)
}

const parseVerifiedEvidence = (input: unknown): AdapterCertificationEvidence => {
  const evidence = adapterCertificationEvidenceSchema.parse(input)
  if (computeAdapterCertificationChecksum(evidence) !== evidence.content_checksum) {
    throw new Error(`Certification evidence ${evidence.certification_id} failed checksum validation.`)
  }
  const expected = deriveCertificationOutcome(evidence)
  if (canonicalJson(expected.eligible_certifications) !== canonicalJson(evidence.eligible_certifications)) {
    throw new Error(`Certification evidence ${evidence.certification_id} overstates eligibility.`)
  }
  if (canonicalJson(expected.blockers) !== canonicalJson(evidence.blockers)) {
    throw new Error(`Certification evidence ${evidence.certification_id} has inconsistent blockers.`)
  }
  return evidence
}

export const deriveCertificationOutcome = (
  evidence: Pick<
    AdapterCertificationEvidence,
    'environment' | 'transport' | 'scenarios' | 'soak' | 'certified_capabilities'
  >,
): Pick<AdapterCertificationEvidence, 'eligible_certifications' | 'blockers'> => {
  const results = new Map(evidence.scenarios.map((scenario) => [scenario.scenario_id, scenario]))
  const required = requiredCertificationScenarios(evidence.transport)
  const blockers = required.flatMap((scenarioId) => {
    const result = results.get(scenarioId)
    if (!result) return [`${scenarioId}: missing`]
    return result.status === 'pass' ? [] : [`${scenarioId}: ${result.status}`]
  })
  const cleanSoak = (
    evidence.soak.completed_lifecycles === evidence.soak.required_lifecycles
    && evidence.soak.evidence_refs.length === evidence.soak.required_lifecycles
    && evidence.soak.duplicate_submissions === 0
    && evidence.soak.unprotected_positions === 0
    && evidence.soak.unresolved_divergences === 0
    && evidence.soak.incomplete_closes === 0
  )
  if (!cleanSoak) blockers.push('paper-soak: 50 clean entry-to-close lifecycles required')
  const lifecycleCapabilities: Array<keyof ExecutionCapabilities> = [
    'cancel_order',
    'modify_order',
    'partial_close',
    'flatten',
  ]
  const lifecycleCapabilitiesPass = lifecycleCapabilities.every(
    (capability) => evidence.certified_capabilities[capability],
  )
  for (const capability of lifecycleCapabilities) {
    if (!evidence.certified_capabilities[capability]) {
      blockers.push(`capability-${capability}: unavailable`)
    }
  }

  const readScenarioIds: CertificationScenarioId[] = [
    'correct-account-and-environment',
    'wrong-account-rejected',
    'wrong-environment-rejected',
  ]
  const readCertified = readScenarioIds.every((id) => results.get(id)?.status === 'pass')
  const allScenariosPass = required.every((id) => results.get(id)?.status === 'pass')
  const eligible: AdapterCertificationEvidence['eligible_certifications'] = []
  if (readCertified) eligible.push('read-certified')
  if (
    evidence.environment === 'paper'
    && allScenariosPass
    && lifecycleCapabilitiesPass
    && cleanSoak
  ) {
    eligible.push('paper-entry-certified', 'paper-lifecycle-certified')
  }
  return { eligible_certifications: eligible, blockers }
}

export const runAdapterCertification = async (
  runner: AdapterCertificationRunner,
  now: () => string = () => new Date().toISOString(),
): Promise<AdapterCertificationEvidence> => {
  const startedAt = now()
  const scenarios: CertificationScenarioResult[] = []
  for (const scenarioId of requiredCertificationScenarios(runner.transport)) {
    const observation = await runner.runScenario(scenarioId)
    scenarios.push({
      scenario_id: scenarioId,
      status: observation.status,
      observed_at: now(),
      evidence_ref: observation.evidence_ref,
      ...(observation.detail ? { detail: observation.detail } : {}),
    })
  }

  const observations: PaperLifecycleObservation[] = []
  for (let iteration = 1; iteration <= 50; iteration += 1) {
    observations.push(await runner.runPaperLifecycle(iteration))
  }
  const soak = {
    required_lifecycles: 50 as const,
    completed_lifecycles: observations.length,
    duplicate_submissions: observations.reduce(
      (count, result) => count + Math.max(0, result.entry_submissions - 1),
      0,
    ),
    unprotected_positions: observations.filter((result) => !result.protected_throughout).length,
    unresolved_divergences: observations.filter((result) => !result.divergence_resolved).length,
    incomplete_closes: observations.filter((result) => !result.closed).length,
    evidence_refs: observations.map((result) => result.evidence_ref),
  }
  const outcome = deriveCertificationOutcome({
    environment: runner.environment,
    transport: runner.transport,
    scenarios,
    soak,
    certified_capabilities: runner.certified_capabilities,
  })
  const withoutChecksum = {
    certification_schema_version: ADAPTER_CERTIFICATION_EVIDENCE_SCHEMA_VERSION,
    certification_id: `cert-${randomUUID()}`,
    connection_id: runner.connection_id,
    account_ref: runner.account_ref,
    provider_slug: runner.provider_slug,
    adapter_id: runner.adapter_id,
    adapter_version: runner.adapter_version,
    transport: runner.transport,
    environment: runner.environment,
    provider_contract_version: runner.provider_contract_version,
    started_at: startedAt,
    completed_at: now(),
    scenarios,
    soak,
    certified_capabilities: runner.certified_capabilities,
    ...outcome,
  }
  return adapterCertificationEvidenceSchema.parse({
    ...withoutChecksum,
    content_checksum: computeAdapterCertificationChecksum(
      withoutChecksum as Omit<AdapterCertificationEvidence, 'content_checksum'>,
    ),
  })
}

interface CertificationStoreFile {
  certification_store_schema_version: 'adapter-certification-store@1'
  evidence: AdapterCertificationEvidence[]
  updated_at: string
}

export class FileAdapterCertificationStore {
  private readonly file: string
  private queue: Promise<void> = Promise.resolve()

  constructor(
    root: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.file = path.join(root, 'adapter-certifications.json')
  }

  async list(connectionId?: string): Promise<AdapterCertificationEvidence[]> {
    return (await this.read()).evidence
      .filter((evidence) => !connectionId || evidence.connection_id === connectionId)
      .map((evidence) => structuredClone(evidence))
      .sort((left, right) => right.completed_at.localeCompare(left.completed_at))
  }

  async get(certificationId: string): Promise<AdapterCertificationEvidence> {
    const evidence = (await this.read()).evidence.find(
      (candidate) => candidate.certification_id === certificationId,
    )
    if (!evidence) throw new Error(`Certification evidence ${certificationId} was not found.`)
    return structuredClone(evidence)
  }

  async save(input: AdapterCertificationEvidence): Promise<AdapterCertificationEvidence> {
    const evidence = parseVerifiedEvidence(input)
    return this.withLock(async () => {
      const current = await this.read()
      const existing = current.evidence.find(
        (candidate) => candidate.certification_id === evidence.certification_id,
      )
      if (existing && canonicalJson(existing) !== canonicalJson(evidence)) {
        throw new Error(`Certification evidence ${evidence.certification_id} is immutable.`)
      }
      if (!existing) {
        await this.write({
          certification_store_schema_version: 'adapter-certification-store@1',
          evidence: [...current.evidence, evidence],
          updated_at: this.now(),
        })
      }
      return structuredClone(evidence)
    })
  }

  private async read(): Promise<CertificationStoreFile> {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as Partial<CertificationStoreFile>
      if (
        parsed.certification_store_schema_version !== 'adapter-certification-store@1'
        || !Array.isArray(parsed.evidence)
        || typeof parsed.updated_at !== 'string'
        || !Number.isFinite(Date.parse(parsed.updated_at))
      ) {
        throw new Error('Adapter certification store is invalid.')
      }
      return {
        certification_store_schema_version: parsed.certification_store_schema_version,
        evidence: parsed.evidence.map(parseVerifiedEvidence),
        updated_at: parsed.updated_at,
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {
          certification_store_schema_version: 'adapter-certification-store@1',
          evidence: [],
          updated_at: this.now(),
        }
      }
      throw error
    }
  }

  private async write(store: CertificationStoreFile): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    await rename(temporary, this.file)
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue
    let release!: () => void
    this.queue = previous.catch(() => undefined).then(() => new Promise<void>((resolve) => {
      release = resolve
    }))
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
    }
  }
}
