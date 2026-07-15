import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createHeadlessPlatform } from '@craft-agent/server-core/runtime'
import { SessionManager, setSessionPlatform } from '@craft-agent/server-core/sessions'
import { getWorkspaces } from '@craft-agent/shared/config'
import { CANONICAL_ORDER_FLOW_CONFIGURATION } from '@trade-god/contracts'
import { loadEsDemoFixture } from '@trade-god/testkit'

import { createTradeGodRuntime } from '../apps/electron/src/main/trading/trading-runtime.ts'
import { evaluateOrderFlowInterpretation } from '../apps/electron/src/main/trading/order-flow-specialist-evaluation.ts'

class EvalIpcMain {
  handle(): void {}
  removeHandler(): void {}
}

const repoRoot = path.resolve(import.meta.dir, '..')
const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'trade-god-real-model-eval-'))
setSessionPlatform(createHeadlessPlatform({ appVersion: 'trade-god-eval' }))
const sessionManager = new SessionManager()
let runtime: ReturnType<typeof createTradeGodRuntime> | undefined

try {
  await sessionManager.initialize()
  const workspace = getWorkspaces().find((candidate) => !candidate.remoteServer)
  if (!workspace) throw new Error('No local Runner workspace is configured for the specialist model provider.')

  runtime = createTradeGodRuntime({
    ipcMain: new EvalIpcMain(),
    rootCandidates: [repoRoot],
    runtimeExecutable: process.execPath,
    now: () => new Date().toISOString(),
    contextDirectory: path.join(temporaryRoot, 'context'),
    interpretationDirectory: path.join(temporaryRoot, 'interpretations'),
  })
  const llmConnection = process.env.TRADE_GOD_EVAL_LLM_CONNECTION ?? 'pi-api-key'
  runtime.setSpecialistModel((request) => sessionManager.runOneShotLlmQuery(workspace.id, request, { llmConnection }))

  const fixture = await loadEsDemoFixture()
  const output = await runtime.orderFlowSpecialistPipeline!.interpretFixture({
    analysis: {
      fixture: { id: fixture.manifest.fixture_id, sha256: fixture.manifest.events_sha256 },
      instrument: fixture.manifest.instrument,
      session: fixture.manifest.session,
      analysis: CANONICAL_ORDER_FLOW_CONFIGURATION,
      timeoutMs: 10_000,
      traceId: `trace-real-model-eval-${Date.now()}`,
    },
    context: {
      snapshotId: `snapshot-real-model-eval-${Date.now()}`,
      intervalNs: '20000000000',
      watermarkNs: '1783780230000000000',
      staleAfterNs: '5000000000',
      recentTradeLimit: 4,
      closedCandleLimit: 2,
    },
    assignment: {
      question: 'What does this tiny sample support, what does it not support, and what fresh evidence would change the read?',
      horizon: 'immediate',
    },
  })
  const evaluation = evaluateOrderFlowInterpretation(output)
  console.log(JSON.stringify({ evaluation, output }, null, 2))
  if (!evaluation.passed) throw new Error(`Order Flow specialist evaluation failed: ${evaluation.score}/${evaluation.threshold}`)
} finally {
  await runtime?.dispose()
  sessionManager.cleanup()
  rmSync(temporaryRoot, { recursive: true, force: true })
}
