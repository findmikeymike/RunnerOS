import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { getSessionToolDefs } from './tool-defs.ts'

const scriptedEvals = [
  {
    question: 'What should I focus on this week?',
    required: ['get_manager_brief'],
    forbidden: ['get_artist_context', 'get_campaign_context', 'get_workspace_context'],
  },
  {
    question: 'How are Spotify and Instagram moving?',
    required: ['get_manager_brief', 'get_artist_context'],
    forbidden: ['get_campaign_context', 'get_workspace_context'],
  },
  {
    question: 'What is my next campaign and what is missing?',
    required: ['get_manager_brief', 'get_campaign_context'],
    forbidden: ['get_artist_context', 'get_workspace_context'],
  },
  {
    question: 'Does this new opportunity fit the year plan?',
    required: ['get_manager_brief', 'get_artist_context'],
    forbidden: ['get_campaign_context', 'get_workspace_context'],
  },
  {
    question: 'What useful intel arrived recently?',
    required: ['get_manager_brief', 'get_artist_context'],
    forbidden: ['get_campaign_context', 'get_workspace_context'],
  },
  {
    question: 'Who should handle the next step?',
    required: ['get_manager_brief'],
    forbidden: ['get_artist_context', 'get_campaign_context', 'get_workspace_context'],
  },
  {
    question: 'This song releases in ten days. Are we actually ready?',
    required: ['get_manager_brief', 'get_campaign_context'],
    forbidden: ['get_artist_context', 'get_workspace_context'],
  },
  {
    question: 'Our campaign story feels vague. Should we start promoting it?',
    required: ['get_manager_brief', 'list_workspace_context', 'get_workspace_context'],
    forbidden: ['get_artist_context', 'get_campaign_context'],
  },
] as const

describe('Artist Manager scripted eval contracts', () => {
  test('pins launch and judgment questions to the smallest intended retrieval plan', () => {
    expect(scriptedEvals.map((item) => item.question)).toEqual([
      'What should I focus on this week?',
      'How are Spotify and Instagram moving?',
      'What is my next campaign and what is missing?',
      'Does this new opportunity fit the year plan?',
      'What useful intel arrived recently?',
      'Who should handle the next step?',
      'This song releases in ten days. Are we actually ready?',
      'Our campaign story feels vague. Should we start promoting it?',
    ])
    for (const item of scriptedEvals) {
      expect(item.required[0]).toBe('get_manager_brief')
      expect(new Set([...item.required, ...item.forbidden]).size).toBe(item.required.length + item.forbidden.length)
      expect(item.required.length).toBeLessThanOrEqual(3)
    }
  })

  test('every required retrieval exists for HNIC and manager-only tools stay hidden elsewhere', () => {
    const managerTools = new Set(getSessionToolDefs({ includeManagerTools: true }).map((tool) => tool.name))
    const ordinaryTools = new Set(getSessionToolDefs({ includeManagerTools: false }).map((tool) => tool.name))
    for (const item of scriptedEvals) {
      for (const tool of item.required) expect(managerTools.has(tool)).toBe(true)
    }
    expect(ordinaryTools.has('get_manager_brief')).toBe(false)
    expect(ordinaryTools.has('get_artist_context')).toBe(false)
    expect(ordinaryTools.has('get_campaign_context')).toBe(false)
  })

  test('the bundled operating skill enforces manager judgment, freshness, delegation, and approval', () => {
    const skill = readFileSync(new URL(
      '../../shared/src/skills/bundled/artist-manager-operating-system/SKILL.md',
      import.meta.url,
    ), 'utf8')

    expect(skill).toContain('read the live Manager Brief before advising')
    expect(skill).toContain('Retrieve the smallest relevant detail')
    expect(skill).toContain('one clear recommendation')
    expect(skill).toContain('Do not treat every gap, task, or metric as equally important')
    expect(skill).toContain('Task count is not readiness')
    expect(skill).toContain('About 0–2 weeks')
    expect(skill).toContain('Diagnose clarity before promotion')
    expect(skill).toContain('list_workspace_context')
    expect(skill).toContain('definition work')
    expect(skill).toContain('Neither automatically outranks a release blocker')
    expect(skill).toContain('turn a total into growth without comparable earlier data')
    expect(skill).toContain('choose the narrowest capable specialist')
    expect(skill).toContain('Stop for explicit user approval')
    expect(skill).toContain('A handoff is not authorization')
    expect(skill.toLowerCase()).not.toContain('mikey mike')
    expect(skill.toLowerCase()).not.toContain('@gmail.com')
  })
})
