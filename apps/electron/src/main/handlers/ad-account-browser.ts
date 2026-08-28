import type { AdBrowserProvider } from '@craft-agent/shared/config'

export const AD_DASHBOARD_URLS: Record<AdBrowserProvider, string> = {
  'meta-ads': 'https://adsmanager.facebook.com/adsmanager/manage/campaigns',
  'google-ads': 'https://ads.google.com/aw/overview',
}

export type AdDashboardPage = {
  url?: string
  title?: string
  text?: string
  links?: string[]
}

export type AdDashboardInspection = {
  loggedIn: boolean
  accountId: string | null
  url: string
  title: string
}

export type AdDashboardIdentityAssessment = {
  expectedId: string | null
  observedId: string | null
  matchesExpected: boolean | null
  ready: boolean
  status: 'ready' | 'login_needed' | 'identity_unverified' | 'wrong_account'
}

export function adDashboardUrl(provider: AdBrowserProvider): string {
  return AD_DASHBOARD_URLS[provider]
}

export function inspectAdDashboard(provider: AdBrowserProvider, page: AdDashboardPage | null): AdDashboardInspection {
  const url = String(page?.url || '')
  const title = String(page?.title || '')
  const text = String(page?.text || '')
  const links = Array.isArray(page?.links) ? page.links : []
  const parsed = parseHttpUrl(url)
  const lower = `${title}\n${text}`.toLowerCase()

  if (provider === 'meta-ads') {
    const allowedHost = parsed != null && META_ADS_HOSTS.has(parsed.hostname)
    const privateRoute = Boolean(parsed && /\/(adsmanager|ads)\b/i.test(parsed.pathname))
    const loginCopy = /\b(log in to facebook|create a new account|forgotten password)\b/i.test(lower)
    return {
      loggedIn: Boolean(allowedHost && privateRoute && !loginCopy),
      accountId: findMetaAdAccountId([url, ...links], text),
      url,
      title,
    }
  }

  const allowedHost = parsed?.hostname === 'ads.google.com'
  const privateRoute = Boolean(parsed && /^\/aw(?:[/?#]|$)/i.test(parsed.pathname))
  const loginCopy = /\b(sign in to google ads|choose an account|create your google ads account)\b/i.test(lower)
  return {
    loggedIn: Boolean(allowedHost && privateRoute && !loginCopy),
    accountId: findGoogleAdsCustomerId([url, ...links], text),
    url,
    title,
  }
}

export function normalizeAdAccountId(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const digits = String(value).replace(/\D/g, '')
  return digits || null
}

export function assessAdDashboardIdentity(
  expectedAccountId: unknown,
  inspection: Pick<AdDashboardInspection, 'loggedIn' | 'accountId'>,
): AdDashboardIdentityAssessment {
  const expectedId = normalizeAdAccountId(expectedAccountId)
  const observedId = normalizeAdAccountId(inspection.accountId)
  const matchesExpected = expectedId && observedId ? expectedId === observedId : null
  const wrongAccount = inspection.loggedIn && matchesExpected === false
  const ready = Boolean(inspection.loggedIn && observedId && !wrongAccount)
  const status = !inspection.loggedIn
    ? 'login_needed'
    : wrongAccount
      ? 'wrong_account'
      : ready
        ? 'ready'
        : 'identity_unverified'
  return { expectedId, observedId, matchesExpected, ready, status }
}

function findMetaAdAccountId(urls: readonly string[], text: string): string | null {
  for (const value of urls) {
    const url = parseHttpUrl(value)
    const candidate = url?.searchParams.get('act') || url?.searchParams.get('account_id')
    const normalized = normalizeAdAccountId(candidate)
    if (normalized) return normalized
  }
  const labeled = text.match(/(?:ad account id|account id)\s*[:#]?\s*(\d{5,})/i)
  return normalizeAdAccountId(labeled?.[1])
}

function findGoogleAdsCustomerId(urls: readonly string[], text: string): string | null {
  const labeled = text.match(/(?:customer id|client id)\s*[:#]?\s*(\d{3}-\d{3}-\d{4})/i)
    || text.match(/\b(\d{3}-\d{3}-\d{4})\b/)
  const fromText = normalizeAdAccountId(labeled?.[1])
  if (fromText) return fromText

  for (const value of urls) {
    const url = parseHttpUrl(value)
    const candidate = url?.searchParams.get('customerId') || url?.searchParams.get('customer_id')
    const normalized = normalizeAdAccountId(candidate)
    if (normalized?.length === 10) return normalized
  }
  return null
}

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null
  } catch {
    return null
  }
}

const META_ADS_HOSTS = new Set([
  'adsmanager.facebook.com',
  'business.facebook.com',
])
