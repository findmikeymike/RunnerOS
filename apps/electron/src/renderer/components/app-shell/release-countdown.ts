const DAY_MS = 24 * 60 * 60 * 1000
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export interface ReleaseCountdown {
  hasDate: boolean
  daysUntil: number | null
  progress: number
  released: boolean
  releaseDay: boolean
  dateLabel: string
}

export function getReleaseCountdown(
  releaseDate: string | undefined,
  campaignStartDate: string | undefined,
  now: Date = new Date(),
): ReleaseCountdown {
  const releaseEpoch = dateKeyEpoch(releaseDate)
  if (releaseEpoch === null) {
    return {
      hasDate: false,
      daysUntil: null,
      progress: 0,
      released: false,
      releaseDay: false,
      dateLabel: 'Date not set',
    }
  }

  const todayEpoch = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const daysUntil = Math.round((releaseEpoch - todayEpoch) / DAY_MS)
  const startEpoch = dateKeyEpoch(campaignStartDate)
  const progress = startEpoch !== null && startEpoch < releaseEpoch
    ? clamp((todayEpoch - startEpoch) / (releaseEpoch - startEpoch))
    : clamp(1 - Math.max(daysUntil, 0) / 30)

  return {
    hasDate: true,
    daysUntil,
    progress: daysUntil <= 0 ? 1 : progress,
    released: daysUntil < 0,
    releaseDay: daysUntil === 0,
    dateLabel: formatDateKey(releaseDate!),
  }
}

function dateKeyEpoch(value: string | undefined): number | null {
  if (!value) return null
  const match = DATE_KEY_PATTERN.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const epoch = Date.UTC(year, month - 1, day)
  const candidate = new Date(epoch)
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return null
  return epoch
}

function formatDateKey(value: string): string {
  const epoch = dateKeyEpoch(value)
  if (epoch === null) return 'Date not set'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(epoch))
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}
