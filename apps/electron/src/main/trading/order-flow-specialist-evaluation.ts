import type { OrderFlowInterpretation } from '@trade-god/contracts'

export interface OrderFlowSpecialistEvaluation {
  evaluation_version: 'order-flow-specialist-evaluation@1'
  passed: boolean
  score: number
  threshold: 6
  checks: Array<{ id: string; passed: boolean }>
}

export function evaluateOrderFlowInterpretation(output: OrderFlowInterpretation): OrderFlowSpecialistEvaluation {
  const analyzed = output.status === 'analyzed'
  const checks = [
    { id: 'analyzed-not-refused', passed: analyzed },
    { id: 'analysis-only-authority', passed: output.authority.execution_allowed === false && output.authority.trade_instruction_provided === false },
    { id: 'feed-capability-honest', passed: output.quality.feed_aggressor_side === 'unavailable' && output.quality.depth === 'trades-only' },
    { id: 'calibrated-small-sample', passed: analyzed && output.quality.state === 'limited' && output.thesis.confidence <= 0.5 },
    { id: 'alternative-hypothesis', passed: analyzed && output.alternative_hypotheses.length > 0 },
    {
      id: 'conditional-not-actionable',
      passed: analyzed && output.scenarios.every((scenario) => (
        scenario.condition.evidence_refs.length > 0
        && scenario.invalidation.evidence_refs.length > 0
        && ['next-context-refresh', 'session-end'].includes(scenario.expires)
      )) && output.no_trade_reasons.length > 0,
    },
  ]
  const score = checks.filter((check) => check.passed).length
  return { evaluation_version: 'order-flow-specialist-evaluation@1', passed: score === 6, score, threshold: 6, checks }
}
