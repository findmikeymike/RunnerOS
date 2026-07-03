import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export interface StartDeepResearchArgs {
  topic: string;
  title?: string;
  planPolicy?: 'approve' | 'auto';
  sourceSlugs?: string[];
  depth?: 'quick' | 'standard' | 'deep';
  reportFormat?: 'brief' | 'standard' | 'full';
}

export interface ListDeepResearchRunsArgs {
  state?: string;
  limit?: number;
}

export interface GetDeepResearchRunArgs {
  runId: string;
}

export interface ApproveDeepResearchPlanArgs {
  runId: string;
}

export interface ReviseDeepResearchPlanArgs {
  runId: string;
  feedback: string;
}

export interface CancelDeepResearchRunArgs {
  runId: string;
}

export async function handleStartDeepResearch(ctx: SessionToolContext, args: StartDeepResearchArgs): Promise<ToolResult> {
  if (!ctx.startDeepResearch) return errorResponse('start_deep_research is not available in this context.');
  try {
    const run = await ctx.startDeepResearch(args);
    return successResponse(JSON.stringify(run, null, 2));
  } catch (error) {
    return errorResponse(`Failed to start deep research: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function handleListDeepResearchRuns(ctx: SessionToolContext, args: ListDeepResearchRunsArgs): Promise<ToolResult> {
  if (!ctx.listDeepResearchRuns) return errorResponse('list_deep_research_runs is not available in this context.');
  try {
    return successResponse(JSON.stringify(ctx.listDeepResearchRuns(args), null, 2));
  } catch (error) {
    return errorResponse(`Failed to list deep research runs: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function handleGetDeepResearchRun(ctx: SessionToolContext, args: GetDeepResearchRunArgs): Promise<ToolResult> {
  if (!ctx.getDeepResearchRun) return errorResponse('get_deep_research_run is not available in this context.');
  try {
    const run = ctx.getDeepResearchRun(args.runId);
    if (!run) return errorResponse(`Deep research run not found: ${args.runId}`);
    return successResponse(JSON.stringify(run, null, 2));
  } catch (error) {
    return errorResponse(`Failed to get deep research run: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function handleApproveDeepResearchPlan(ctx: SessionToolContext, args: ApproveDeepResearchPlanArgs): Promise<ToolResult> {
  if (!ctx.approveDeepResearchPlan) return errorResponse('approve_deep_research_plan is not available in this context.');
  try {
    const run = await ctx.approveDeepResearchPlan(args.runId);
    return successResponse(JSON.stringify(run, null, 2));
  } catch (error) {
    return errorResponse(`Failed to approve deep research plan: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function handleReviseDeepResearchPlan(ctx: SessionToolContext, args: ReviseDeepResearchPlanArgs): Promise<ToolResult> {
  if (!ctx.reviseDeepResearchPlan) return errorResponse('revise_deep_research_plan is not available in this context.');
  try {
    const run = await ctx.reviseDeepResearchPlan(args.runId, args.feedback);
    return successResponse(JSON.stringify(run, null, 2));
  } catch (error) {
    return errorResponse(`Failed to revise deep research plan: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function handleCancelDeepResearchRun(ctx: SessionToolContext, args: CancelDeepResearchRunArgs): Promise<ToolResult> {
  if (!ctx.cancelDeepResearchRun) return errorResponse('cancel_deep_research_run is not available in this context.');
  try {
    const run = await ctx.cancelDeepResearchRun(args.runId);
    return successResponse(JSON.stringify(run, null, 2));
  } catch (error) {
    return errorResponse(`Failed to cancel deep research run: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
