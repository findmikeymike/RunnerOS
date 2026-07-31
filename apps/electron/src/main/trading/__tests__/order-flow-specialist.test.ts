import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { CANONICAL_ORDER_FLOW_CONFIGURATION } from '@trade-god/contracts'
import { loadEsDemoFixture } from '@trade-god/testkit'

import { createTradeGodRuntime } from '../trading-runtime.ts'
import type { SpecialistModel } from '../order-flow-specialist.ts'
import { evaluateOrderFlowInterpretation } from '../order-flow-specialist-evaluation.ts'

class FakeIpcMain {
  readonly handlers = new Map<string, (...args: any[]) => any>()
  handle(channel: string, handler: (...args: any[]) => any): void { this.handlers.set(channel, handler) }
  removeHandler(channel: string): void { this.handlers.delete(channel) }
}

const repoRoot = path.resolve(import.meta.dir, '../../../../../..')

function validModel(mutate?: (output: any, prompt: any) => void): SpecialistModel {
  return async (request) => {
    const prompt = JSON.parse(request.prompt)
    if (!prompt.output_contract || prompt.doctrine?.sha256 !== prompt.immutable_output_identity.agent.doctrine_sha256) {
      throw new Error('Specialist prompt is missing its versioned doctrine or output contract.')
    }
    if (!prompt.allowed_evidence_refs?.includes('artifact:summary.delta') || !prompt.allowed_evidence_refs?.includes('snapshot:current')) {
      throw new Error('Specialist prompt is missing its exact evidence-reference allowlist.')
    }
    const output = {
      ...prompt.immutable_output_identity,
      status: 'analyzed',
      model: { provider_model: 'scripted-eval-model' },
      quality: {
        state: 'limited', ...prompt.feed_capabilities,
        limitations: ['Four trades are sufficient for plumbing evaluation only, not a robust market conclusion.'],
      },
      measurements: prompt.deterministic_measurements,
      observations: [{
        statement: 'Observed buyer-aggressed volume exceeds seller-aggressed volume in the supplied sample.',
        evidence_refs: ['artifact:summary.buy_volume', 'artifact:summary.sell_volume', 'artifact:summary.delta'],
      }],
      thesis: {
        classification: 'indeterminate', confidence: 0.2,
        rationale: 'Positive delta exists, but four prints and trades-only data cannot establish persistence or absorption.',
      },
      alternative_hypotheses: [{
        hypothesis: 'The positive delta is transient noise in a balanced auction.',
        disconfirming_evidence: 'A larger fresh sample showing persistent positive delta with upward price response would weaken this alternative.',
      }],
      scenarios: [{
        name: 'conditional-continuation',
        condition: {
          signal: 'delta', state: 'positive',
          evidence_refs: ['artifact:summary.delta', 'snapshot:current'],
        },
        invalidation: {
          signal: 'delta', state: 'negative',
          evidence_refs: ['artifact:summary.delta', 'snapshot:current'],
        },
        expires: 'next-context-refresh',
      }],
      no_trade_reasons: ['Sample is too small and lacks depth-of-book evidence.'],
      warnings: ['No inference about spoofing, absorption, or hidden liquidity is supported.'],
    }
    mutate?.(output, prompt)
    return { text: JSON.stringify(output), model: 'scripted-eval-model' }
  }
}

async function runFixture(
  model: SpecialistModel,
  watermarkNs = '1783780230000000000',
  sessionWindow?: Awaited<ReturnType<typeof loadEsDemoFixture>>['manifest']['session_window'],
) {
  const root = mkdtempSync(path.join(tmpdir(), 'trade-god-specialist-'))
  const runtime = createTradeGodRuntime({
    ipcMain: new FakeIpcMain(), rootCandidates: [repoRoot], runtimeExecutable: process.execPath,
    now: () => new Date().toISOString(), contextDirectory: path.join(root, 'context'),
    interpretationDirectory: path.join(root, 'interpretations'), specialistModel: model,
  })
  const fixture = await loadEsDemoFixture()
  const operation = runtime.orderFlowSpecialistPipeline!.interpretFixture({
    analysis: {
      fixture: { id: fixture.manifest.fixture_id, sha256: fixture.manifest.events_sha256 },
      instrument: fixture.manifest.instrument, session: fixture.manifest.session,
      analysis: CANONICAL_ORDER_FLOW_CONFIGURATION, timeoutMs: 5_000, traceId: 'trace-specialist-e2e',
    },
    context: {
      snapshotId: 'snapshot-specialist-e2e',
      intervalNs: '20000000000', watermarkNs, staleAfterNs: '5000000000',
      sessionWindow: sessionWindow ?? fixture.manifest.session_window,
      recentTradeLimit: 4, closedCandleLimit: 2,
    },
    assignment: { question: 'What does this evidence support?', horizon: 'immediate' },
  })
  return { root, runtime, operation }
}

describe('OrderFlowSpecialist', () => {
  test('joins real deterministic sidecars, resolves addressed context, validates the model, and stores output', async () => {
    const { root, runtime, operation } = await runFixture(validModel())
    try {
      const output = await operation
      expect(output).toMatchObject({
        status: 'analyzed', trace_id: 'trace-specialist-e2e',
        measurements: { total_volume: '28', buy_volume: '17', sell_volume: '11', delta: '6' },
        authority: { execution_allowed: false, order_submission_allowed: false, trade_instruction_provided: false },
        thesis: { classification: 'indeterminate', confidence: 0.2 },
      })
      expect(readdirSync(path.join(root, 'interpretations'))).toHaveLength(1)
      expect(evaluateOrderFlowInterpretation(output)).toMatchObject({ passed: true, score: 6, threshold: 6 })
    } finally {
      await runtime.dispose(); rmSync(root, { recursive: true, force: true })
    }
  })

  test('rejects a model that changes a deterministic measurement', async () => {
    const { root, runtime, operation } = await runFixture(validModel((output) => { output.measurements.delta = '999' }))
    try {
      await expect(operation).rejects.toThrow('changed deterministic measurements')
    } finally {
      await runtime.dispose(); rmSync(root, { recursive: true, force: true })
    }
  })

  test('rejects invented evidence references', async () => {
    const { root, runtime, operation } = await runFixture(validModel((output) => { output.observations[0].evidence_refs = ['broker:secret-order'] }))
    try {
      await expect(operation).rejects.toThrow('cited unknown evidence')
    } finally {
      await runtime.dispose(); rmSync(root, { recursive: true, force: true })
    }
  })

  test('accepts exact trade and candle IDs that exist in the supplied snapshot', async () => {
    const { root, runtime, operation } = await runFixture(validModel((output, prompt) => {
      output.observations[0].evidence_refs = [
        prompt.snapshot.trades.events[0].event_id,
        prompt.snapshot.candles.closed[0].candle_id,
      ]
    }))
    try {
      await expect(operation).resolves.toMatchObject({ status: 'analyzed' })
    } finally {
      await runtime.dispose(); rmSync(root, { recursive: true, force: true })
    }
  })

  test('allows descriptive measurements and buy-volume terminology in analyst prose', async () => {
    const { root, runtime, operation } = await runFixture(validModel((output) => {
      output.observations[0].statement = 'Buy volume at 17 exceeded sell volume at 11; 2 sell events occurred at supplied prices.'
    }))
    try {
      await expect(operation).resolves.toMatchObject({ status: 'analyzed' })
    } finally {
      await runtime.dispose(); rmSync(root, { recursive: true, force: true })
    }
  })

  test('rejects false confidence on a deterministically limited sample', async () => {
    const { root, runtime, operation } = await runFixture(validModel((output) => { output.thesis.confidence = 0.9 }))
    try {
      await expect(operation).rejects.toThrow('Limited evidence requires')
    } finally {
      await runtime.dispose(); rmSync(root, { recursive: true, force: true })
    }
  })

  test('rejects a model-created interpretation identity', async () => {
    const { root, runtime, operation } = await runFixture(validModel((output) => { output.interpretation_id = 'model-owned-id' }))
    try {
      await expect(operation).rejects.toThrow('changed immutable interpretation_id')
    } finally {
      await runtime.dispose(); rmSync(root, { recursive: true, force: true })
    }
  })

  test('rejects actionable execution language despite a false analysis-only flag', async () => {
    const { root, runtime, operation } = await runFixture(validModel((output) => {
      output.thesis.rationale = 'Buy ES now at 5592.25.'
    }))
    try {
      await expect(operation).rejects.toThrow('prohibited execution instruction')
    } finally {
      await runtime.dispose(); rmSync(root, { recursive: true, force: true })
    }
  })

  test.each([
    'Open a long ES position at 5592.25.',
    'Short ES at 5592.',
    'Hold a long position now.',
    'Acquire ES immediately.',
    'Liquidate the position immediately.',
  ])('rejects action-policy bypass wording: %s', async (instruction) => {
    const { root, runtime, operation } = await runFixture(validModel((output) => {
      output.thesis.rationale = instruction
    }))
    try {
      await expect(operation).rejects.toThrow('prohibited execution instruction')
    } finally {
      await runtime.dispose(); rmSync(root, { recursive: true, force: true })
    }
  })

  test('rejects invented scenario evidence references', async () => {
    const { root, runtime, operation } = await runFixture(validModel((output) => {
      output.scenarios[0].condition.evidence_refs = ['broker:position']
    }))
    try {
      await expect(operation).rejects.toThrow('cited unknown scenario evidence')
    } finally {
      await runtime.dispose(); rmSync(root, { recursive: true, force: true })
    }
  })

  test('rejects impossible signal and state combinations', async () => {
    const { root, runtime, operation } = await runFixture(validModel((output) => {
      output.scenarios[0].condition = {
        signal: 'freshness', state: 'positive', evidence_refs: ['snapshot:freshness'],
      }
    }))
    try {
      await expect(operation).rejects.toThrow()
    } finally {
      await runtime.dispose(); rmSync(root, { recursive: true, force: true })
    }
  })

  test('refuses stale evidence before calling a model', async () => {
    let calls = 0
    const model = validModel()
    const { root, runtime, operation } = await runFixture(async (request) => { calls += 1; return model(request) }, '1783780240000000000')
    try {
      expect(await operation).toMatchObject({ status: 'refused', refusal: { code: 'context-not-fresh' } })
      expect(calls).toBe(0)
    } finally {
      await runtime.dispose(); rmSync(root, { recursive: true, force: true })
    }
  })

  test('refuses evidence outside the declared session before calling a model', async () => {
    let calls = 0
    const model = validModel()
    const fixture = await loadEsDemoFixture()
    const { root, runtime, operation } = await runFixture(
      async (request) => { calls += 1; return model(request) },
      '1783780230000000000',
      {
        ...fixture.manifest.session_window,
        segments: [{ open_ns: '1783780000000000000', close_ns: '1783780210000000000' }],
      },
    )
    try {
      expect(await operation).toMatchObject({ status: 'refused', refusal: { code: 'session-not-active' } })
      expect(calls).toBe(0)
    } finally {
      await runtime.dispose(); rmSync(root, { recursive: true, force: true })
    }
  })

  test('rejects a session window that does not match the deterministic artifact request', async () => {
    let calls = 0
    const fixture = await loadEsDemoFixture()
    const { root, runtime, operation } = await runFixture(
      async (request) => { calls += 1; return validModel()(request) },
      '1783780230000000000',
      { ...fixture.manifest.session_window, session_id: 'different-session' },
    )
    try {
      await expect(operation).rejects.toThrow('session window must match')
      expect(calls).toBe(0)
    } finally {
      await runtime.dispose(); rmSync(root, { recursive: true, force: true })
    }
  })

  test('rejects malformed model JSON', async () => {
    const { root, runtime, operation } = await runFixture(async () => ({ text: 'not-json', model: 'broken-model' }))
    try {
      await expect(operation).rejects.toThrow('malformed JSON')
    } finally {
      await runtime.dispose(); rmSync(root, { recursive: true, force: true })
    }
  })

  test('surfaces provider failure without storing an interpretation', async () => {
    const { root, runtime, operation } = await runFixture(async () => { throw new Error('provider unavailable') })
    try {
      await expect(operation).rejects.toThrow('provider unavailable')
      expect(() => readdirSync(path.join(root, 'interpretations'))).toThrow()
    } finally {
      await runtime.dispose(); rmSync(root, { recursive: true, force: true })
    }
  })
})
