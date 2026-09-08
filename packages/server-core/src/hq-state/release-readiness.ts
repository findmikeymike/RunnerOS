import { existsSync } from 'node:fs';
import {
  getBoardTotals,
  isReleaseBoardItemIncluded,
  type ReleaseBoard,
  type ReleaseBoardParseResult,
} from '@craft-agent/shared/artist-context';
import type { ManagerCampaignSnapshot } from '@craft-agent/shared/hq-state';
import {
  getReleaseKitManifestPath,
  loadReleaseKitManifest,
  type ReleaseKitCategory,
} from '@craft-agent/shared/release-kit';

type ReleaseReadiness = NonNullable<ManagerCampaignSnapshot['releaseReadiness']>;
const MAX_ESSENTIAL_ITEMS = 40;
const KIT_CATEGORIES: ReadonlyArray<{ category: ReleaseKitCategory; label: string }> = [
  { category: 'audio', label: 'Audio' },
  { category: 'artwork', label: 'Single art / artwork' },
  { category: 'video', label: 'Content video' },
  { category: 'images', label: 'Content images' },
  // A plan document is not evidence that the campaign rollout is complete.
  { category: 'plans', label: 'Plans' },
];

/** Read canon metadata only: no hashing, verification writes, or asset promotion. */
export function loadCampaignReleaseReadiness(
  workspaceRootPath: string,
  workspaceId: string,
  board: ReleaseBoardParseResult,
  boardPresent: boolean,
): ReleaseReadiness {
  let kit: ReleaseReadiness['kit'];
  try {
    const present = existsSync(getReleaseKitManifestPath(workspaceRootPath));
    const manifest = loadReleaseKitManifest(workspaceRootPath, workspaceId, workspaceId);
    // The storage loader validates manifest scope; also reject foreign item rows.
    if (manifest.items.some((item) => item.campaignId !== workspaceId)) {
      throw new Error('Release Kit contains an item from another campaign.');
    }
    kit = {
      status: 'available',
      updatedAt: present ? manifest.updatedAt : undefined,
      categories: KIT_CATEGORIES.map(({ category, label }) => {
        const counts = { label, ready: 0, needsReview: 0, missing: 0, restricted: 0 };
        for (const item of manifest.items) {
          if (item.category !== category) continue;
          if (item.usage.restrictions.blockedFromUse || item.usage.restrictions.needsRightsClearance) {
            counts.restricted += 1;
          } else if (item.status === 'ready') counts.ready += 1;
          else if (item.status === 'needs-review') counts.needsReview += 1;
          else counts.missing += 1;
        }
        return counts;
      }),
    };
  } catch (error) {
    // Invalid/scope-mismatched canon is unknown, never an empty ready kit.
    const fileError = error instanceof Error && 'code' in error;
    kit = { status: fileError ? 'unavailable' : 'malformed', categories: [] };
  }

  if (!boardPresent || !board.ok || board.board.workspaceId !== workspaceId) {
    return {
      kit,
      essentials: {
        status: boardPresent ? 'malformed' : 'unavailable',
        done: 0, total: 0, items: [], omitted: 0,
      },
    };
  }
  const included = board.board.categories.flatMap((category) => category.items)
    .filter((item) => isReleaseBoardItemIncluded(item) && item.status !== 'skipped');
  return {
    kit,
    essentials: {
      status: 'available',
      ...getBoardTotals(board.board),
      items: included.slice(0, MAX_ESSENTIAL_ITEMS)
        .map((item) => ({ label: item.label.slice(0, 180), status: item.status })),
      omitted: Math.max(0, included.length - MAX_ESSENTIAL_ITEMS),
    },
  };
}

export function nextMissingReleaseEssentials(board: ReleaseBoard): string[] {
  return board.categories.flatMap((category) => category.items)
    .filter((item) => isReleaseBoardItemIncluded(item) && item.status === 'needed')
    .slice(0, 12)
    .map((item) => item.label.slice(0, 180));
}
