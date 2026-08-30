import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { getWorkspaces, loadPreferences } from '@craft-agent/shared/config';
import {
  MISSION_BRIEF_CONTEXT_SLUG,
  RELEASE_BOARD_CONTEXT_SLUG,
  getBoardTotals,
  parseMissionBriefDocResult,
  parseReleaseBoardDocResult,
} from '@craft-agent/shared/artist-context';
import {
  CAMPAIGN_CALENDAR_CONTEXT_SLUG,
  parseCampaignCalendarDocResult,
} from '@craft-agent/shared/campaign-calendar';
import type {
  BuildHqStateInput,
  ManagerCampaignSnapshot,
  ManagerCollectionSummary,
  ManagerSourceHealth,
} from '@craft-agent/shared/hq-state';
import {
  getMissionAssetManifestPath,
  loadMissionAssetManifest,
} from '@craft-agent/shared/mission-assets';
import { listOutputManifests } from '@craft-agent/shared/outputs';
import {
  parseScheduledWorkDocResult,
  SCHEDULED_WORK_CONTEXT_SLUG,
} from '@craft-agent/shared/scheduled-work';
import { loadAuthorizedContextDocsForAgent, loadContextDoc } from '@craft-agent/shared/workspace-context';
import { CONCIERGE_SLUG } from '@craft-agent/shared/agent-definitions';
import { buildHqOperationalSnapshot } from './operational';

const DAY_MS = 24 * 60 * 60 * 1000;
const CAMPAIGN_SOURCE_STALE_DAYS = {
  'mission-brief': 30,
  'release-board': 14,
  'campaign-calendar': 14,
  'scheduled-work': 7,
  'mission-assets': 30,
  outputs: 30,
} as const;

export function buildHqStateInput(workspaceRootPath: string, now = new Date()): BuildHqStateInput {
  const workspace = getWorkspaces().find((candidate) => candidate.rootPath === workspaceRootPath);
  if (!existsSync(workspaceRootPath)) throw new Error(`HQ workspace does not exist: ${workspaceRootPath}`);
  return {
    workspaceId: workspace?.id ?? basename(workspaceRootPath),
    docs: loadAuthorizedContextDocsForAgent(workspaceRootPath, CONCIERGE_SLUG),
    relatedCampaigns: workspace ? buildManagerCampaignSnapshots(now) : [],
    operational: buildHqOperationalSnapshot(workspaceRootPath),
    timezone: resolveTimelineTimezone(),
    now,
  };
}

/**
 * Resolve the reference timezone: the user's preference when set and valid,
 * otherwise the system timezone (spec 20 §13.1 — no new setting).
 */
export function resolveTimelineTimezone(): string {
  const preferred = loadPreferences().timezone?.trim();
  if (preferred) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: preferred });
      return preferred;
    } catch {
      // Invalid preference falls through to the system zone.
    }
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function buildManagerCampaignSnapshots(now = new Date()): ManagerCampaignSnapshot[] {
  const campaigns = getWorkspaces().filter((workspace) => workspace.artistWorkspaceScope === 'campaign');
  return campaigns.map((workspace, index) => buildManagerCampaignSnapshot(workspace, index === 0, now));
}

export function findArtistHqWorkspace() {
  return getWorkspaces().find((workspace) => workspace.artistWorkspaceScope === 'hq') ?? null;
}

export function buildManagerCampaignSnapshot(
  workspace: ReturnType<typeof getWorkspaces>[number],
  primary: boolean,
  now = new Date(),
): ManagerCampaignSnapshot {
  const missionDoc = loadContextDoc(workspace.rootPath, MISSION_BRIEF_CONTEXT_SLUG);
  const mission = parseMissionBriefDocResult(missionDoc ?? undefined);
  const boardDoc = loadContextDoc(workspace.rootPath, RELEASE_BOARD_CONTEXT_SLUG);
  const board = parseReleaseBoardDocResult(boardDoc ?? undefined);
  const calendarDoc = loadContextDoc(workspace.rootPath, CAMPAIGN_CALENDAR_CONTEXT_SLUG);
  const calendar = parseCampaignCalendarDocResult(calendarDoc ?? undefined, workspace.id);
  const workDoc = loadContextDoc(workspace.rootPath, SCHEDULED_WORK_CONTEXT_SLUG);
  const work = parseScheduledWorkDocResult(workDoc ?? undefined, workspace.id);
  const assetPath = getMissionAssetManifestPath(workspace.rootPath);
  const assetsPresent = existsSync(assetPath);
  const assets = loadMissionAssetManifest(workspace.rootPath, workspace.id);
  const outputs = listOutputManifests(workspace.rootPath);
  const totals = board.ok ? getBoardTotals(board.board) : undefined;
  const nextMissing = board.ok
    ? board.board.categories.flatMap((category) => category.items)
      .filter((item) => item.status === 'needed')
      .map((item) => item.label)
      .slice(0, 5)
    : [];
  const today = now.toISOString().slice(0, 10);
  const calendarCandidates = calendar.ok
    ? calendar.calendar.items
      .filter((item) => !item.deletedAt && !['done', 'canceled'].includes(item.status))
      .map((item) => ({
        title: item.title,
        date: item.time ? `${item.date} ${item.time}` : item.date,
        status: item.status,
        timing: item.date < today ? 'overdue' as const : 'upcoming' as const,
        sortKey: `${item.date}T${item.time ?? '00:00'}`,
      }))
    : [];
  const workCandidates = work.ok
    ? work.work.items
      .filter((item) => !item.deletedAt && !['done', 'canceled'].includes(item.status))
      .map((item) => ({
        title: item.title,
        startAt: item.startAt,
        status: item.status,
        timing: Date.parse(item.startAt) < now.getTime() ? 'overdue' as const : 'upcoming' as const,
        sortKey: item.startAt,
      }))
    : [];

  return {
    workspaceId: workspace.id,
    name: workspace.name,
    primary,
    mission: mission.ok ? mission.brief : undefined,
    readiness: totals ? { ...totals, nextMissing } : undefined,
    calendar: collectionSummary(
      calendar.ok ? calendar.calendar.items.filter((item) => !item.deletedAt) : [],
      calendarDoc && calendar.ok ? calendar.calendar.updatedAt : undefined,
    ),
    work: collectionSummary(
      work.ok ? work.work.items.filter((item) => !item.deletedAt) : [],
      workDoc && work.ok ? work.work.updatedAt : undefined,
    ),
    assets: {
      total: assetsPresent ? assets.files.length : 0,
      active: assetsPresent ? assets.files.filter((file) => file.status === 'available').length : 0,
      updatedAt: assetsPresent ? assets.updatedAt : undefined,
    },
    outputs: {
      total: outputs.length,
      completed: outputs.filter((output) => output.status === 'published' || Boolean(output.completedAt)).length,
      updatedAt: outputs.map((output) => output.updatedAt).sort().at(-1),
    },
    calendarHighlights: selectDatedHighlights(calendarCandidates)
      .map(({ sortKey: _sortKey, ...item }) => item),
    workHighlights: selectDatedHighlights(workCandidates)
      .map(({ sortKey: _sortKey, ...item }) => item),
    essentialAssets: ['master', 'lyrics', 'cover-art'].map((kind) => ({
      label: kind === 'cover-art' ? 'Cover art' : kind[0]!.toUpperCase() + kind.slice(1),
      available: assetsPresent && assets.files.some((file) => file.kind === kind && file.status === 'available'),
    })),
    outputHighlights: outputs
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 4)
      .map((output) => ({ title: output.title, status: output.status, updatedAt: output.updatedAt })),
    sourceHealth: [
      parseHealth(`${workspace.id}:mission-brief`, Boolean(missionDoc), mission.ok, mission.ok ? mission.brief.updatedAt : undefined, CAMPAIGN_SOURCE_STALE_DAYS['mission-brief'], now, mission.ok ? undefined : mission.error),
      parseHealth(`${workspace.id}:release-board`, Boolean(boardDoc), board.ok, board.ok ? board.board.updatedAt : undefined, CAMPAIGN_SOURCE_STALE_DAYS['release-board'], now, board.ok ? undefined : board.error),
      parseHealth(`${workspace.id}:campaign-calendar`, Boolean(calendarDoc), calendar.ok, calendar.ok ? calendar.calendar.updatedAt : undefined, CAMPAIGN_SOURCE_STALE_DAYS['campaign-calendar'], now, calendar.ok ? undefined : calendar.error),
      parseHealth(`${workspace.id}:scheduled-work`, Boolean(workDoc), work.ok, work.ok ? work.work.updatedAt : undefined, CAMPAIGN_SOURCE_STALE_DAYS['scheduled-work'], now, work.ok ? undefined : work.error),
      parseHealth(`${workspace.id}:mission-assets`, assetsPresent, true, assetsPresent ? assets.updatedAt : undefined, CAMPAIGN_SOURCE_STALE_DAYS['mission-assets'], now, assetsPresent ? undefined : 'No campaign asset manifest.'),
      outputs.length
        ? parseHealth(`${workspace.id}:outputs`, true, true, outputs.map((output) => output.updatedAt).sort().at(-1), CAMPAIGN_SOURCE_STALE_DAYS.outputs, now)
        : { source: `${workspace.id}:outputs`, status: 'fresh' },
    ],
  };
}

function selectDatedHighlights<T extends { timing: 'upcoming' | 'overdue'; sortKey: string }>(items: T[]): T[] {
  const upcoming = items
    .filter((item) => item.timing === 'upcoming')
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey));
  const overdue = items
    .filter((item) => item.timing === 'overdue')
    .sort((left, right) => right.sortKey.localeCompare(left.sortKey));
  const selectedUpcoming = upcoming.slice(0, overdue.length ? 4 : 5);
  return [...selectedUpcoming, ...overdue.slice(0, 5 - selectedUpcoming.length)];
}

function collectionSummary(
  items: Array<{ status?: string }>,
  updatedAt?: string,
): ManagerCollectionSummary {
  return {
    total: items.length,
    active: items.filter((item) => ['waiting', 'scheduled', 'running', 'needs-approval', 'awaiting-review'].includes(item.status ?? '')).length,
    blocked: items.filter((item) => ['failed', 'missed', 'needs-attention'].includes(item.status ?? '')).length,
    completed: items.filter((item) => item.status === 'done').length,
    updatedAt,
  };
}

function parseHealth(
  source: string,
  present: boolean,
  ok: boolean,
  observedAt?: string,
  staleDays = 30,
  now = new Date(),
  error?: string,
): ManagerSourceHealth {
  if (!present) return { source, status: 'unavailable', message: error ?? 'No source available.' };
  if (!ok) return { source, status: 'malformed', observedAt, message: error };
  const observedMs = observedAt ? Date.parse(observedAt) : Number.NaN;
  if (!Number.isFinite(observedMs)) return { source, status: 'partial', message: 'Source timestamp is missing or invalid.' };
  const normalizedObservedAt = new Date(observedMs).toISOString();
  const staleAfter = new Date(observedMs + staleDays * DAY_MS).toISOString();
  const stale = now.getTime() > Date.parse(staleAfter);
  return {
    source,
    status: stale ? 'stale' : 'fresh',
    observedAt: normalizedObservedAt,
    staleAfter,
    message: stale ? `${source.split(':').at(-1)} has not changed within its expected ${staleDays}-day window.` : undefined,
  };
}
