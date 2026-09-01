import { describe, expect, test } from 'bun:test'
import { allowedScheduleTypes, matchesRunNowQuery } from './ActiveWorkAddMenu'

describe('allowedScheduleTypes', () => {
  test('keeps HQ scheduling scoped to workers and workflows', () => {
    expect(allowedScheduleTypes(true)).toEqual(['agent-task', 'workflow-run'])
  })

  test('preserves campaign review and social publish options', () => {
    expect(allowedScheduleTypes(false)).toEqual(['agent-task', 'workflow-run', 'review', 'social-publish'])
  })
})

describe('matchesRunNowQuery', () => {
  test('matches names and descriptions without changing the launch inventory', () => {
    expect(matchesRunNowQuery('Raw Video Editor', 'Turns footage into clips', 'video')).toBe(true)
    expect(matchesRunNowQuery('Raw Video Editor', 'Turns footage into clips', 'footage')).toBe(true)
    expect(matchesRunNowQuery('Raw Video Editor', 'Turns footage into clips', 'press')).toBe(false)
    expect(matchesRunNowQuery('Raw Video Editor', undefined, '   ')).toBe(true)
  })
})
