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
import type { SpecialistModel } from '../apps/electron/src/main/trading/order-flow-specialist.ts'

class EvalIpcMain {
  handle(): void {}
  removeHandler(): void {}
}

const repoRoot = path.resolve(import.meta.dir, '..')
const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'trade-god-real-model-eval-'))
setSessionPlatform(createHeadlessPlatform({ appVersion: 'trade-god-eval' }))
const sessionManager = new SessionManager()
let runtime: ReturnType<typeof createTradeGodRuntime> | undefined

function createGeminiModel(apiKey: string, model = 'gemini-3.5-flash'): SpecialistModel {
  return async (request) => {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: request.systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
          generationConfig: {
            // Gemini 3.x is tuned for its default temperature and counts hidden
            // reasoning against this ceiling. Minimal thinking keeps the bounded
            // evaluation focused while leaving room for the full JSON contract.
            temperature: 1,
            maxOutputTokens: Math.max(request.maxTokens, 8_192),
            thinkingConfig: { thinkingLevel: 'minimal' },
            responseMimeType: 'application/json',
          },
        }),
      },
    )
    const payload = await response.json() as {
      error?: { message?: string }
      candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>
    }
    if (!response.ok) throw new Error(`Gemini evaluation failed (${response.status}): ${payload.error?.message ?? 'unknown provider error'}`)
    if (process.env.TRADE_GOD_EVAL_DEBUG_RESPONSE === '1') {
      console.error(JSON.stringify(payload.candidates ?? [], null, 2))
    }
    const text = payload.candidates?.[0]?.content?.parts
      ?.filter((part) => part.thought !== true)
      .map((part) => part.text ?? '')
      .join('')
      .trim()
    if (!text) throw new Error('Gemini evaluation returned no text.')
    return { text, model }
  }
}

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
  const provider = process.env.TRADE_GOD_EVAL_PROVIDER ?? 'runner'
  if (provider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) throw new Error('GEMINI_API_KEY is required for the Gemini evaluation provider.')
    runtime.setSpecialistModel(createGeminiModel(apiKey, process.env.TRADE_GOD_EVAL_MODEL))
  } else {
    const llmConnection = process.env.TRADE_GOD_EVAL_LLM_CONNECTION ?? 'pi-api-key'
    runtime.setSpecialistModel((request) => sessionManager.runOneShotLlmQuery(workspace.id, request, { llmConnection }))
  }

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
