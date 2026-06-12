import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';

export interface CreateTeamTaskToolInput {
  runId: string;
  title: string;
  description: string;
  ownerAgentSlug: string;
  priority?: 'low' | 'normal' | 'high';
  inputs?: Record<string, unknown>;
  approvalRequired?: boolean;
  reviewRequired?: boolean;
  reviewerAgentSlug?: string;
  maxAttempts?: number;
}

export interface UpdateTeamTaskToolInput {
  runId: string;
  taskId: string;
  leaseId?: string;
  title?: string;
  description?: string;
  ownerAgentSlug?: string;
  status?: 'todo' | 'in_progress' | 'blocked' | 'review' | 'done' | 'failed';
  priority?: 'low' | 'normal' | 'high';
  inputs?: Record<string, unknown>;
  output?: string;
  evidence?: Array<{ type: 'text' | 'file' | 'url' | 'output'; label: string; value: string }>;
  approvalRequired?: boolean;
  blockedReason?: string;
  reviewStatus?: 'passed' | 'failed';
  reviewFindings?: string;
}

export interface ClaimTeamTaskToolInput {
  runId: string;
  taskId?: string;
  leaseTtlMs?: number;
}

export interface HeartbeatTeamTaskToolInput {
  runId: string;
  taskId: string;
  leaseId: string;
  leaseTtlMs?: number;
}

export interface SendTeamMessageToolInput {
  runId: string;
  toAgentSlug: string | 'lead' | 'all';
  taskId?: string;
  kind?: 'assignment' | 'question' | 'result' | 'review' | 'note';
  body: string;
}

export interface RequestTeamReviewToolInput {
  runId: string;
  taskId: string;
  reviewerAgentSlug?: string;
  instructions?: string;
}

export interface RequestUserApprovalToolInput {
  runId: string;
  taskId: string;
  reason: string;
}

export interface SpawnTeamMemberToolInput {
  runId: string;
  agentSlug: string;
  taskId?: string;
  prompt?: string;
}

export interface TickTeamRunToolInput {
  runId: string;
  reason?: 'scheduled' | 'manual' | 'startup-recovery';
}

export interface CompleteTeamRunToolInput {
  runId: string;
  summary: string;
  evidence?: Array<{ type: 'text' | 'file' | 'url' | 'output'; label: string; value: string }>;
}

export async function handleListTeamTasks(ctx: SessionToolContext, args: { runId: string }): Promise<ToolResult> {
  if (!ctx.listTeamTasks) return errorResponse('list_team_tasks is not available in this context.');
  try {
    return successResponse(JSON.stringify(ctx.listTeamTasks(args.runId), null, 2));
  } catch (error) {
    return errorResponse(`Failed to list team tasks: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function handleListTeamMessages(ctx: SessionToolContext, args: { runId: string }): Promise<ToolResult> {
  if (!ctx.listTeamMessages) return errorResponse('list_team_messages is not available in this context.');
  try {
    return successResponse(JSON.stringify(ctx.listTeamMessages(args.runId), null, 2));
  } catch (error) {
    return errorResponse(`Failed to list team messages: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function handleCreateTeamTask(ctx: SessionToolContext, args: CreateTeamTaskToolInput): Promise<ToolResult> {
  if (!ctx.createTeamTask) return errorResponse('create_team_task is not available in this context.');
  try {
    return successResponse(JSON.stringify(await ctx.createTeamTask(args), null, 2));
  } catch (error) {
    return errorResponse(`Failed to create team task: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function handleUpdateTeamTask(ctx: SessionToolContext, args: UpdateTeamTaskToolInput): Promise<ToolResult> {
  if (!ctx.updateTeamTask) return errorResponse('update_team_task is not available in this context.');
  try {
    return successResponse(JSON.stringify(await ctx.updateTeamTask(args), null, 2));
  } catch (error) {
    return errorResponse(`Failed to update team task: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function handleClaimTeamTask(ctx: SessionToolContext, args: ClaimTeamTaskToolInput): Promise<ToolResult> {
  if (!ctx.claimTeamTask) return errorResponse('claim_team_task is not available in this context.');
  try {
    return successResponse(JSON.stringify(await ctx.claimTeamTask(args), null, 2));
  } catch (error) {
    return errorResponse(`Failed to claim team task: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function handleHeartbeatTeamTask(ctx: SessionToolContext, args: HeartbeatTeamTaskToolInput): Promise<ToolResult> {
  if (!ctx.heartbeatTeamTask) return errorResponse('heartbeat_team_task is not available in this context.');
  try {
    return successResponse(JSON.stringify(await ctx.heartbeatTeamTask(args), null, 2));
  } catch (error) {
    return errorResponse(`Failed to heartbeat team task: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function handleExpireStaleTeamTasks(ctx: SessionToolContext, args: { runId: string }): Promise<ToolResult> {
  if (!ctx.expireStaleTeamTasks) return errorResponse('expire_stale_team_tasks is not available in this context.');
  try {
    return successResponse(JSON.stringify(await ctx.expireStaleTeamTasks(args.runId), null, 2));
  } catch (error) {
    return errorResponse(`Failed to expire stale team tasks: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function handleListTeamTicks(ctx: SessionToolContext, args: { runId: string }): Promise<ToolResult> {
  if (!ctx.listTeamTicks) return errorResponse('list_team_ticks is not available in this context.');
  try {
    return successResponse(JSON.stringify(ctx.listTeamTicks(args.runId), null, 2));
  } catch (error) {
    return errorResponse(`Failed to list team ticks: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function handleTickTeamRun(ctx: SessionToolContext, args: TickTeamRunToolInput): Promise<ToolResult> {
  if (!ctx.tickTeamRun) return errorResponse('tick_team_run is not available in this context.');
  try {
    return successResponse(JSON.stringify(await ctx.tickTeamRun(args), null, 2));
  } catch (error) {
    return errorResponse(`Failed to tick team run: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function handleSendTeamMessage(ctx: SessionToolContext, args: SendTeamMessageToolInput): Promise<ToolResult> {
  if (!ctx.sendTeamMessage) return errorResponse('send_team_message is not available in this context.');
  try {
    return successResponse(JSON.stringify(await ctx.sendTeamMessage(args), null, 2));
  } catch (error) {
    return errorResponse(`Failed to send team message: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function handleRequestTeamReview(ctx: SessionToolContext, args: RequestTeamReviewToolInput): Promise<ToolResult> {
  if (!ctx.requestTeamReview) return errorResponse('request_team_review is not available in this context.');
  try {
    return successResponse(JSON.stringify(await ctx.requestTeamReview(args), null, 2));
  } catch (error) {
    return errorResponse(`Failed to request team review: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function handleRequestUserApproval(ctx: SessionToolContext, args: RequestUserApprovalToolInput): Promise<ToolResult> {
  if (!ctx.requestUserApproval) return errorResponse('request_user_approval is not available in this context.');
  try {
    return successResponse(JSON.stringify(await ctx.requestUserApproval(args), null, 2));
  } catch (error) {
    return errorResponse(`Failed to request user approval: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function handleSpawnTeamMember(ctx: SessionToolContext, args: SpawnTeamMemberToolInput): Promise<ToolResult> {
  if (!ctx.spawnTeamMember) return errorResponse('spawn_team_member is not available in this context.');
  try {
    return successResponse(JSON.stringify(await ctx.spawnTeamMember(args), null, 2));
  } catch (error) {
    return errorResponse(`Failed to spawn team member: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function handleSummarizeTeamRun(ctx: SessionToolContext, args: { runId: string }): Promise<ToolResult> {
  if (!ctx.summarizeTeamRun) return errorResponse('summarize_team_run is not available in this context.');
  try {
    return successResponse(JSON.stringify(ctx.summarizeTeamRun(args.runId), null, 2));
  } catch (error) {
    return errorResponse(`Failed to summarize team run: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function handleCompleteTeamRun(ctx: SessionToolContext, args: CompleteTeamRunToolInput): Promise<ToolResult> {
  if (!ctx.completeTeamRun) return errorResponse('complete_team_run is not available in this context.');
  try {
    return successResponse(JSON.stringify(await ctx.completeTeamRun(args), null, 2));
  } catch (error) {
    return errorResponse(`Failed to complete team run: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
