import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = resolve(import.meta.dirname, '..', 'bin', 'ads-operator.mjs');
const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  return {
    status: result.status,
    stdout: result.stdout ? JSON.parse(result.stdout) : null,
    stderr: result.stderr,
  };
}

function tempCsv(contents) {
  const dir = mkdtempSync(join(tmpdir(), 'runneros-ads-operator-'));
  tempDirs.push(dir);
  const file = join(dir, 'export.csv');
  writeFileSync(file, contents, 'utf8');
  return file;
}

function tempFile(name, contents) {
  const dir = mkdtempSync(join(tmpdir(), 'runneros-ads-operator-'));
  tempDirs.push(dir);
  const file = join(dir, name);
  writeFileSync(file, contents, 'utf8');
  return file;
}

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'runneros-ads-operator-'));
  tempDirs.push(dir);
  return dir;
}

describe('ads-operator cli', () => {
  test('doctor is deterministic and read-only', () => {
    const result = run(['doctor', '--json']);

    expect(result.status).toBe(0);
    expect(result.stdout.ok).toBe(true);
    expect(result.stdout.mode).toBe('read_only');
    expect(result.stdout.writesEnabled).toBe(false);
    expect(result.stdout.platforms.google.route).toBe('google-ads-cli');
    expect(result.stdout.platforms.meta.route).toBe('browser-export');
    expect(result.stdout.platforms.spotify.route).toBe('spotify-ads-manager-browser');
  });

  test('routes google account discovery to the existing google-ads wrapper without executing it', () => {
    const result = run(['accounts', '--platform', 'google', '--json']);

    expect(result.status).toBe(0);
    expect(result.stdout.route).toBe('google-ads-cli');
    expect(result.stdout.command).toContain('customers');
    expect(result.stdout.command).toContain('list-accessible-customers');
    expect(result.stdout.writeExecuted).toBe(false);
  });

  test('routes meta campaign discovery to browser export mode', () => {
    const result = run(['campaigns', '--platform', 'meta', '--json']);

    expect(result.status).toBe(0);
    expect(result.stdout.route).toBe('browser-export');
    expect(result.stdout.exportPlan.fileType).toBe('csv');
    expect(result.stdout.writeExecuted).toBe(false);
  });

  test('routes Spotify campaign discovery to Ads Manager ad set reporting', () => {
    const result = run(['campaigns', '--platform', 'spotify', '--json']);

    expect(result.status).toBe(0);
    expect(result.stdout.route).toBe('browser-export');
    expect(result.stdout.exportPlan.platform).toBe('spotify');
    expect(result.stdout.exportPlan.level).toBe('adset');
    expect(result.stdout.exportPlan.source).toBe('Spotify Ads Manager ad set report');
    expect(result.stdout.exportPlan.usefulColumns).toContain('Completion rate');
    expect(result.stdout.writeExecuted).toBe(false);
  });

  test('creates a public Meta Ad Library browser research plan', () => {
    const result = run([
      'ad-library-plan',
      '--artist',
      'Watching Tornado Videos',
      '--competitors',
      'Artist One,Artist Two',
      '--keywords',
      'viral indie song, late night driving song',
      '--countries',
      'US,GB',
      '--json',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout.ok).toBe(true);
    expect(result.stdout.route).toBe('browser-tiktok-discovery-meta-validation');
    expect(result.stdout.loginRequired).toBe(false);
    expect(result.stdout.writeExecuted).toBe(false);
    expect(result.stdout.searchTerms).toContain('Watching Tornado Videos');
    expect(result.stdout.searchTerms).toContain('Artist One');
    expect(result.stdout.countries).toEqual(['US', 'GB']);
    expect(result.stdout.browserSteps.join(' ')).toContain('All ads');
  });

  test('analyzes captured Meta Ad Library examples into an intel packet', () => {
    const file = tempFile('ad-library.json', JSON.stringify({
      ads: [
        {
          pageName: 'Artist One',
          searchTerm: 'late night driving song',
          adText: 'If you like sad late night drives, this song is for you. Listen now.',
          headline: 'New single out now',
          cta: 'Listen Now',
          mediaType: 'video',
          platforms: ['facebook', 'instagram'],
        },
        {
          pageName: 'Artist Two',
          searchTerm: 'viral indie song',
          adText: 'Watch the official video that fans keep sharing.',
          headline: 'Official video',
          cta: 'Watch Now',
          mediaType: 'video',
        },
        {
          pageName: 'Artist Two',
          searchTerm: 'viral indie song',
          adText: 'The new visualizer is out now. Watch now.',
          headline: 'Visualizer',
          cta: 'Watch Now',
          mediaType: 'video',
        },
      ],
    }));
    const result = run(['ad-library-analyze', file, '--artist', 'Watching Tornado Videos', '--json']);

    expect(result.status).toBe(0);
    expect(result.stdout.ok).toBe(true);
    expect(result.stdout.schema).toBe('runneros.ads.ad_library_intel.v1');
    expect(result.stdout.confidence.performanceData).toBe('none');
    expect(result.stdout.patterns.formats['music-video-clip']).toBe(2);
    expect(result.stdout.patterns.angles.identity).toBe(1);
    expect(result.stdout.patterns.hooks[0]).toContain('late night drives');
    expect(result.stdout.competitiveGap.diversityRead).toBe('wide');
    expect(result.stdout.competitiveGap.provenFormats).toContain('music-video-clip');
    expect(result.stdout.competitiveGap.underusedFormats).toContain('performance-video');
    expect(result.stdout.competitiveGap.strategicRead).toContain('proven lanes');
    expect(result.stdout.competitiveGap.optionalWhiteSpace).toContain('optional test lanes');
    expect(result.stdout.recommendations.join(' ')).toContain('artist context');
    expect(result.stdout.writeExecuted).toBe(false);
  });

  test('imports a CSV export into normalized metric rows', () => {
    const file = tempCsv('Campaign name,Impressions,Clicks,Amount spent,Results,Date\nLaunch,1000,50,$125.50,7,2026-07-01\n');
    const result = run(['import', file, '--platform', 'meta', '--level', 'campaign', '--json']);

    expect(result.status).toBe(0);
    expect(result.stdout.ok).toBe(true);
    expect(result.stdout.rowCount).toBe(1);
    expect(result.stdout.normalizedRows[0].campaignName).toBe('Launch');
    expect(result.stdout.normalizedRows[0].spend).toBe(125.5);
    expect(result.stdout.normalizedRows[0].conversions).toBe(7);
    expect(result.stdout.normalizedRows[0].raw['Amount spent']).toBe('$125.50');
  });

  test('normalizes Spotify Ads Manager completion metrics', () => {
    const file = tempCsv('Ad set name,Impressions,Reach,Frequency,Clicks,CTR,Spend,Completion rate,Ad played to 25%,Ad played to 50%,Ad played to 75%,Ad played to 100%\nNight Drive,10000,8000,1.25,120,1.2,$75,82%,94%,90%,86%,82%\n');
    const result = run(['import', file, '--platform', 'spotify', '--level', 'adset', '--json']);

    expect(result.status).toBe(0);
    expect(result.stdout.normalizedRows[0].platform).toBe('spotify');
    expect(result.stdout.normalizedRows[0].adSetName).toBe('Night Drive');
    expect(result.stdout.normalizedRows[0].completionRate).toBe(82);
    expect(result.stdout.normalizedRows[0].played25).toBe(94);
    expect(result.stdout.normalizedRows[0].played100).toBe(82);
  });

  test('accepts global json flag before import file path', () => {
    const file = tempCsv('Campaign name,Impressions,Clicks,Amount spent\nLaunch,100,10,$12\n');
    const result = run(['import', '--json', file, '--platform', 'meta', '--level', 'campaign']);

    expect(result.status).toBe(0);
    expect(result.stdout.ok).toBe(true);
    expect(result.stdout.rowCount).toBe(1);
  });

  test('rejects non-ad CSVs instead of auditing them as clean', () => {
    const file = tempCsv('foo,bar\na,b\n');
    const imported = run(['import', file, '--platform', 'meta', '--level', 'campaign', '--json']);
    const audited = run(['audit', file, '--platform', 'meta', '--level', 'campaign', '--json']);

    expect(imported.status).toBe(1);
    expect(imported.stdout.ok).toBe(false);
    expect(imported.stdout.error).toBe('CSV does not look like a supported ads export.');
    expect(audited.status).toBe(1);
    expect(audited.stdout.ok).toBe(false);
    expect(audited.stdout.error).toBe('CSV does not look like a supported ads export.');
  });

  test('rejects non-ad JSON inputs instead of auditing them as clean', () => {
    const junkArray = tempFile('junk-array.json', '[{"foo":"a"},{"bar":"b"}]');
    const junkObject = tempFile('junk-object.json', '{"normalizedRows":[{"foo":"a"}]}');
    const arrayResult = run(['audit', junkArray, '--platform', 'meta', '--level', 'campaign', '--json']);
    const objectResult = run(['audit', junkObject, '--platform', 'meta', '--level', 'campaign', '--json']);

    expect(arrayResult.status).toBe(1);
    expect(arrayResult.stdout.ok).toBe(false);
    expect(arrayResult.stdout.error).toBe('Input does not look like a supported ads export.');
    expect(objectResult.status).toBe(1);
    expect(objectResult.stdout.ok).toBe(false);
    expect(objectResult.stdout.error).toBe('Input does not look like a supported ads export.');
  });

  test('creates approval packets but does not execute writes', () => {
    const result = run([
      'packet',
      'create',
      '--platform',
      'google',
      '--type',
      'budget',
      '--account',
      '123',
      '--action',
      'Increase campaign budget from 20 to 30',
      '--spend-impact',
      '+10/day',
      '--evidence',
      'evidence/export.csv',
      '--json',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout.packet.requiresApproval).toBe(true);
    expect(result.stdout.packet.writeExecuted).toBe(false);
    expect(result.stdout.packet.evidence.value).toBe('evidence/export.csv');
    expect(result.stdout.packet.evidenceVerified).toBe(false);
    expect(result.stdout.packet.approvalPhrase).toBe('APPROVE GOOGLE BUDGET');
  });

  test('rejects approval packets with missing required safety fields', () => {
    const result = run(['packet', 'create', '--platform', 'meta', '--type', 'status', '--json']);

    expect(result.status).toBe(2);
    expect(result.stdout.ok).toBe(false);
    expect(result.stdout.errors).toContain('account is required');
    expect(result.stdout.writeExecuted).toBe(false);
  });

  test('approval packets redact secret-like text fields', () => {
    const result = run([
      'packet',
      'create',
      '--platform',
      'google',
      '--type',
      'budget',
      '--account',
      '123',
      '--action',
      'set token GOOGLE_ADS_ACCESS_TOKEN=shhh',
      '--spend-impact',
      'Bearer abc123',
      '--evidence',
      'evidence/export.csv',
      '--json',
    ]);

    const body = JSON.stringify(result.stdout);
    expect(result.status).toBe(0);
    expect(body).not.toContain('shhh');
    expect(body).not.toContain('abc123');
    expect(result.stdout.packet.action).toContain('GOOGLE_ADS_ACCESS_TOKEN=[redacted]');
    expect(result.stdout.packet.spendImpact).toBe('Bearer [redacted]');
  });

  test('redacts secret-like values from preserved raw CSV rows', () => {
    const file = tempCsv('Campaign name,Impressions,Clicks,Amount spent,Notes\nLaunch,10,1,$2,access_token=raw-secret\n');
    const result = run(['import', file, '--platform', 'meta', '--level', 'campaign', '--json']);

    expect(result.status).toBe(0);
    expect(JSON.stringify(result.stdout)).not.toContain('raw-secret');
    expect(result.stdout.normalizedRows[0].raw.Notes).toBe('access_token=[redacted]');
  });

  test('google cost micros imports are scaled to account currency units', () => {
    const file = tempCsv('Campaign name,Impressions,Clicks,Cost micros,Conversions\nSearch,1000,10,1250000,2\n');
    const result = run(['import', file, '--platform', 'google', '--level', 'campaign', '--json']);

    expect(result.status).toBe(0);
    expect(result.stdout.normalizedRows[0].spend).toBe(1.25);
    expect(result.stdout.normalizedRows[0].raw['Cost micros']).toBe('1250000');
  });

  test('imports Meta Ads Manager exports with report preamble and richer metrics', () => {
    const file = tempCsv([
      'Meta Ads report',
      'Account,Acme Ads',
      '',
      'Campaign name,Ad set name,Ad name,Delivery,Objective,Result type,Results,Reach,Impressions,Link clicks,Amount spent (USD),Purchases conversion value,CTR (link click-through rate),CPC (cost per link click),"CPM (cost per 1,000 impressions)",Frequency,Reporting starts',
      'Launch,Prospecting,Video 1,Active,Sales,Website purchases,12,"8,000","10,000",400,"$1,234.56","$3,210.00",4.00%,$3.09,$123.46,1.25,2026-07-01',
    ].join('\n'));
    const result = run(['import', file, '--platform', 'meta', '--level', 'ad', '--json']);

    expect(result.status).toBe(0);
    expect(result.stdout.ok).toBe(true);
    expect(result.stdout.headerRowIndex).toBe(3);
    expect(result.stdout.normalizedRows[0].campaignName).toBe('Launch');
    expect(result.stdout.normalizedRows[0].adSetName).toBe('Prospecting');
    expect(result.stdout.normalizedRows[0].adName).toBe('Video 1');
    expect(result.stdout.normalizedRows[0].status).toBe('Active');
    expect(result.stdout.normalizedRows[0].objective).toBe('Sales');
    expect(result.stdout.normalizedRows[0].resultType).toBe('Website purchases');
    expect(result.stdout.normalizedRows[0].conversions).toBe(12);
    expect(result.stdout.normalizedRows[0].reach).toBe(8000);
    expect(result.stdout.normalizedRows[0].impressions).toBe(10000);
    expect(result.stdout.normalizedRows[0].linkClicks).toBe(400);
    expect(result.stdout.normalizedRows[0].spend).toBe(1234.56);
    expect(result.stdout.normalizedRows[0].revenue).toBe(3210);
    expect(result.stdout.normalizedRows[0].ctr).toBe(4);
    expect(result.stdout.normalizedRows[0].cpc).toBe(3.09);
    expect(result.stdout.normalizedRows[0].cpm).toBe(123.46);
    expect(result.stdout.normalizedRows[0].frequency).toBe(1.25);
  });

  test('imports Google Ads search term exports with currency codes and percentages', () => {
    const file = tempCsv([
      'Report,Search terms',
      'Date range,Jul 1 2026 - Jul 7 2026',
      '',
      'Campaign,Ad group,Search term,Keyword,Currency code,Impr.,Clicks,Cost,Conversions,Conv. value,CTR,Avg. CPC,Cost / conv.,Search impr. share',
      'Brand Search,Exact Core,best running shoes,[running shoes],USD,"1,250",125,USD 456.78,18,"1,234.50",10.00%,USD 3.65,USD 25.38,76.50%',
    ].join('\n'));
    const result = run(['import', file, '--platform', 'google', '--level', 'search-term', '--json']);

    expect(result.status).toBe(0);
    expect(result.stdout.ok).toBe(true);
    expect(result.stdout.headerRowIndex).toBe(3);
    expect(result.stdout.normalizedRows[0].campaignName).toBe('Brand Search');
    expect(result.stdout.normalizedRows[0].adGroupName).toBe('Exact Core');
    expect(result.stdout.normalizedRows[0].searchTerm).toBe('best running shoes');
    expect(result.stdout.normalizedRows[0].keyword).toBe('[running shoes]');
    expect(result.stdout.normalizedRows[0].matchType).toBe(null);
    expect(result.stdout.normalizedRows[0].currency).toBe('USD');
    expect(result.stdout.normalizedRows[0].impressions).toBe(1250);
    expect(result.stdout.normalizedRows[0].clicks).toBe(125);
    expect(result.stdout.normalizedRows[0].spend).toBe(456.78);
    expect(result.stdout.normalizedRows[0].conversions).toBe(18);
    expect(result.stdout.normalizedRows[0].revenue).toBe(1234.5);
    expect(result.stdout.normalizedRows[0].ctr).toBe(10);
    expect(result.stdout.normalizedRows[0].cpc).toBe(3.65);
    expect(result.stdout.normalizedRows[0].costPerConversion).toBe(25.38);
    expect(result.stdout.normalizedRows[0].impressionShare).toBe(76.5);
  });

  test('does not mislabel keyword match type as the keyword', () => {
    const file = tempCsv('Campaign,Keyword match type,Impr.,Clicks,Cost\nBrand,Exact,1000,50,USD 10\n');
    const result = run(['import', file, '--platform', 'google', '--level', 'keyword', '--json']);

    expect(result.status).toBe(0);
    expect(result.stdout.normalizedRows[0].keyword).toBe(null);
    expect(result.stdout.normalizedRows[0].matchType).toBe('Exact');
  });

  test('audits normalized exports for spend waste and search-term cleanup', () => {
    const file = tempCsv([
      'Campaign,Ad group,Search term,Impr.,Clicks,Cost,Conversions,Conv. value,CTR',
      'Prospecting,Open Match,bad free download,"2,000",10,USD 200.00,0,0,0.50%',
      'Prospecting,Open Match,buy vinyl,"1,000",50,USD 100.00,5,500,5.00%',
    ].join('\n'));
    const result = run(['audit', file, '--platform', 'google', '--level', 'search-term', '--goal', 'conversions', '--json']);

    expect(result.status).toBe(0);
    expect(result.stdout.ok).toBe(true);
    expect(result.stdout.schema).toBe('runneros.ads.audit.v1');
    expect(result.stdout.totals.spend).toBe(300);
    expect(result.stdout.totals.conversions).toBe(5);
    expect(result.stdout.findings.map((finding) => finding.code)).toContain('spend_without_conversions');
    expect(result.stdout.findings.map((finding) => finding.code)).toContain('negative_keyword_candidate');
    expect(result.stdout.findings.map((finding) => finding.code)).toContain('low_ctr');
    expect(result.stdout.recommendedActions.join(' ')).toContain('negative keyword');
    expect(result.stdout.writeExecuted).toBe(false);
  });

  test('creates read-only campaign plans from artist context and territories', () => {
    const context = tempFile('artist-context.md', [
      'Artist: Luna Vale',
      'Sound: cinematic synth pop, night drive, heartbreak, club melancholy',
      'Audience: sad pop fans, alt girls, late night drivers, queer nightlife',
    ].join('\n'));
    const result = run([
      'campaign-plan',
      '--platform',
      'meta',
      '--goal',
      'leads',
      '--account',
      'act_123',
      '--budget',
      '$50/day',
      '--territories',
      'Los Angeles,London,Berlin',
      '--artist-context',
      context,
      '--json',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout.ok).toBe(true);
    expect(result.stdout.schema).toBe('runneros.ads.campaign_plan.v1');
    expect(result.stdout.artistContext.provided).toBe(true);
    expect(result.stdout.artistContext.signals).toContain('cinematic');
    expect(result.stdout.recommendedStructure.objective).toBe('Leads');
    expect(result.stdout.recommendedStructure.adSets.length).toBe(3);
    expect(result.stdout.territoryResearch.providedTerritories).toEqual(['Los Angeles', 'London', 'Berlin']);
    expect(result.stdout.approvalGate.requiredBeforePublish).toBe(true);
    expect(result.stdout.writeExecuted).toBe(false);
  });

  test('writes campaign plan artifacts', () => {
    const dir = tempDir();
    const context = tempFile('artist-context.md', 'Artist: Luna Vale\nAudience: synth pop fans in London\n');
    const planPath = join(dir, 'campaign-plan.json');
    const result = run([
      'campaign-plan',
      '--platform',
      'meta',
      '--goal',
      'sales',
      '--territories',
      'London',
      '--artist-context',
      context,
      '--out',
      planPath,
      '--json',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout.outputPath).toBe(planPath);
    expect(existsSync(planPath)).toBe(true);
    const savedPlan = JSON.parse(readFileSync(planPath, 'utf8'));
    expect(savedPlan.schema).toBe('runneros.ads.campaign_plan.v1');
    expect(savedPlan.writeExecuted).toBe(false);
  });

  test('creates Meta browser setup plans for campaign drafts without executing writes', () => {
    const dir = tempDir();
    const context = tempFile('artist-context.md', [
      'Artist: Luna Vale',
      'Audience: synth pop fans, nightlife, heartbreak edits',
    ].join('\n'));
    const setupPath = join(dir, 'meta-setup-plan.json');
    const result = run([
      'setup-plan',
      '--platform',
      'meta',
      '--goal',
      'leads',
      '--account',
      'act_123',
      '--budget',
      '$50/day',
      '--territories',
      'Los Angeles,London',
      '--campaign-name',
      'Luna Vale lead test',
      '--artist-context',
      context,
      '--out',
      setupPath,
      '--json',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout.ok).toBe(true);
    expect(result.stdout.schema).toBe('runneros.ads.setup_plan.v1');
    expect(result.stdout.platform).toBe('meta');
    expect(result.stdout.browserPlan.route).toBe('meta-ads-manager-browser');
    expect(result.stdout.browserPlan.startUrl).toContain('adsmanager.facebook.com');
    expect(result.stdout.browserPlan.campaignFields.name).toBe('Luna Vale lead test');
    expect(result.stdout.browserPlan.campaignFields.objective).toBe('Leads');
    expect(result.stdout.browserPlan.adSetFields.length).toBe(2);
    expect(result.stdout.browserPlan.browserSteps.join(' ')).toContain('Do not publish');
    expect(result.stdout.approvalGate.requiredBeforePublish).toBe(true);
    expect(result.stdout.approvalGate.packetCommand).toContain('packet create --platform meta');
    expect(result.stdout.writeExecuted).toBe(false);
    expect(result.stdout.outputPath).toBe(setupPath);
    expect(existsSync(setupPath)).toBe(true);
    const savedSetup = JSON.parse(readFileSync(setupPath, 'utf8'));
    expect(savedSetup.schema).toBe('runneros.ads.setup_plan.v1');
    expect(savedSetup.writeExecuted).toBe(false);
  });

  test('creates Spotify browser setup plans with campaign hierarchy and final launch gate', () => {
    const context = tempFile('artist-context.md', 'Artist: Luna Vale\nAudience: synth pop fans\nTop city: London\n');
    const result = run([
      'setup-plan',
      '--platform',
      'spotify',
      '--goal',
      'awareness',
      '--account',
      'spotify-main',
      '--budget',
      '$500 total',
      '--territories',
      'London,Manchester',
      '--campaign-name',
      'Night Drive audio awareness',
      '--artist-context',
      context,
      '--json',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout.platform).toBe('spotify');
    expect(result.stdout.browserPlan.route).toBe('spotify-ads-manager-browser');
    expect(result.stdout.browserPlan.startUrl).toBe('https://adsmanager.spotify.com/');
    expect(result.stdout.browserPlan.setupObjects).toEqual(['campaign', 'ad set', 'ad']);
    expect(result.stdout.browserPlan.campaignFields.objective).toBe('Reach');
    expect(result.stdout.browserPlan.adSetFields[0].format).toContain('Audio by default');
    expect(result.stdout.browserPlan.adFields[0].assetsNeeded).toContain('companion image for audio');
    expect(result.stdout.browserPlan.browserSteps.join(' ')).toContain('final review screen');
    expect(result.stdout.approvalGate.packetCommand).toContain('--platform spotify');
    expect(result.stdout.writeExecuted).toBe(false);
  });

  test('creates Spotify approval packets in the shared artifact format', () => {
    const result = run([
      'packet',
      'create',
      '--platform',
      'spotify',
      '--type',
      'publish',
      '--account',
      'spotify-main',
      '--action',
      'Launch Night Drive audio campaign',
      '--spend-impact',
      '$500 total',
      '--evidence',
      'evidence/spotify-draft.json',
      '--json',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout.packet.platform).toBe('spotify');
    expect(result.stdout.packet.approvalPhrase).toBe('APPROVE SPOTIFY PUBLISH');
    expect(result.stdout.packet.requiresApproval).toBe(true);
    expect(result.stdout.packet.writeExecuted).toBe(false);
  });

  test('normalizes setup plan goal consistently at top level and strategy level', () => {
    const result = run([
      'setup-plan',
      '--platform',
      'meta',
      '--goal',
      'Leads',
      '--territories',
      'Los Angeles',
      '--json',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout.ok).toBe(true);
    expect(result.stdout.goal).toBe('leads');
    expect(result.stdout.strategy.goal).toBe('leads');
    expect(result.stdout.browserPlan.campaignFields.objective).toBe('Leads');
  });

  test('rejects unsupported setup goals before producing browser fields', () => {
    const result = run([
      'setup-plan',
      '--platform',
      'meta',
      '--goal',
      'weird',
      '--territories',
      'Los Angeles',
      '--budget',
      '$50/day',
      '--json',
    ]);

    expect(result.status).toBe(2);
    expect(result.stdout.ok).toBe(false);
    expect(result.stdout.error).toContain('--goal must be one of');
    expect(result.stdout.allowedGoals).toContain('leads');
    expect(result.stdout.browserPlan).toBeNull();
    expect(result.stdout.writeExecuted).toBe(false);
  });

  test('setup plans require explicit territories before browser field instructions', () => {
    const result = run([
      'setup-plan',
      '--platform',
      'meta',
      '--goal',
      'leads',
      '--budget',
      '$50/day',
      '--json',
    ]);

    expect(result.status).toBe(2);
    expect(result.stdout.ok).toBe(false);
    expect(result.stdout.requiresInput).toBe(true);
    expect(result.stdout.missingInputs).toEqual(['territories']);
    expect(result.stdout.browserPlan).toBeNull();
    expect(JSON.stringify(result.stdout)).not.toContain('best-current-audience-territory');
    expect(JSON.stringify(result.stdout)).not.toContain('low-cost-test-territory');
    expect(JSON.stringify(result.stdout)).not.toContain('lookalike/interest-expansion-territory');
    expect(result.stdout.writeExecuted).toBe(false);
  });

  test('approval packet marks existing local evidence as verified', () => {
    const file = tempCsv('Campaign name,Impressions,Clicks,Spend\nLaunch,1,1,1\n');
    const result = run([
      'packet',
      'create',
      '--platform',
      'meta',
      '--type',
      'status',
      '--account',
      'act_1',
      '--action',
      'Pause campaign',
      '--spend-impact',
      'stops spend',
      '--evidence',
      file,
      '--json',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout.packet.evidence).toEqual({ type: 'local_path', value: file, verified: true });
    expect(result.stdout.packet.evidenceVerified).toBe(true);
  });

  test('writes approval packet files and creates receipts from them', () => {
    const dir = tempDir();
    const packetPath = join(dir, 'budget-packet.json');
    const receiptPath = join(dir, 'budget-receipt.json');
    const packetResult = run([
      'packet',
      'create',
      '--platform',
      'google',
      '--type',
      'budget',
      '--account',
      '123',
      '--action',
      'Increase campaign budget from 20 to 30',
      '--spend-impact',
      '+10/day',
      '--evidence',
      'evidence/export.csv',
      '--out',
      packetPath,
      '--json',
    ]);

    expect(packetResult.status).toBe(0);
    expect(packetResult.stdout.outputPath).toBe(packetPath);
    expect(existsSync(packetPath)).toBe(true);
    const savedPacket = JSON.parse(readFileSync(packetPath, 'utf8'));
    expect(savedPacket.schema).toBe('runneros.ads.approval_packet.v1');
    expect(savedPacket.writeExecuted).toBe(false);

    const receiptResult = run([
      'receipt',
      'create',
      '--packet',
      packetPath,
      '--status',
      'approved',
      '--note',
      'Approved in chat',
      '--out',
      receiptPath,
      '--json',
    ]);

    expect(receiptResult.status).toBe(0);
    expect(receiptResult.stdout.outputPath).toBe(receiptPath);
    expect(receiptResult.stdout.receipt.schema).toBe('runneros.ads.receipt.v1');
    expect(receiptResult.stdout.receipt.packetApprovalPhrase).toBe('APPROVE GOOGLE BUDGET');
    expect(receiptResult.stdout.receipt.status).toBe('approved');
    expect(receiptResult.stdout.receipt.writeExecuted).toBe(false);
    const savedReceipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    expect(savedReceipt.schema).toBe('runneros.ads.receipt.v1');
  });

  test('receipt creation rejects executed write claims in read-only mode', () => {
    const dir = tempDir();
    const packetPath = join(dir, 'status-packet.json');
    run([
      'packet',
      'create',
      '--platform',
      'meta',
      '--type',
      'status',
      '--account',
      'act_1',
      '--action',
      'Pause campaign',
      '--spend-impact',
      'stops spend',
      '--evidence',
      'evidence/export.csv',
      '--out',
      packetPath,
      '--json',
    ]);
    const writeClaim = run(['receipt', 'create', '--packet', packetPath, '--status', 'approved', '--write-executed', '--json']);
    const executedStatus = run(['receipt', 'create', '--packet', packetPath, '--status', 'executed', '--json']);

    expect(writeClaim.status).toBe(2);
    expect(writeClaim.stdout.ok).toBe(false);
    expect(writeClaim.stdout.errors).toContain('write-executed is not supported by the read-only ads operator');
    expect(executedStatus.status).toBe(2);
    expect(executedStatus.stdout.ok).toBe(false);
    expect(executedStatus.stdout.errors).toContain('status must be one of: approved, rejected, skipped');
  });

  test('approval packets redact browser session and cookie-like secrets', () => {
    const result = run([
      'packet',
      'create',
      '--platform',
      'google',
      '--type',
      'budget',
      '--account',
      '123',
      '--action',
      'cookie=secret123 session=abc Cookie: sid=rawvalue',
      '--spend-impact',
      'csrf_token=def',
      '--evidence',
      'evidence/export.csv',
      '--json',
    ]);

    const body = JSON.stringify(result.stdout);
    expect(result.status).toBe(0);
    expect(body).not.toContain('secret123');
    expect(body).not.toContain('session=abc');
    expect(body).not.toContain('rawvalue');
    expect(body).not.toContain('csrf_token=def');
    expect(result.stdout.packet.action).toContain('cookie=[redacted]');
    expect(result.stdout.packet.action).toContain('session=[redacted]');
    expect(result.stdout.packet.action).toContain('Cookie:[redacted]');
    expect(result.stdout.packet.spendImpact).toBe('csrf_token=[redacted]');
  });

  test('fails closed for mutation-like commands', () => {
    const result = run(['pause', '--platform', 'google', '--account', '123', '--json']);

    expect(result.status).toBe(2);
    expect(result.stdout.ok).toBe(false);
    expect(result.stdout.requiresApproval).toBe(true);
    expect(result.stdout.writeExecuted).toBe(false);
  });
});
