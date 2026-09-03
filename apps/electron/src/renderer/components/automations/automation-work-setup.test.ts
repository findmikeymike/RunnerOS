import { describe, expect, test } from 'bun:test'
import type { WorkflowTriggerInput } from '@craft-agent/shared/workflows'
import {
  automationReviewSentence,
  compactWorkflowInputBindings,
  fixedValueWhenSelected,
  fixedTriggerInputs,
  initialWorkflowInputBindings,
  reconcileBindingsForWhen,
  requestedInputNames,
  triggerSourcesForInput,
  validateWorkflowInputBindings,
} from './automation-work-setup'

const inputs: WorkflowTriggerInput[] = [
  { name: 'design_file', type: 'string', required: true },
  { name: 'campaign_brief', type: 'string', required: true, default: 'Q4 drop' },
  { name: 'size_run', type: 'number', required: true, default: 250, min: 1 },
]

describe('automation work setup', () => {
  test('uses defaults and asks only for required values without defaults', () => {
    const bindings = initialWorkflowInputBindings(inputs)
    expect(bindings).toEqual({
      design_file: { mode: 'ask' },
      campaign_brief: { mode: 'fixed', value: 'Q4 drop' },
      size_run: { mode: 'fixed', value: 250 },
    })
    expect(requestedInputNames(bindings)).toEqual(['design_file'])
    expect(fixedTriggerInputs(bindings)).toEqual({ campaign_brief: 'Q4 drop', size_run: 250 })
  })

  test('treats explicit prefill values as fixed, including false and zero', () => {
    expect(initialWorkflowInputBindings([
      { name: 'count', type: 'number', required: true },
      { name: 'enabled', type: 'boolean', required: true },
    ], { count: 0, enabled: false })).toEqual({
      count: { mode: 'fixed', value: 0 },
      enabled: { mode: 'fixed', value: false },
    })
  })

  test('requires an explicit choice for defaultless booleans switched to fixed', () => {
    expect(fixedValueWhenSelected({ name: 'enabled', type: 'boolean', required: true }, { mode: 'ask' })).toBe('')
    expect(fixedValueWhenSelected({ name: 'enabled', type: 'boolean', required: true, default: false }, { mode: 'ask' })).toBe(false)
  })

  test('omits blank optional values without dropping false or zero', () => {
    const definitions: WorkflowTriggerInput[] = [
      { name: 'note', type: 'string' },
      { name: 'count', type: 'number' },
      { name: 'enabled', type: 'boolean' },
    ]
    expect(compactWorkflowInputBindings(definitions, {
      note: { mode: 'fixed', value: '' },
      count: { mode: 'fixed', value: 0 },
      enabled: { mode: 'fixed', value: false },
    })).toEqual({
      count: { mode: 'fixed', value: 0 },
      enabled: { mode: 'fixed', value: false },
    })
  })

  test('does not fabricate values for optional inputs without defaults', () => {
    expect(initialWorkflowInputBindings([
      { name: 'note', type: 'string' },
      { name: 'count', type: 'number' },
      { name: 'enabled', type: 'boolean' },
    ])).toEqual({})
  })

  test('auto-binds a required string input with a file token in its name', () => {
    const result = reconcileBindingsForWhen(inputs, initialWorkflowInputBindings(inputs), 'file')
    expect(result.design_file).toEqual({ mode: 'trigger', from: 'file.path' })
  })

  test('ignores file-like descriptions and non-token substrings when auto-binding', () => {
    const deceptiveInputs: WorkflowTriggerInput[] = [
      { name: 'prompt', type: 'string', required: true, description: 'Path to the source file asset.' },
      { name: 'profile', type: 'string', required: true },
      { name: 'campaignAsset', type: 'string', required: true },
    ]

    expect(reconcileBindingsForWhen(
      deceptiveInputs,
      initialWorkflowInputBindings(deceptiveInputs),
      'file',
    )).toEqual({
      prompt: { mode: 'ask' },
      profile: { mode: 'ask' },
      campaignAsset: { mode: 'trigger', from: 'file.path' },
    })
  })

  test('leaves required strings asking when no name has a file, path, or asset token', () => {
    const ambiguousInputs: WorkflowTriggerInput[] = [
      { name: 'prompt', type: 'string', required: true, description: 'Select an audio file.' },
      { name: 'document', type: 'string', required: true },
    ]

    expect(reconcileBindingsForWhen(
      ambiguousInputs,
      initialWorkflowInputBindings(ambiguousInputs),
      'file',
    )).toEqual({
      prompt: { mode: 'ask' },
      document: { mode: 'ask' },
    })
  })

  test('replaces a stale fixed file-like value when a file trigger is selected', () => {
    const result = reconcileBindingsForWhen(inputs, {
      design_file: { mode: 'fixed', value: '/old/design.png' },
      campaign_brief: { mode: 'fixed', value: 'Q4 drop' },
      size_run: { mode: 'fixed', value: 250 },
    }, 'file')
    expect(result.design_file).toEqual({ mode: 'trigger', from: 'file.path' })
    expect(result.campaign_brief).toEqual({ mode: 'fixed', value: 'Q4 drop' })
    expect(result.size_run).toEqual({ mode: 'fixed', value: 250 })
  })

  test('removes trigger bindings when the selected trigger can no longer provide them', () => {
    const fileBindings = reconcileBindingsForWhen(inputs, initialWorkflowInputBindings(inputs), 'file')
    const weeklyBindings = reconcileBindingsForWhen(inputs, fileBindings, 'weekly')
    expect(weeklyBindings.design_file).toEqual({ mode: 'ask' })
  })

  test('offers trigger values only for compatible string inputs', () => {
    expect(triggerSourcesForInput('file', inputs[0]!)).toEqual([
      { source: 'file.path', label: 'From file path' },
      { source: 'file.name', label: 'From file name' },
    ])
    expect(triggerSourcesForInput('file', inputs[2]!)).toEqual([])
  })

  test('rejects empty fixed required values and incompatible trigger sources', () => {
    expect(validateWorkflowInputBindings(inputs, {
      design_file: { mode: 'fixed', value: '' },
      campaign_brief: { mode: 'fixed', value: 'Q4 drop' },
      size_run: { mode: 'fixed', value: 250 },
    }, 'weekly')).toBe('Add design_file or ask for it each time.')
    expect(validateWorkflowInputBindings(inputs, {
      design_file: { mode: 'trigger', from: 'file.path' },
      campaign_brief: { mode: 'fixed', value: 'Q4 drop' },
      size_run: { mode: 'fixed', value: 250 },
    }, 'message')).toBe('design_file cannot come from this trigger.')
  })

  test('does not allow optional inputs to pause every run', () => {
    expect(validateWorkflowInputBindings([
      { name: 'note', type: 'string', required: false },
    ], { note: { mode: 'ask' } }, 'weekly')).toBe('note is optional and cannot pause every run.')
  })

  test('writes an honest review sentence for fed recurring work', () => {
    expect(automationReviewSentence({
      title: 'Merch Run',
      runnerName: 'Merch workflow',
      when: 'weekly',
      scheduleLabel: 'Tuesday at 9:30 AM',
      requestedInputs: ['design_file'],
      fixedInputs: { campaign_brief: 'Q4 drop', size_run: 250 },
    })).toBe('Every Tuesday at 9:30 AM, Merch Run will wait under Needs you for design file, then run with campaign brief “Q4 drop” and size run 250 using Merch workflow.')
  })

  test('writes the assigned monthly schedule in plain language', () => {
    expect(automationReviewSentence({
      title: 'Monthly Report',
      runnerName: 'Report workflow',
      when: 'monthly',
      scheduleLabel: 'Monthly on day 4 at 9:00 AM',
    })).toBe('Monthly on day 4 at 9:00 AM, Monthly Report will run using Report workflow.')
  })

  test('does not repeat the runner name when it is also the automation title', () => {
    expect(automationReviewSentence({
      title: 'Merch Run',
      runnerName: 'Merch Run',
      when: 'file',
    })).toBe('When a matching file lands, Merch Run will run.')
  })
})
