import { describe, expect, test } from 'bun:test'
import type { ContextDocDTO } from '../../shared/types'
import { buildMissionBrief, serializeMissionBriefBody } from '@/lib/mission-brief'
import { buildXEditorialCampaignLaunchContext, selectXEditorialCampaignContext } from './x-editorial-launch'

function doc(slug: string, root: string, body = slug): ContextDocDTO {
  return {
    slug,
    metadata: {
      name: slug,
      routing: { mode: 'targeted', agents: ['x-editorial'] },
      enabled: true,
    },
    body,
    path: `${root}/context/${slug}/CONTEXT.md`,
    workspaceRootPath: root,
  }
}

describe('buildXEditorialCampaignLaunchContext', () => {
  test('keeps HQ truth, pins only relevant campaign docs, and names the exact campaign', () => {
    const result = buildXEditorialCampaignLaunchContext(
      [doc('artist-profile', '/hq'), doc('mission-brief', '/hq', 'HQ brief')],
      [doc('mission-brief', '/campaign', 'Campaign brief'), doc('private-notes', '/campaign')],
      { id: 'campaign-123', name: 'New Single' },
    )

    expect(result.find((entry) => entry.slug === 'artist-profile')?.body).toBe('artist-profile')
    expect(result.find((entry) => entry.slug === 'mission-brief')?.body).toBe('Campaign brief')
    expect(result.some((entry) => entry.slug === 'private-notes')).toBe(false)

    const launch = result.find((entry) => entry.slug === 'x-editorial-launch-context')
    expect(launch?.body).toContain('Pinned Campaign: New Single')
    expect(launch?.body).toContain('Campaign influence: focus.')
    expect(launch?.body).toContain('campaignWorkspaceId `campaign-123`')
    expect(launch?.workspaceRootPath).toBe('/hq')
    expect(launch?.metadata.routing).toEqual({ mode: 'targeted', agents: ['x-editorial'] })
  })

  test('selects the current or nearest dated Campaign for an HQ launch', () => {
    const campaign = (id: string, name: string, releaseDate: string) => ({
      id,
      name,
      docs: [doc('mission-brief', `/${id}`, serializeMissionBriefBody(buildMissionBrief(id, {
        title: name,
        releaseDate,
      })))],
    })

    const result = selectXEditorialCampaignContext([
      campaign('later', 'Later Release', '2026-10-20'),
      campaign('current', 'Current Single', '2026-09-08'),
    ], new Date('2026-08-31T12:00:00.000Z'))

    expect(result).toMatchObject({
      campaign: { id: 'current', name: 'Current Single' },
      releaseDate: '2026-09-08',
      weight: 'focus',
    })
  })
})
