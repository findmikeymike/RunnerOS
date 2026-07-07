import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { importCsvFile } from './csv.mjs';
import { normalizeLevel, normalizePlatform } from './schema.mjs';

const CONVERSION_GOALS = new Set(['conversions', 'leads', 'sales', 'roas']);

export function auditFile(filePath, { platform, level = 'campaign', goal = 'conversions' }) {
  const rows = loadRows(filePath, { platform, level });
  if (!rows.ok) return rows;
  return auditRows(rows.normalizedRows, {
    platform: normalizePlatform(platform),
    level: normalizeLevel(level),
    goal,
    source: filePath,
  });
}

export function auditRows(normalizedRows, { platform, level, goal, source = null }) {
  const rows = normalizedRows.filter(Boolean);
  if (!rows.length) return { ok: false, error: 'No normalized rows to audit.' };
  const detectedCoreColumns = detectCoreColumns(rows);
  if (detectedCoreColumns.length === 0) {
    return {
      ok: false,
      error: 'Input does not look like a supported ads export.',
      rowCount: rows.length,
      detectedCoreColumns,
    };
  }

  const totals = summarize(rows);
  const findings = [];

  for (const row of rows) {
    const label = rowLabel(row);
    if ((row.spend ?? 0) > 0 && (row.clicks ?? 0) === 0) {
      findings.push(finding('high', 'spend_without_clicks', label, 'Spend exists but clicks are zero.', row));
    }
    if (CONVERSION_GOALS.has(goal) && (row.spend ?? 0) > 0 && (row.conversions ?? 0) === 0) {
      findings.push(finding('high', 'spend_without_conversions', label, 'Spend exists but conversions are zero.', row));
    }
    if ((row.impressions ?? 0) >= 1000 && (row.ctr ?? derivedCtr(row)) != null && (row.ctr ?? derivedCtr(row)) < 0.75) {
      findings.push(finding('medium', 'low_ctr', label, 'CTR is below 0.75% with meaningful impressions.', row));
    }
    if (platform === 'meta' && (row.frequency ?? 0) >= 3 && (row.ctr ?? derivedCtr(row) ?? 100) < 1.5) {
      findings.push(finding('medium', 'creative_fatigue_signal', label, 'Frequency is high while CTR is weak; creative may be fatiguing.', row));
    }
    if (level === 'search_term' && (row.spend ?? 0) > 0 && (row.conversions ?? 0) === 0) {
      findings.push(finding('medium', 'negative_keyword_candidate', label, 'Search term spent with no conversions; review as a negative or match-type issue.', row));
    }
  }

  const topSpend = [...rows].sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0))[0];
  if (topSpend && totals.spend > 0 && (topSpend.spend ?? 0) / totals.spend >= 0.6 && rows.length > 1) {
    findings.push(finding('medium', 'budget_concentration', rowLabel(topSpend), 'One row holds 60%+ of spend; verify this is intentional.', topSpend));
  }

  return {
    ok: true,
    schema: 'runneros.ads.audit.v1',
    platform,
    level,
    goal,
    source,
    rowCount: rows.length,
    detectedCoreColumns,
    totals,
    findings,
    recommendedActions: recommend(findings, { platform, level, goal }),
    requiresApprovalForWrites: true,
    writeExecuted: false,
  };
}

function detectCoreColumns(rows) {
  return ['campaignName', 'impressions', 'clicks', 'spend']
    .filter((field) => rows.some((row) => row[field] != null));
}

export function createCampaignPlan({ platform, goal = 'conversions', artistContextPath, territories, budget, account }) {
  const context = artistContextPath ? readFileSync(resolve(process.cwd(), artistContextPath), 'utf8') : '';
  const contextSignals = extractSignals(context);
  const selectedTerritories = parseList(territories);
  const normalizedPlatform = normalizePlatform(platform);

  return {
    ok: true,
    schema: 'runneros.ads.campaign_plan.v1',
    platform: normalizedPlatform,
    account: account || null,
    goal,
    budget: budget || null,
    artistContext: {
      provided: Boolean(context),
      path: artistContextPath || null,
      signals: contextSignals,
    },
    recommendedStructure: {
      objective: objectiveFor(goal, normalizedPlatform),
      campaign: `${title(goal)} test campaign`,
      adSets: buildAdSets(selectedTerritories, contextSignals),
      creativeTests: [
        'core story / identity hook',
        'social proof or cultural proof',
        'direct offer or streaming/conversion ask',
      ],
    },
    territoryResearch: {
      providedTerritories: selectedTerritories,
      nextResearch: [
        'rank territories by existing audience density, streaming/listener concentration, and conversion cost proxy',
        'check local culture pockets, venue/event gravity, college scenes, language fit, and genre affinity',
        'compare CPM/CPC/CPA from prior exports before moving budget',
      ],
    },
    approvalGate: {
      requiredBeforePublish: true,
      packetType: 'publish',
      minimumEvidence: ['artist context', 'target audience rationale', 'territory rationale', 'budget/spend impact', 'creative variants'],
    },
    writeExecuted: false,
  };
}

function loadRows(filePath, { platform, level }) {
  const absolute = resolve(process.cwd(), filePath);
  if (extname(absolute).toLowerCase() === '.csv') return importCsvFile(absolute, { platform, level });
  if (extname(absolute).toLowerCase() !== '.json') {
    return { ok: false, error: 'Audit input must be a CSV export or ads-operator import JSON.' };
  }
  const parsed = JSON.parse(readFileSync(absolute, 'utf8'));
  const normalizedRows = Array.isArray(parsed) ? parsed : parsed.normalizedRows;
  if (!Array.isArray(normalizedRows)) return { ok: false, error: 'JSON audit input must contain normalizedRows.' };
  return { ok: true, normalizedRows };
}

function summarize(rows) {
  const totals = {
    spend: sum(rows, 'spend'),
    impressions: sum(rows, 'impressions'),
    clicks: sum(rows, 'clicks'),
    conversions: sum(rows, 'conversions'),
    revenue: sum(rows, 'revenue'),
  };
  totals.ctr = totals.impressions ? round((totals.clicks / totals.impressions) * 100) : null;
  totals.cpc = totals.clicks ? round(totals.spend / totals.clicks) : null;
  totals.cpa = totals.conversions ? round(totals.spend / totals.conversions) : null;
  totals.roas = totals.spend ? round(totals.revenue / totals.spend) : null;
  return totals;
}

function finding(severity, code, subject, message, row) {
  return {
    severity,
    code,
    subject,
    message,
    metrics: {
      spend: row.spend,
      impressions: row.impressions,
      clicks: row.clicks,
      conversions: row.conversions,
      revenue: row.revenue,
      ctr: row.ctr ?? derivedCtr(row),
      cpa: row.conversions ? round((row.spend ?? 0) / row.conversions) : null,
    },
  };
}

function recommend(findings, { platform, level, goal }) {
  const codes = new Set(findings.map((item) => item.code));
  const actions = [];
  if (codes.has('spend_without_conversions')) actions.push('Pull placement/audience/search-term detail before increasing spend.');
  if (codes.has('spend_without_clicks')) actions.push('Check delivery, creative relevance, and landing-page or click objective alignment.');
  if (codes.has('low_ctr')) actions.push('Test sharper hooks and audience-message fit before scaling.');
  if (codes.has('creative_fatigue_signal')) actions.push('Refresh creative and split new variants before raising budget.');
  if (codes.has('negative_keyword_candidate')) actions.push('Review search terms for negative keyword or match-type cleanup.');
  if (codes.has('budget_concentration')) actions.push('Verify budget concentration is intentional and supported by CPA/ROAS.');
  if (!actions.length) actions.push(`No obvious ${platform} ${level} waste flags for ${goal}; inspect segment breakdown before live changes.`);
  return actions;
}

function buildAdSets(territories, signals) {
  const territorySet = territories.length ? territories : ['best-current-audience-territory', 'low-cost-test-territory', 'lookalike/interest-expansion-territory'];
  return territorySet.map((territory, index) => ({
    name: `${territory} / ${index === 0 ? 'core fans' : 'test pocket'}`,
    territory,
    audienceSignals: signals.slice(0, 8),
    budgetRole: index === 0 ? 'control' : 'exploration',
  }));
}

function extractSignals(context) {
  const tokens = context
    .split(/[^A-Za-z0-9#@'&-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && token.length <= 32);
  const ignored = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'artist', 'music', 'song', 'songs', 'brand']);
  const counts = new Map();
  for (const token of tokens) {
    const key = token.toLowerCase();
    if (ignored.has(key)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([value]) => value);
}

function objectiveFor(goal, platform) {
  if (goal === 'traffic') return platform === 'meta' ? 'Traffic' : 'Maximize clicks';
  if (goal === 'awareness') return platform === 'meta' ? 'Awareness' : 'Target impression share';
  if (goal === 'leads') return platform === 'meta' ? 'Leads' : 'Lead form / conversions';
  if (goal === 'sales' || goal === 'roas') return platform === 'meta' ? 'Sales' : 'Maximize conversion value';
  return platform === 'meta' ? 'Sales or Leads' : 'Conversions';
}

function parseList(value = '') {
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function rowLabel(row) {
  return row.searchTerm || row.keyword || row.adName || row.adSetName || row.adGroupName || row.campaignName || 'unnamed row';
}

function derivedCtr(row) {
  return row.impressions ? round(((row.clicks ?? 0) / row.impressions) * 100) : null;
}

function sum(rows, key) {
  return round(rows.reduce((total, row) => total + (Number(row[key]) || 0), 0));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function title(value) {
  return String(value).replace(/[-_]+/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}
