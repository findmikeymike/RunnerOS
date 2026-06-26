import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse, successResponse } from '../response.ts';

export interface ListPacksArgs {
  activeOnly?: boolean;
  search?: string;
  tags?: string[];
}

export interface GetPackArgs {
  slug: string;
}

export interface PackProfileArgs {
  slug: string;
  profile?: string;
}

export async function handleListPacks(ctx: SessionToolContext, args: ListPacksArgs): Promise<ToolResult> {
  if (!ctx.listPacks) return errorResponse('list_packs is not available in this context.');
  try {
    return successResponse(JSON.stringify(ctx.listPacks(args), null, 2));
  } catch (error) {
    return errorResponse(`Failed to list packs: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function handleGetPack(ctx: SessionToolContext, args: GetPackArgs): Promise<ToolResult> {
  if (!ctx.getPack) return errorResponse('get_pack is not available in this context.');
  try {
    const pack = ctx.getPack(args.slug);
    if (!pack) return errorResponse(`Pack not found: ${args.slug}`);
    return successResponse(JSON.stringify(pack, null, 2));
  } catch (error) {
    return errorResponse(`Failed to get pack: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function handlePlanPackInstall(ctx: SessionToolContext, args: PackProfileArgs): Promise<ToolResult> {
  if (!ctx.planPackInstall) return errorResponse('plan_pack_install is not available in this context.');
  try {
    return successResponse(JSON.stringify(ctx.planPackInstall(args.slug, args.profile), null, 2));
  } catch (error) {
    return errorResponse(`Failed to plan pack install: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function handleInstallPack(ctx: SessionToolContext, args: PackProfileArgs): Promise<ToolResult> {
  if (!ctx.installPack) return errorResponse('install_pack is not available in this context.');
  try {
    const result = await ctx.installPack(args.slug, args.profile);
    return successResponse(JSON.stringify(result, null, 2));
  } catch (error) {
    return errorResponse(`Failed to install pack: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
