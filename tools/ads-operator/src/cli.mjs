import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditFile, createCampaignPlan } from './audit.mjs';
import { importCsvFile } from './csv.mjs';
import {
  createApprovalPacket,
  createReceipt,
  normalizeLevel,
  normalizePlatform,
  validateApprovalPacketInput,
  validateLevel,
  validatePlatform,
  validateReceiptInput,
} from './schema.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const toolDir = resolve(scriptDir, '..');
const repoRoot = resolve(toolDir, '..', '..');
const googleAdsWrapper = resolve(repoRoot, 'tools', 'google-ads', 'bin', 'google-ads.mjs');

const mutationCommands = new Set([
  'apply',
  'publish',
  'pause',
  'enable',
  'delete',
  'remove',
  'mutate',
  'upload',
  'set-budget',
  'change-budget',
]);

export function runCli(argv, io = process) {
  const args = [...argv];
  const command = args[0] || 'help';
  const json = args.includes('--json');

  try {
    if (mutationCommands.has(command)) {
      return write(io, {
        ok: false,
        error: 'Mutation commands are not implemented in this read-only Phase 2 skeleton.',
        requiresApproval: true,
        writeExecuted: false,
      }, 2, json);
    }

    if (command === 'help' || command === '--help' || command === '-h') return write(io, helpPayload(), 0, json);
    if (command === 'doctor') return write(io, doctorPayload(), 0, json);
    if (command === 'accounts') return write(io, accountsPayload(args), 0, json);
    if (command === 'campaigns') return write(io, campaignsPayload(args), 0, json);
    if (command === 'export-plan') return write(io, exportPlanPayload(args), 0, json);
    if (command === 'import') return importCommand(args, io, json);
    if (command === 'audit') return auditCommand(args, io, json);
    if (command === 'campaign-plan') return campaignPlanCommand(args, io, json);
    if (command === 'packet' && args[1] === 'create') return packetCreateCommand(args, io, json);
    if (command === 'receipt' && args[1] === 'create') return receiptCreateCommand(args, io, json);

    return write(io, {
      ok: false,
      error: `Unknown command: ${command}`,
      availableCommands: ['doctor', 'accounts', 'campaigns', 'export-plan', 'import', 'audit', 'campaign-plan', 'packet create', 'receipt create'],
    }, 2, json);
  } catch (error) {
    return write(io, { ok: false, error: error.message }, 1, json);
  }
}

function doctorPayload() {
  return {
    ok: true,
    tool: 'ads-operator',
    version: '0.1.0',
    mode: 'read_only',
    writesEnabled: false,
    platforms: {
      google: {
        route: 'google-ads-cli',
        wrapper: googleAdsWrapper,
        wrapperExists: existsSync(googleAdsWrapper),
      },
      meta: {
        route: 'browser-export',
        apiRoute: 'meta-ads source when connected',
        browserExportRequiredWhenApiMissing: true,
      },
    },
    commands: ['doctor', 'accounts', 'campaigns', 'export-plan', 'import', 'audit', 'campaign-plan', 'packet create', 'receipt create'],
  };
}

function accountsPayload(args) {
  const platform = requirePlatform(args);
  if (platform === 'google') {
    return {
      ok: true,
      platform,
      readOnly: true,
      route: 'google-ads-cli',
      command: ['node', googleAdsWrapper, 'customers', 'list-accessible-customers', '--agent'],
      writeExecuted: false,
    };
  }
  return {
    ok: true,
    platform,
    readOnly: true,
    route: 'browser-export',
    next: 'Open Meta Ads Manager, choose the ad account, export account/campaign tables, then run ads-operator import.',
    writeExecuted: false,
  };
}

function campaignsPayload(args) {
  const platform = requirePlatform(args);
  const account = opt(args, '--account') || opt(args, '--customer-id');
  if (platform === 'google') {
    if (!account) throw new Error('--account or --customer-id is required for google campaigns.');
    return {
      ok: true,
      platform,
      account,
      readOnly: true,
      route: 'google-ads-cli',
      command: [
        'node',
        googleAdsWrapper,
        'customers-google-ads',
        'search',
        account,
        '--agent',
        '--query',
        'SELECT campaign.id, campaign.name, campaign.status, metrics.impressions, metrics.clicks, metrics.cost_micros FROM campaign LIMIT 100',
      ],
      writeExecuted: false,
    };
  }
  return {
    ok: true,
    platform,
    account: account || null,
    readOnly: true,
    route: 'browser-export',
    exportPlan: exportPlan('meta', 'campaign'),
    writeExecuted: false,
  };
}

function exportPlanPayload(args) {
  const platform = requirePlatform(args);
  const level = requireLevel(args);
  return {
    ok: true,
    platform,
    level,
    readOnly: true,
    exportPlan: exportPlan(platform, level),
    writeExecuted: false,
  };
}

function importCommand(args, io, json) {
  const file = positional(args, 1);
  if (!file) return write(io, { ok: false, error: 'CSV file path is required.' }, 2, json);
  const platform = requirePlatform(args);
  const level = requireLevel(args);
  const result = importCsvFile(resolve(process.cwd(), file), { platform, level });
  return write(io, result, result.ok ? 0 : 1, json);
}

function auditCommand(args, io, json) {
  const file = positional(args, 1);
  if (!file) return write(io, { ok: false, error: 'CSV or normalized JSON file path is required.' }, 2, json);
  const platform = requirePlatform(args);
  const level = requireLevel(args);
  const goal = opt(args, '--goal', 'conversions');
  const result = auditFile(file, { platform, level, goal });
  return write(io, result, result.ok ? 0 : 1, json);
}

function campaignPlanCommand(args, io, json) {
  const platform = requirePlatform(args);
  const result = createCampaignPlan({
    platform,
    account: opt(args, '--account'),
    goal: opt(args, '--goal', 'conversions'),
    artistContextPath: opt(args, '--artist-context'),
    territories: opt(args, '--territories'),
    budget: opt(args, '--budget'),
  });
  const out = opt(args, '--out');
  return write(io, withOptionalFile(result, out, 'plan'), 0, json);
}

function packetCreateCommand(args, io, json) {
  const input = {
    platform: normalizePlatform(opt(args, '--platform')),
    type: opt(args, '--type'),
    account: opt(args, '--account'),
    action: opt(args, '--action'),
    spendImpact: opt(args, '--spend-impact'),
    evidence: opt(args, '--evidence'),
    rollbackPlan: opt(args, '--rollback-plan'),
  };
  const errors = validateApprovalPacketInput(input);
  if (errors.length) return write(io, { ok: false, errors, requiresApproval: true, writeExecuted: false }, 2, json);
  const packet = createApprovalPacket(input);
  const out = opt(args, '--out');
  return write(io, withOptionalFile({ ok: true, packet }, out, 'packet'), 0, json);
}

function receiptCreateCommand(args, io, json) {
  const input = {
    packet: opt(args, '--packet'),
    status: opt(args, '--status'),
    note: opt(args, '--note'),
    evidence: opt(args, '--evidence'),
    writeExecuted: args.includes('--write-executed'),
  };
  const errors = validateReceiptInput(input);
  if (errors.length) return write(io, { ok: false, errors, writeExecuted: false }, 2, json);
  const receipt = createReceipt(input);
  const out = opt(args, '--out');
  return write(io, withOptionalFile({ ok: true, receipt }, out, 'receipt'), 0, json);
}

function exportPlan(platform, level) {
  const commonColumns = ['Campaign name', 'Impressions', 'Clicks', 'Spend', 'Conversions', 'Date'];
  const platformColumns = platform === 'google'
    ? ['Campaign status', 'CTR', 'Avg. CPC', 'Cost', 'Conv. value']
    : ['Ad set name', 'Ad name', 'Amount spent', 'Results', 'CPM', 'Frequency'];
  return {
    platform,
    level,
    source: platform === 'google' ? 'Google Ads UI or google-ads CLI report' : 'Meta Ads Manager export',
    fileType: 'csv',
    requiredColumns: commonColumns,
    usefulColumns: platformColumns,
    steps: platform === 'google'
      ? ['Open Google Ads campaign table or use google-ads GAQL.', 'Set date range.', 'Export CSV with campaign metrics.', 'Run ads-operator import.']
      : ['Open Meta Ads Manager.', 'Select campaign/ad set/ad level table.', 'Set date range and attribution view.', 'Export CSV.', 'Run ads-operator import.'],
  };
}

function requirePlatform(args) {
  const platform = normalizePlatform(opt(args, '--platform'));
  if (!validatePlatform(platform)) throw new Error('--platform must be google or meta.');
  return platform;
}

function requireLevel(args) {
  const level = normalizeLevel(opt(args, '--level', 'campaign'));
  if (!validateLevel(level)) throw new Error('--level is not supported yet.');
  return level;
}

function opt(args, name, fallback = undefined) {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) return fallback;
  return args[index + 1];
}

function positional(args, offset) {
  const values = [];
  for (let index = offset; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      continue;
    }
    if (arg.startsWith('--')) {
      index += 1;
      continue;
    }
    values.push(arg);
  }
  return values[0];
}

function helpPayload() {
  return {
    ok: true,
    usage: 'node tools/ads-operator/bin/ads-operator.mjs <doctor|accounts|campaigns|export-plan|import|audit|campaign-plan|packet create|receipt create> --json',
    writesEnabled: false,
  };
}

function withOptionalFile(payload, out, key) {
  if (!out) return payload;
  const outputPath = resolve(process.cwd(), out);
  mkdirSync(dirname(outputPath), { recursive: true });
  const artifact = key === 'plan' ? payload : payload[key];
  writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return { ...payload, outputPath };
}

function write(io, payload, exitCode, json) {
  const output = json || payload.ok === false
    ? JSON.stringify(payload, null, 2)
    : payload.message || JSON.stringify(payload, null, 2);
  io.stdout.write(`${output}\n`);
  io.exitCode = exitCode;
  return payload;
}
