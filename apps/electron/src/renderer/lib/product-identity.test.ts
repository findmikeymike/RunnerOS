import { describe, expect, test } from 'bun:test'
import { productizeRunnerText } from './product-identity'

describe('productizeRunnerText', () => {
  test('preserves Runner copy for the Runner product', () => {
    expect(productizeRunnerText('Welcome to RunnerOS', 'Runner')).toBe('Welcome to RunnerOS')
    expect(productizeRunnerText('Use Runner Backend', 'Runner')).toBe('Use Runner Backend')
  })

  test('rebrands Runner copy for Artist OS', () => {
    expect(productizeRunnerText('Welcome to RunnerOS', 'Artist OS')).toBe('Welcome to Artist OS')
    expect(productizeRunnerText('Use Runner Backend', 'Artist OS')).toBe('Use Artist OS Backend')
  })
})
