import { buildSessionResultLink } from '../result-links.ts';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse, successResponse } from '../response.ts';
export interface CustomSkillIdentity { slug: string; scope?: 'global' | 'workspace' }
export interface CreateCustomSkillInput extends CustomSkillIdentity { content: string; activateInWorkspace?: boolean }
export interface UpdateCustomSkillInput extends CustomSkillIdentity { content: string; expectedRevision: string }
export interface CustomSkillResult { ok: boolean; slug?: string; scope?: 'global' | 'workspace'; revision?: string; content?: string; activated?: boolean; saved?: boolean; error?: string }
async function call(ctx: SessionToolContext, fn: (() => Promise<CustomSkillResult>) | undefined): Promise<ToolResult> {
  if (!fn) return errorResponse('Custom skill authoring is unavailable in this context.');
  try { const result = await fn(); return result.ok ? successResponse(JSON.stringify({ ...result, url: buildSessionResultLink(ctx, 'skill', result.slug) })) : errorResponse(result.error ?? 'Custom skill operation failed.'); }
  catch (error) { return errorResponse(error instanceof Error ? error.message : String(error)); }
}
export const handleGetCustomSkill = (ctx: SessionToolContext, input: CustomSkillIdentity) => call(ctx, ctx.getCustomSkill && (() => ctx.getCustomSkill!(input)));
export const handleCreateSkill = (ctx: SessionToolContext, input: CreateCustomSkillInput) => call(ctx, ctx.createSkill && (() => ctx.createSkill!(input)));
export const handleUpdateSkill = (ctx: SessionToolContext, input: UpdateCustomSkillInput) => call(ctx, ctx.updateSkill && (() => ctx.updateSkill!(input)));
