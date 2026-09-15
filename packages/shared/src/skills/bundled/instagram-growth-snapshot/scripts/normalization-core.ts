export interface NormalizedInstagramSnapshot {
  version: 1
  dataSource: 'instagram-insights-browser'
  snapshotDate: string
  windowDays: number | null
  profile: { profile: string; handle: string | null; accountUrl: string | null }
  metrics: Record<'views' | 'followers' | 'followerDelta' | 'accountsReached' | 'accountsEngaged' | 'interactions' | 'profileVisits' | 'likes' | 'comments', number | null>
  monthlyFollowers: Array<{ month: string; followers?: number; net?: number }>
  partial: boolean
  errors: string[]
  updatedAt: string
}

const metricNames = ['views', 'followers', 'followerDelta', 'accountsReached', 'accountsEngaged', 'interactions', 'profileVisits', 'likes', 'comments'] as const

export function normalizeInstagramCapture(input: unknown, now = new Date()): NormalizedInstagramSnapshot {
  const root = record(input)
  const profile = record(root.profile)
  const metrics = record(root.metrics)
  const snapshotDate = string(root.snapshotDate)
  const profileId = string(profile.profile)
  if (!snapshotDate || !/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate) || Number.isNaN(Date.parse(snapshotDate)) || new Date(snapshotDate).toISOString().slice(0, 10) !== snapshotDate) throw new Error('capture snapshotDate must use YYYY-MM-DD')
  if (!profileId) throw new Error('capture profile.profile is required')

  const errors = Array.isArray(root.errors) ? root.errors.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())) : []
  const normalizedMetrics = Object.fromEntries(metricNames.map((name) => [name, metric(metrics[name], name === 'followerDelta')])) as NormalizedInstagramSnapshot['metrics']
  if (Object.values(normalizedMetrics).every(value => value === null)) throw new Error('capture needs at least one exact usable metric')
  const windowDays = positiveInteger(root.windowDays)
  if (windowDays === null) throw new Error('capture windowDays must be a positive whole number')
  for (const name of metricNames) {
    if (metrics[name] != null && normalizedMetrics[name] === null) errors.push(`Invalid ${name} ignored; expected an exact whole-number count.`)
  }
  const monthlyFollowers = normalizeMonthlyFollowers(root.monthlyFollowers, errors)

  return {
    version: 1,
    dataSource: 'instagram-insights-browser',
    snapshotDate,
    windowDays,
    profile: {
      profile: profileId,
      handle: string(profile.handle),
      accountUrl: string(profile.accountUrl),
    },
    metrics: normalizedMetrics,
    monthlyFollowers,
    partial: root.partial === true || errors.length > 0,
    errors: [...new Set(errors)],
    updatedAt: now.toISOString(),
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function metric(value: unknown, signed: boolean): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return null
  if (!signed && value < 0) return null
  return value
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

function normalizeMonthlyFollowers(
  value: unknown,
  errors: string[],
): Array<{ month: string; followers?: number; net?: number }> {
  if (value == null) return []
  if (!Array.isArray(value)) {
    errors.push('Monthly follower history was not an array and was ignored.')
    return []
  }
  const byMonth = new Map<string, { month: string; followers?: number; net?: number }>()
  value.forEach((item, index) => {
    const candidate = record(item)
    const month = string(candidate.month)
    if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      errors.push(`Invalid monthlyFollowers[${index}] month was ignored.`)
      return
    }
    const followers = metric(candidate.followers, false)
    const net = metric(candidate.net, true)
    if (followers === null && net === null) {
      errors.push(`monthlyFollowers[${index}] had no usable follower value and was ignored.`)
      return
    }
    byMonth.set(month, {
      month,
      ...(followers === null ? {} : { followers }),
      ...(net === null ? {} : { net }),
    })
  })
  return [...byMonth.values()]
    .sort((left, right) => left.month.localeCompare(right.month))
    .slice(-12)
}
