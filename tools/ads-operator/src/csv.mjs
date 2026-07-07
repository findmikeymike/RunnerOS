import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { normalizedMetricRow } from './schema.mjs';

const FIELD_ALIASES = {
  accountName: [{ name: 'account' }, { name: 'account name' }, { name: 'account_name' }, { name: 'account id' }, { name: 'customer id' }],
  campaignName: [{ name: 'campaign' }, { name: 'campaign name' }, { name: 'campaign_name' }],
  adSetName: [{ name: 'ad set' }, { name: 'ad set name' }, { name: 'ad_set' }, { name: 'adset' }, { name: 'adset name' }],
  adGroupName: [{ name: 'ad group' }, { name: 'ad group name' }, { name: 'ad_group' }, { name: 'adgroup' }, { name: 'adgroup name' }],
  adName: [{ name: 'ad' }, { name: 'ad name' }, { name: 'ad_name' }],
  keyword: [{ name: 'keyword' }, { name: 'keyword text' }, { name: 'search keyword' }],
  matchType: [{ name: 'match type' }, { name: 'keyword match type' }, { name: 'search keyword match type' }],
  searchTerm: [{ name: 'search term' }, { name: 'search_term' }, { name: 'query' }, { name: 'search keyword' }],
  date: [{ name: 'date' }, { name: 'day' }, { name: 'start date' }, { name: 'date start' }, { name: 'date_start' }, { name: 'reporting starts' }, { name: 'reporting ends' }],
  currency: [{ name: 'currency' }, { name: 'currency code' }, { name: 'account currency code' }],
  status: [{ name: 'status' }, { name: 'delivery' }, { name: 'delivery status' }, { name: 'campaign status' }, { name: 'ad group status' }, { name: 'ad status' }],
  objective: [{ name: 'objective' }, { name: 'campaign objective' }],
  resultType: [{ name: 'result type' }, { name: 'result indicator' }, { name: 'results type' }],
  reach: [{ name: 'reach' }],
  frequency: [{ name: 'frequency' }],
  impressions: [{ name: 'impressions' }, { name: 'impr.' }, { name: 'impr' }],
  clicks: [{ name: 'clicks' }],
  linkClicks: [{ name: 'link clicks' }, { name: 'outbound clicks' }, { name: 'landing page views' }],
  spend: [{ name: 'spend' }, { name: 'amount spent' }, { name: 'cost' }, { name: 'cost micros', divisor: 1_000_000 }],
  conversions: [{ name: 'conversions' }, { name: 'conv.' }, { name: 'results' }, { name: 'purchases' }, { name: 'website purchases' }, { name: 'leads' }],
  revenue: [{ name: 'revenue' }, { name: 'conversion value' }, { name: 'conv. value' }, { name: 'purchase value' }, { name: 'purchases conversion value' }],
  ctr: [{ name: 'ctr' }, { name: 'ctr (link click-through rate)' }, { name: 'link ctr' }],
  cpc: [{ name: 'cpc' }, { name: 'cost per click' }, { name: 'cpc (cost per link click)' }, { name: 'avg. cpc' }],
  cpm: [{ name: 'cpm' }, { name: 'cost per 1,000 impressions' }, { name: 'cpm (cost per 1,000 impressions)' }, { name: 'avg. cpm' }],
  costPerResult: [{ name: 'cost per result' }],
  costPerConversion: [{ name: 'cost / conv.' }, { name: 'cost per conversion' }],
  impressionShare: [{ name: 'search impr. share' }, { name: 'search impression share' }, { name: 'impr. share' }],
};

export function importCsvFile(filePath, { platform, level }) {
  if (extname(filePath).toLowerCase() !== '.csv') {
    return {
      ok: false,
      error: 'Only CSV imports are supported in this Phase 2 skeleton.',
      supportedExtensions: ['.csv'],
    };
  }

  const parsed = parseCsv(readFileSync(filePath, 'utf8'));
  if (parsed.rows.length === 0) {
    return { ok: false, error: 'CSV has no data rows.' };
  }

  const warnings = [];
  const normalizedRows = parsed.rows.map((row) => {
    const fields = {};
    for (const [target, aliases] of Object.entries(FIELD_ALIASES)) {
      const match = pick(row, aliases);
      if (!match || match.value === '') continue;
      const parsed = numericFields.has(target) ? parseNumber(match.value) : String(match.value).trim();
      fields[target] = typeof parsed === 'number' && match.divisor ? parsed / match.divisor : parsed;
    }
    return normalizedMetricRow({ platform, level, raw: row, fields });
  });

  for (const required of ['campaignName', 'impressions', 'clicks', 'spend']) {
    if (!normalizedRows.some((row) => row[required] != null)) warnings.push(`No ${required} column detected.`);
  }

  return {
    ok: true,
    source: filePath,
    rowCount: normalizedRows.length,
    headers: parsed.headers,
    headerRowIndex: parsed.headerRowIndex,
    warnings,
    normalizedRows,
  };
}

const numericFields = new Set([
  'reach',
  'frequency',
  'impressions',
  'clicks',
  'linkClicks',
  'spend',
  'conversions',
  'revenue',
  'ctr',
  'cpc',
  'cpm',
  'costPerResult',
  'costPerConversion',
  'impressionShare',
]);

function pick(row, aliases) {
  for (const alias of aliases) {
    const key = Object.keys(row).find((candidate) => normalizeHeader(candidate) === normalizeHeader(alias.name));
    if (key) return { value: row[key], key, divisor: alias.divisor };
  }
  return null;
}

function normalizeHeader(value) {
  return String(value)
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+\((usd|aud|cad|eur|gbp|jpy|inr)\)$/i, '')
    .replace(/\s+\[[^\]]+\]$/g, '');
}

function parseNumber(value) {
  const text = String(value).trim();
  if (!text || text === '-' || text === '--' || /^n\/a$/i.test(text)) return null;
  const negative = /^\(.*\)$/.test(text);
  const multiplier = /k$/i.test(text) ? 1_000 : /m$/i.test(text) ? 1_000_000 : 1;
  const cleaned = text
    .replace(/[,$%()]/g, '')
    .replace(/\b[A-Z]{3}\b/gi, '')
    .replace(/[^\d.+\-km]/gi, '')
    .replace(/[km]$/i, '')
    .trim();
  const parsed = Number(cleaned) * multiplier;
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

export function parseCsv(input) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const headerRowIndex = detectHeaderRowIndex(rows);
  const headers = (rows[headerRowIndex] ?? []).map((header) => header.trim().replace(/^\uFEFF/, ''));
  return {
    headers,
    headerRowIndex,
    rows: rows
      .slice(headerRowIndex + 1)
      .filter((cells) => cells.some((value) => String(value).trim()))
      .map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']))),
  };
}

function detectHeaderRowIndex(rows) {
  let bestIndex = 0;
  let bestScore = -1;
  rows.forEach((row, index) => {
    const normalized = new Set(row.map(normalizeHeader));
    let score = 0;
    for (const aliases of Object.values(FIELD_ALIASES)) {
      if (aliases.some((alias) => normalized.has(normalizeHeader(alias.name)))) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
}
