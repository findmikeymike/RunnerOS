import { describe, expect, test } from 'bun:test'
import { humanizeWorkflowInputName, orderWorkflowInputs, validateWorkflowInputValues, workflowInputControl, workflowNumberMax, workflowOutputAssetPath } from './workflow-input-presentation'

describe('workflow input presentation', () => {
  test('humanizes schema keys without exposing implementation labels', () => {
    expect(humanizeWorkflowInputName('product_goal')).toBe('Product goal')
    expect(humanizeWorkflowInputName('artist-reference')).toBe('Artist reference')
  })

  test('orders required fields before optional fields without changing either order', () => {
    const inputs = [
      { name: 'optional_a', type: 'string' as const },
      { name: 'required_a', type: 'string' as const, required: true },
      { name: 'optional_b', type: 'boolean' as const },
    ]
    const grouped = orderWorkflowInputs(inputs)
    expect(grouped.required.map((input) => input.name)).toEqual(['required_a'])
    expect(grouped.optional.map((input) => input.name)).toEqual(['optional_a', 'optional_b'])
  })

  test('uses asset controls only for explicit workflow/input bindings', () => {
    expect(workflowInputControl('merch-product-builder', { name: 'artwork', type: 'string' })).toBe('asset')
    expect(workflowInputControl('unknown-workflow', { name: 'artwork', type: 'string' })).toBe('short-text')
    expect(workflowInputControl('any', { name: 'sample_first', type: 'boolean' })).toBe('boolean')
  })

  test('matches runtime-required and numeric bounds before launch', () => {
    const inputs = [
      { name: 'goal', type: 'string' as const, required: true },
      { name: 'target_count', type: 'number' as const, min: 1, integer: true },
      { name: 'draft_count', type: 'number' as const, maxFrom: 'target_count' },
    ]
    expect(validateWorkflowInputValues(inputs, { goal: '', target_count: 4, draft_count: 2 })?.inputName).toBe('goal')
    expect(validateWorkflowInputValues(inputs, { goal: 'Launch', target_count: 4, draft_count: 5 })?.inputName).toBe('draft_count')
    expect(validateWorkflowInputValues(inputs, { goal: 'Launch', target_count: 4, draft_count: 2 })).toBeNull()
    expect(workflowNumberMax(inputs[2], { goal: 'Launch', target_count: 4, draft_count: 2 })).toBe(4)
  })

  test('resolves selected Output assets on macOS and Windows roots', () => {
    expect(workflowOutputAssetPath('/music/Angelina', 'out-1', 'assets/cover.png')).toBe('/music/Angelina/outputs/out-1/assets/cover.png')
    expect(workflowOutputAssetPath('C:\\Music\\Angelina', 'out-1', 'assets/cover.png')).toBe('C:\\Music\\Angelina\\outputs\\out-1\\assets/cover.png')
  })
})
