import type { SocialAccountsDoctorResult, SocialPlatform } from '../../shared/types'

export interface ArtistSocialPlatformPulse {
  platform: Exclude<SocialPlatform, 'spotify'>
  total: number
  ready: number
}

export interface ArtistSocialPulseSummary {
  totalProfiles: number
  readyProfiles: number
  attentionProfiles: number
  accountSets: number
  platforms: ArtistSocialPlatformPulse[]
}

const SOCIAL_PLATFORMS: Array<Exclude<SocialPlatform, 'spotify'>> = ['instagram', 'tiktok', 'x', 'youtube']

export function summarizeArtistSocialPulse(doctor: SocialAccountsDoctorResult | null): ArtistSocialPulseSummary {
  const profiles = doctor?.platforms
    .filter((entry) => entry.platform !== 'spotify')
    .flatMap((entry) => entry.profiles) ?? []
  const accountSets = new Set(profiles.map((profile) => profile.accountGroup?.trim()).filter(Boolean))

  return {
    totalProfiles: profiles.length,
    readyProfiles: profiles.filter((profile) => profile.ready).length,
    attentionProfiles: profiles.filter((profile) => !profile.ready).length,
    accountSets: accountSets.size,
    platforms: SOCIAL_PLATFORMS.map((platform) => {
      const platformProfiles = profiles.filter((profile) => profile.platform === platform)
      return {
        platform,
        total: platformProfiles.length,
        ready: platformProfiles.filter((profile) => profile.ready).length,
      }
    }),
  }
}
