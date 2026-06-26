import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export interface SearchSkillMarketplaceArgs {
  query: string;
  source?: 'skillsmp';
  limit?: number;
  page?: number;
  sortBy?: 'stars' | 'recent';
  category?: string;
  occupation?: string;
}

interface SkillsMpSkill {
  id?: unknown;
  name?: unknown;
  author?: unknown;
  description?: unknown;
  githubUrl?: unknown;
  skillUrl?: unknown;
  stars?: unknown;
  updatedAt?: unknown;
}

interface SkillsMpResponse {
  success?: unknown;
  data?: {
    skills?: SkillsMpSkill[];
    pagination?: {
      page?: unknown;
      limit?: unknown;
      total?: unknown;
      totalPages?: unknown;
      hasNext?: unknown;
      hasPrev?: unknown;
      totalIsExact?: unknown;
    };
    filters?: Record<string, unknown>;
  };
  error?: {
    code?: unknown;
    message?: unknown;
  };
  meta?: {
    requestId?: unknown;
    responseTimeMs?: unknown;
  };
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export async function handleSearchSkillMarketplace(
  _ctx: SessionToolContext,
  args: SearchSkillMarketplaceArgs,
): Promise<ToolResult> {
  const source = args.source ?? 'skillsmp';
  if (source !== 'skillsmp') {
    return errorResponse(`Unsupported skill marketplace source: ${source}`);
  }

  const query = args.query?.trim();
  if (!query) {
    return errorResponse('query is required.');
  }
  if (query === '*') {
    return errorResponse('Wildcard searches are not supported. Provide a focused keyword query.');
  }

  const limit = clampInteger(args.limit, 10, 1, 20);
  const page = clampInteger(args.page, 1, 1, 50);
  const url = new URL('https://skillsmp.com/api/v1/skills/search');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('page', String(page));
  url.searchParams.set('sortBy', args.sortBy ?? 'recent');
  if (args.category?.trim()) url.searchParams.set('category', args.category.trim());
  if (args.occupation?.trim()) url.searchParams.set('occupation', args.occupation.trim());

  const headers: Record<string, string> = { Accept: 'application/json' };
  const apiKey = process.env.SKILLSMP_API_KEY?.trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let response: Response;
  try {
    response = await fetch(url, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(`Failed to reach SkillsMP: ${message}`);
  }

  const dailyLimit = response.headers.get('X-RateLimit-Daily-Limit') ?? undefined;
  const dailyRemaining = response.headers.get('X-RateLimit-Daily-Remaining') ?? undefined;

  let parsed: SkillsMpResponse;
  try {
    parsed = await response.json() as SkillsMpResponse;
  } catch {
    return errorResponse(`SkillsMP returned a non-JSON response with status ${response.status}.`);
  }

  if (!response.ok || parsed.success === false) {
    const code = stringOrUndefined(parsed.error?.code) ?? String(response.status);
    const message = stringOrUndefined(parsed.error?.message) ?? response.statusText;
    return errorResponse(`SkillsMP search failed (${code}): ${message}`);
  }

  const skills = (parsed.data?.skills ?? []).map((skill) => ({
    id: stringOrUndefined(skill.id),
    name: stringOrUndefined(skill.name) ?? 'unnamed-skill',
    author: stringOrUndefined(skill.author),
    description: stringOrUndefined(skill.description) ?? '',
    githubUrl: stringOrUndefined(skill.githubUrl),
    skillUrl: stringOrUndefined(skill.skillUrl),
    stars: numberOrUndefined(skill.stars) ?? 0,
    updatedAt: stringOrUndefined(skill.updatedAt),
  }));

  return successResponse(JSON.stringify({
    source: 'skillsmp',
    query,
    page,
    limit,
    sortBy: args.sortBy ?? 'recent',
    total: numberOrUndefined(parsed.data?.pagination?.total),
    totalIsExact: typeof parsed.data?.pagination?.totalIsExact === 'boolean'
      ? parsed.data.pagination.totalIsExact
      : undefined,
    hasNext: typeof parsed.data?.pagination?.hasNext === 'boolean'
      ? parsed.data.pagination.hasNext
      : undefined,
    rateLimit: {
      dailyLimit,
      dailyRemaining,
    },
    skills,
    safetyNote: 'External marketplace results are candidates only. Inspect SKILL.md and any scripts before installing or adapting.',
  }, null, 2));
}
