import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'

import {
  ORDER_FLOW_SPECIALIST_AGENT,
  ORDER_FLOW_SPECIALIST_DOCTRINE,
  ORDER_FLOW_SPECIALIST_DOCTRINE_SHA256,
  orderFlowMeasurementsSchema,
} from '../src/index.ts'

describe('Order Flow specialist contracts', () => {
  test('pins the specialist identity and exact deterministic measurement shape', () => {
    expect(ORDER_FLOW_SPECIALIST_AGENT).toEqual({
      id: 'order-flow-specialist', version: '0.1.0',
      skill: { id: 'order-flow-specialist', version: '0.1.0' },
    })
    expect(orderFlowMeasurementsSchema.parse({
      event_count: 4, total_volume: '28', buy_volume: '17', sell_volume: '11',
      unknown_volume: '0', delta: '6', point_of_control_price: '5592.25',
    }).delta).toBe('6')
    expect(orderFlowMeasurementsSchema.safeParse({
      event_count: 4, total_volume: 28, buy_volume: '17', sell_volume: '11',
      unknown_volume: '0', delta: '6', point_of_control_price: '5592.25',
    }).success).toBe(false)
  })

  test('pins the exact runtime doctrine bytes', () => {
    expect(createHash('sha256').update(ORDER_FLOW_SPECIALIST_DOCTRINE).digest('hex'))
      .toBe(ORDER_FLOW_SPECIALIST_DOCTRINE_SHA256)
  })
})
