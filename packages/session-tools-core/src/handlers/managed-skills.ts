import type { SessionToolContext } from '../context.ts';
import { successResponse, errorResponse } from '../response.ts';

export async function handleUseSkill(ctx: SessionToolContext, args: { slug: string }) {
  if (!ctx.useSkill) return errorResponse('Skill loading is unavailable in this context.');
  try { return successResponse(await ctx.useSkill(args.slug)); }
  catch (error) { return errorResponse(error instanceof Error ? error.message : 'Skill loading failed.'); }
}
export async function handleReadSkillReference(ctx: SessionToolContext, args: { slug: string; path: string }) {
  if (!ctx.readSkillReference) return errorResponse('Skill references are unavailable in this context.');
  try { return successResponse(await ctx.readSkillReference(args.slug, args.path)); }
  catch (error) { return errorResponse(error instanceof Error ? error.message : 'Skill reference loading failed.'); }
}

export async function handleGetSkillPersonalInstructions(ctx: SessionToolContext, args: { slug: string }) {
  if (!ctx.getSkillPersonalInstructions) return errorResponse('Personal instructions are unavailable.');
  try { return successResponse(JSON.stringify(await ctx.getSkillPersonalInstructions(args.slug))); }
  catch (error) { return errorResponse(error instanceof Error ? error.message : 'Could not read personal instructions.'); }
}
export async function handleSaveSkillPersonalInstructions(ctx: SessionToolContext, args: { slug: string; scope: 'shared' | 'workspace'; text: string }) {
  if (!ctx.saveSkillPersonalInstructions) return errorResponse('Personal instructions are unavailable.');
  try { return successResponse(await ctx.saveSkillPersonalInstructions(args.slug, args.scope, args.text)); }
  catch (error) { return errorResponse(error instanceof Error ? error.message : 'Could not save personal instructions.'); }
}
export async function handleDeleteSkillPersonalInstructions(ctx: SessionToolContext, args: { slug: string; scope: 'shared' | 'workspace' }) {
  if (!ctx.deleteSkillPersonalInstructions) return errorResponse('Personal instructions are unavailable.');
  try { return successResponse(await ctx.deleteSkillPersonalInstructions(args.slug, args.scope)); }
  catch (error) { return errorResponse(error instanceof Error ? error.message : 'Could not remove personal instructions.'); }
}
