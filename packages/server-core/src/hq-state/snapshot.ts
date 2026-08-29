import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { getWorkspaces } from '@craft-agent/shared/config';
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
import { loadAllContextDocs, loadContextDoc } from '@craft-agent/shared/workspace-context';
import { buildHqOperationalSnapshot } from './operational';

export function buildHqStateInput(workspaceRootPath: string, now = new Date()): BuildHqStateInput {
  const workspace = getWorkspaces().find((candidate) => candidate.rootPath === workspaceRootPath);
  if (!existsSync(workspaceRootPath)) throw new Error(`HQ workspace does not exist: ${workspaceRootPath}`);
  return {
    workspaceId: workspace?.id ?? basename(workspaceRootPath),
    docs: loadAllContextDocs(workspaceRootPath),
    relatedCampaigns: workspace ? buildManagerCampaignSnapshots() : [],
    operational: buildHqOperationalSnapshot(workspaceRootPath),
    now,
  };
}

export function buildManagerCampaignSnapshots(): ManagerCampaignSnapshot[] {
  const campaigns = getWorkspaces().filter((workspace) => workspace.artistWorkspaceScope === 'campaign');
  return campaigns.map((workspace, index) => buildCampaignSnapshot(workspace, index === 0));
}

export function findArtistHqWorkspace() {
  return getWorkspaces().find((workspace) => workspace.artistWorkspaceScope === 'hq') ?? null;
}

function buildCampaignSnapshot(
  workspace: ReturnType<typeof getWorkspaces>[number],
  primary: boolean,
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

  return {
    workspaceId: workspace.id,
    name: workspace.name,
    primary,
    mission: mission.ok ? mission.brief : undefined,
    readiness: totals ? { ...totals, nextMissing } : undefined,
    calendar: collectionSummary(
      calendar.ok ? calendar.calendar.items.filter((item) => !item.deletedAt) : [],
      calendar.ok ? calendar.calendar.updatedAt : undefined,
    ),
    work: collectionSummary(
      work.ok ? work.work.items.filter((item) => !item.deletedAt) : [],
      work.ok ? work.work.updatedAt : undefined,
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
    sourceHealth: [
      parseHealth(`${workspace.id}:mission-brief`, Boolean(missionDoc), mission.ok, mission.ok ? mission.brief.updatedAt : undefined, mission.ok ? undefined : mission.error),
      parseHealth(`${workspace.id}:release-board`, Boolean(boardDoc), board.ok, board.ok ? board.board.updatedAt : undefined, board.ok ? undefined : board.error),
      parseHealth(`${workspace.id}:campaign-calendar`, Boolean(calendarDoc), calendar.ok, calendar.ok ? calendar.calendar.updatedAt : undefined, calendar.ok ? undefined : calendar.error),
      parseHealth(`${workspace.id}:scheduled-work`, Boolean(workDoc), work.ok, work.ok ? work.work.updatedAt : undefined, work.ok ? undefined : work.error),
      {
        source: `${workspace.id}:mission-assets`,
        status: assetsPresent ? 'fresh' : 'unavailable',
        observedAt: assetsPresent ? assets.updatedAt : undefined,
        message: assetsPresent ? undefined : 'No campaign asset manifest.',
      },
      {
        source: `${workspace.id}:outputs`,
        status: 'fresh',
        observedAt: outputs.map((output) => output.updatedAt).sort().at(-1),
      },
    ],
  };
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
  error?: string,
): ManagerSourceHealth {
  if (!present) return { source, status: 'unavailable', message: 'No source available.' };
  if (!ok) return { source, status: 'malformed', observedAt, message: error };
  if (!observedAt) return { source, status: 'partial', message: 'Source timestamp is missing or invalid.' };
  return { source, status: 'fresh', observedAt };
}
