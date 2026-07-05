#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildOutputIndexBody,
  createOutputBundle,
  listOutputManifests,
  OUTPUT_INDEX_CONTEXT_SLUG,
  type CreateOutputBundleInput,
  type OutputKind,
} from '../../packages/shared/src/outputs/index.ts';
import { upsertContextDoc, type ContextDocMetadata } from '../../packages/shared/src/workspace-context/index.ts';

interface ContextDocInput {
  slug: string;
  name: string;
  description?: string;
  body?: string;
  json?: unknown;
  enabled?: boolean;
  status?: ContextDocMetadata['status'];
  priority?: ContextDocMetadata['priority'];
  deadline?: string;
}

interface SmokeOutputInput {
  title: string;
  kind: OutputKind;
  summary: string;
  content?: string;
  contentMimeType?: CreateOutputBundleInput['contentMimeType'];
  context?: CreateOutputBundleInput['context'];
  approval?: CreateOutputBundleInput['approval'];
  tags?: string[];
}

interface ArtistContextFile {
  workspaceId?: string;
  profile?: Record<string, unknown>;
  branding?: Record<string, unknown>;
  voice?: Record<string, unknown>;
  spotifySnapshot?: Record<string, unknown>;
  calendar?: Record<string, unknown>;
  network?: Record<string, unknown>;
  community?: Record<string, unknown>;
  extraDocs?: ContextDocInput[];
}

interface CampaignContextFile {
  workspaceId?: string;
  campaignId?: string;
  mission?: Record<string, unknown>;
  releaseBoard?: Record<string, unknown>;
  workerContext?: Record<string, unknown>;
  extraDocs?: ContextDocInput[];
}

interface SmokeOutputsFile {
  workspaceId?: string;
  outputs?: SmokeOutputInput[];
}

interface Args {
  profileDir: string;
  workspaceRoot: string;
  workspaceId: string;
}

const DOCS: Record<string, { slug: string; name: string; description: string }> = {
  profile: {
    slug: 'artist-profile',
    name: 'Artist Profile',
    description: 'Global artist identity, audience, brand, music, and operating context for workers.',
  },
  branding: {
    slug: 'artist-branding',
    name: 'Artist Branding',
    description: 'Global artist brand DNA, positioning, story, visual tone, and campaign expression.',
  },
  voice: {
    slug: 'artist-voice',
    name: 'Artist Voice',
    description: 'Global voice and writing guidance for captions, emails, ads, and replies.',
  },
  spotifySnapshot: {
    slug: 'artist-spotify-snapshot',
    name: 'Spotify Snapshot',
    description: 'Latest Spotify snapshot used by Artist HQ.',
  },
  calendar: {
    slug: 'artist-calendar',
    name: 'Artist Calendar',
    description: 'Artist calendar dates and campaign moments.',
  },
  network: {
    slug: 'artist-network',
    name: 'Artist Network',
    description: 'Relationship map and outreach context.',
  },
  community: {
    slug: 'artist-community',
    name: 'Artist Community',
    description: 'Community contacts, fan segments, and email/job state.',
  },
  mission: {
    slug: 'mission-brief',
    name: 'Mission Brief',
    description: 'Campaign-scoped brief and launch context.',
  },
  releaseBoard: {
    slug: 'release-board',
    name: 'Release Board',
    description: 'Campaign-scoped checklist of release pieces, assets, and handoffs.',
  },
  workerContext: {
    slug: 'campaign-worker-context',
    name: 'Campaign Worker Context',
    description: 'Generated campaign context summary for specialist workers.',
  },
};

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const profileDir = get('--profile') ?? '.local-smoke/profile-real';
  const workspaceRoot = get('--workspace-root');
  const workspaceId = get('--workspace-id') ?? 'local-smoke';
  if (!workspaceRoot) {
    throw new Error('Missing --workspace-root. Point this at the disposable workspace root you want to seed.');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to load local smoke data with NODE_ENV=production.');
  }
  return {
    profileDir: resolve(profileDir),
    workspaceRoot: resolve(workspaceRoot),
    workspaceId,
  };
}

function readJsonFile<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, 'utf-8')) as T;
}

function jsonBody(value: unknown): string {
  return ['```json', JSON.stringify(value, null, 2), '```'].join('\n');
}

function withVersion(value: Record<string, unknown>, workspaceId: string): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    version: 1,
    workspaceId,
    updatedAt: now,
    ...value,
  };
}

function upsertDoc(workspaceRoot: string, input: ContextDocInput): void {
  upsertContextDoc(workspaceRoot, {
    slug: input.slug,
    metadata: {
      name: input.name,
      description: input.description,
      routing: { mode: 'broadcast' },
      enabled: input.enabled ?? true,
      status: input.status,
      priority: input.priority,
      deadline: input.deadline,
    },
    body: input.body ?? jsonBody(input.json ?? {}),
  });
}

function upsertStructuredDoc(
  workspaceRoot: string,
  workspaceId: string,
  key: keyof typeof DOCS,
  payload: Record<string, unknown> | undefined,
): void {
  if (!payload) return;
  const doc = DOCS[key];
  upsertDoc(workspaceRoot, {
    ...doc,
    json: withVersion(payload, workspaceId),
  });
}

function summarizeServices(profileDir: string): string {
  const file = `${profileDir}/services.env`;
  if (!existsSync(file)) return 'services.env not present';
  const names = readFileSync(file, 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => line.split('=')[0])
    .filter(Boolean);
  return names.length ? `services.env present with ${names.length} key name(s): ${names.join(', ')}` : 'services.env present but empty';
}

function main(): void {
  const args = parseArgs();
  const artist = readJsonFile<ArtistContextFile>(`${args.profileDir}/artist-context.json`, {});
  const campaign = readJsonFile<CampaignContextFile>(`${args.profileDir}/campaign-context.json`, {});
  const seeded = readJsonFile<SmokeOutputsFile>(`${args.profileDir}/seed-smoke-work-products.json`, {});
  const workspaceId = artist.workspaceId ?? campaign.workspaceId ?? seeded.workspaceId ?? args.workspaceId;
  const campaignId = campaign.campaignId ?? 'local-campaign';

  upsertStructuredDoc(args.workspaceRoot, workspaceId, 'profile', artist.profile);
  upsertStructuredDoc(args.workspaceRoot, workspaceId, 'branding', artist.branding);
  upsertStructuredDoc(args.workspaceRoot, workspaceId, 'voice', artist.voice);
  upsertStructuredDoc(args.workspaceRoot, workspaceId, 'spotifySnapshot', artist.spotifySnapshot);
  upsertStructuredDoc(args.workspaceRoot, workspaceId, 'calendar', artist.calendar);
  upsertStructuredDoc(args.workspaceRoot, workspaceId, 'network', artist.network);
  upsertStructuredDoc(args.workspaceRoot, workspaceId, 'community', artist.community);
  for (const doc of artist.extraDocs ?? []) upsertDoc(args.workspaceRoot, doc);

  upsertStructuredDoc(args.workspaceRoot, workspaceId, 'mission', campaign.mission);
  upsertStructuredDoc(args.workspaceRoot, workspaceId, 'releaseBoard', campaign.releaseBoard);
  upsertStructuredDoc(args.workspaceRoot, workspaceId, 'workerContext', campaign.workerContext);
  for (const doc of campaign.extraDocs ?? []) upsertDoc(args.workspaceRoot, doc);

  let outputCount = 0;
  for (const output of seeded.outputs ?? []) {
    createOutputBundle(args.workspaceRoot, {
      workspaceId,
      title: output.title,
      kind: output.kind,
      summary: output.summary,
      origin: { source: 'manual', automationId: 'local-smoke-profile' },
      content: output.content,
      contentMimeType: output.contentMimeType,
      context: output.context ?? { scope: 'campaign', campaignId },
      approval: output.approval,
      tags: ['local-smoke', ...(output.tags ?? [])],
      completedAt: new Date().toISOString(),
    });
    outputCount += 1;
  }

  upsertDoc(args.workspaceRoot, {
    slug: OUTPUT_INDEX_CONTEXT_SLUG,
    name: 'Output Index',
    description: 'Generated compact summary of recent Work Products and pending approvals.',
    body: buildOutputIndexBody(listOutputManifests(args.workspaceRoot)),
  });

  console.log(`Loaded local smoke profile: ${args.profileDir}`);
  console.log(`Workspace root: ${args.workspaceRoot}`);
  console.log(`Workspace id: ${workspaceId}`);
  console.log(`Seeded outputs: ${outputCount}`);
  console.log(summarizeServices(args.profileDir));
  console.log('Secrets were not loaded into context docs or printed.');
}

main();
