import { existsSync } from 'node:fs';

export const SUPPORTED_PLATFORMS = ['google', 'meta'];
export const SUPPORTED_LEVELS = ['campaign', 'adset', 'adgroup', 'ad', 'keyword', 'search_term'];
export const PACKET_TYPES = ['publish', 'budget', 'status', 'targeting', 'creative', 'keyword', 'recommendation'];

export function normalizePlatform(value) {
  if (value === 'google-ads') return 'google';
  if (value === 'facebook' || value === 'meta-ads') return 'meta';
  return value;
}

export function normalizeLevel(value = 'campaign') {
  if (value === 'ad-set') return 'adset';
  if (value === 'ad-group') return 'adgroup';
  if (value === 'search-term') return 'search_term';
  return value;
}

export function validatePlatform(platform) {
  return SUPPORTED_PLATFORMS.includes(normalizePlatform(platform));
}

export function validateLevel(level) {
  return SUPPORTED_LEVELS.includes(normalizeLevel(level));
}

export function validateApprovalPacketInput(input) {
  const errors = [];
  if (!validatePlatform(input.platform)) errors.push('platform must be google or meta');
  if (!PACKET_TYPES.includes(input.type)) errors.push(`type must be one of: ${PACKET_TYPES.join(', ')}`);
  if (!input.account) errors.push('account is required');
  if (!input.action) errors.push('action is required');
  if (!input.spendImpact) errors.push('spend-impact is required');
  if (!input.evidence) errors.push('evidence is required');
  return errors;
}

export function createApprovalPacket(input) {
  const now = new Date().toISOString();
  const evidence = buildEvidence(input.evidence);
  return {
    schema: 'runneros.ads.approval_packet.v1',
    createdAt: now,
    platform: normalizePlatform(input.platform),
    type: input.type,
    account: redactSensitiveText(input.account),
    action: redactSensitiveText(input.action),
    spendImpact: redactSensitiveText(input.spendImpact),
    evidence,
    evidenceVerified: evidence.verified,
    rollbackPlan: redactSensitiveText(input.rollbackPlan || 'Manual rollback required in the ad platform UI.'),
    approvalPhrase: `APPROVE ${normalizePlatform(input.platform).toUpperCase()} ${input.type.toUpperCase()}`,
    requiresApproval: true,
    writeExecuted: false,
  };
}

export function buildEvidence(value) {
  const text = redactSensitiveText(value);
  const looksRemote = /^(https?:|runneros-output:|output:)/i.test(text);
  return {
    type: looksRemote ? 'remote' : 'local_path',
    value: text,
    verified: looksRemote ? false : existsSync(text),
  };
}

export function redactSensitiveText(value) {
  if (value == null) return value;
  let text = String(value);
  const patterns = [
    /\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|BEARER|AUTHORIZATION|API[_-]?KEY)[A-Z0-9_]*\s*=\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi,
    /\b(?:access|refresh|developer)[_-]?token\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi,
    /\b(?:api[_-]?key|client[_-]?secret|password)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi,
    /\b(?:cookie|session|sessionid|session_id|sid|xsrf|csrf|csrf[_-]?token)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi,
    /\b(?:Cookie|Set-Cookie|X-CSRF-Token|X-XSRF-Token)\s*:\s*("[^"]*"|'[^']*'|[^\n\r;]+)/gi,
    /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  ];
  for (const pattern of patterns) text = text.replace(pattern, (match) => {
    const separator = match.includes(':') ? ':' : match.includes('=') ? '=' : ' ';
    const [prefix] = match.split(separator);
    return separator === ' ' ? 'Bearer [redacted]' : `${prefix}${separator}[redacted]`;
  });
  return text;
}

export function normalizedMetricRow({ platform, level, raw, fields }) {
  return {
    schema: 'runneros.ads.normalized_metric_row.v1',
    platform: normalizePlatform(platform),
    level: normalizeLevel(level),
    accountName: fields.accountName ?? null,
    campaignName: fields.campaignName ?? null,
    adSetName: fields.adSetName ?? null,
    adGroupName: fields.adGroupName ?? null,
    adName: fields.adName ?? null,
    keyword: fields.keyword ?? null,
    matchType: fields.matchType ?? null,
    searchTerm: fields.searchTerm ?? null,
    date: fields.date ?? null,
    currency: fields.currency ?? null,
    status: fields.status ?? null,
    objective: fields.objective ?? null,
    resultType: fields.resultType ?? null,
    reach: fields.reach ?? null,
    frequency: fields.frequency ?? null,
    impressions: fields.impressions ?? null,
    clicks: fields.clicks ?? null,
    linkClicks: fields.linkClicks ?? null,
    spend: fields.spend ?? null,
    conversions: fields.conversions ?? null,
    revenue: fields.revenue ?? null,
    ctr: fields.ctr ?? null,
    cpc: fields.cpc ?? null,
    cpm: fields.cpm ?? null,
    costPerResult: fields.costPerResult ?? null,
    costPerConversion: fields.costPerConversion ?? null,
    impressionShare: fields.impressionShare ?? null,
    raw,
  };
}
