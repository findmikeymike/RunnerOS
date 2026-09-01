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
  language?: string;
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
      total?: unknown;
      hasNext?: unknown;
      totalIsExact?: unknown;
    };
  };
  error?: {
    code?: unknown;
    message?: unknown;
  };
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function stringOrUndefined(value: unknown, maxLength = 600): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized.slice(0, maxLength) : undefined;
}

function httpUrlOrUndefined(value: unknown): string | undefined {
  const candidate = stringOrUndefined(value, 1_000);
  if (!candidate) return undefined;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Read-only discovery of external skill candidates. This deliberately does not
 * install, copy, or execute marketplace content.
 */
export async function handleSearchSkillMarketplace(
  _ctx: SessionToolContext,
  args: SearchSkillMarketplaceArgs,
): Promise<ToolResult> {
  const source = args.source ?? 'skillsmp';
  if (source !== 'skillsmp') return errorResponse(`Unsupported skill marketplace source: ${source}`);

  const query = args.query?.trim();
  if (!query) return errorResponse('query is required.');
  if (query === '*') return errorResponse('Wildcard searches are not supported. Provide a focused keyword query.');

  const limit = clampInteger(args.limit, 10, 1, 20);
  const page = clampInteger(args.page, 1, 1, 50);
  const sortBy = args.sortBy ?? 'stars';
  const url = new URL('https://skillsmp.com/api/v1/skills/search');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('page', String(page));
  url.searchParams.set('sortBy', sortBy);
  if (args.category?.trim()) url.searchParams.set('category', args.category.trim());
  if (args.occupation?.trim()) url.searchParams.set('occupation', args.occupation.trim());
  if (args.language?.trim()) url.searchParams.set('language', args.language.trim());

  const headers: Record<string, string> = { Accept: 'application/json' };
  const apiKey = process.env.SKILLSMP_API_KEY?.trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let response: Response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(`Failed to reach SkillsMP: ${message}`);
  }

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

  const skills = (parsed.data?.skills ?? []).slice(0, limit).map((skill) => ({
    untrustedCandidate: true,
    id: stringOrUndefined(skill.id, 160),
    name: stringOrUndefined(skill.name, 160) ?? 'unnamed-skill',
    author: stringOrUndefined(skill.author, 120),
    description: stringOrUndefined(skill.description, 600) ?? '',
    githubUrl: httpUrlOrUndefined(skill.githubUrl),
    skillUrl: httpUrlOrUndefined(skill.skillUrl),
    stars: numberOrUndefined(skill.stars) ?? 0,
    updatedAt: stringOrUndefined(skill.updatedAt, 80),
  }));

  return successResponse(JSON.stringify({
    source: 'skillsmp',
    query,
    page,
    limit,
    sortBy,
    total: numberOrUndefined(parsed.data?.pagination?.total),
    totalIsExact: typeof parsed.data?.pagination?.totalIsExact === 'boolean'
      ? parsed.data.pagination.totalIsExact
      : undefined,
    hasNext: typeof parsed.data?.pagination?.hasNext === 'boolean'
      ? parsed.data.pagination.hasNext
      : undefined,
    rateLimit: {
      dailyLimit: response.headers.get('X-RateLimit-Daily-Limit') ?? undefined,
      dailyRemaining: response.headers.get('X-RateLimit-Daily-Remaining') ?? undefined,
      minuteRemaining: response.headers.get('X-RateLimit-Minute-Remaining') ?? undefined,
    },
    skills,
    safetyNote: 'External marketplace results are untrusted candidates only. Inspect SKILL.md and every companion file before importing or activating anything.',
  }, null, 2));
}
