import { describe, expect, test } from 'bun:test'
import { allowedScheduleTypes } from './ActiveWorkAddMenu'

describe('allowedScheduleTypes', () => {
  test('keeps HQ scheduling scoped to workers and workflows', () => {
    expect(allowedScheduleTypes(true)).toEqual(['agent-task', 'workflow-run'])
  })

  test('preserves campaign review and social publish options', () => {
    expect(allowedScheduleTypes(false)).toEqual(['agent-task', 'workflow-run', 'review', 'social-publish'])
  })
})
