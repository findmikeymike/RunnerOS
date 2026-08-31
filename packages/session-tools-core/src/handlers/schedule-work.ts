import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse, successResponse } from '../response.ts';

export type ScheduleWorkExecutionInput =
  | {
      type: 'agent-task';
      agentSlug: string;
      brief: string;
      permissionMode?: 'safe' | 'ask';
      expectedOutput?: {
        requirement: 'none' | 'optional' | 'required';
        kind?: 'report' | 'document' | 'image' | 'video' | 'audio' | 'dataset' | 'code' | 'receipt' | 'other';
        title?: string;
      };
    }
  | {
      type: 'workflow-run';
      workflowSlug: string;
      triggerInputs?: Record<string, unknown>;
    };

export type ScheduleWorkTriggerInput =
  | { type: 'schedule'; cron: string; timezone?: string }
  | { type: 'file-change'; watchPath: string; watchGlob?: string; changeTypes?: ('add' | 'change' | 'remove')[] }
  | { type: 'webhook'; slug: string; secretEnv?: string; allowUnauthenticated?: boolean }
  | { type: 'url-change'; url: string; intervalSeconds?: number }
  | { type: 'message'; matcher?: string };

export interface ScheduleWorkToolInput {
  idempotencyKey: string;
  destination: 'calendar' | 'automation';
  title: string;
  explanation: string;
  requiresUserConfirmation?: boolean;
  execution: ScheduleWorkExecutionInput;
  inputRefs?: Array<{ kind: 'release-kit'; itemId: string; sha256: string; label?: string }>;
  startAt?: string;
  timezone?: string;
  trigger?: ScheduleWorkTriggerInput;
  showOnCalendar?: boolean;
  continuation?: {
    goalSlug: string;
    objective: string;
    maxRounds: number;
  };
}

export interface ScheduleWorkResult {
  ok: boolean;
  destination?: ScheduleWorkToolInput['destination'];
  id?: string;
  title?: string;
  nextFireAt?: string;
  error?: string;
}

export async function handleScheduleWork(ctx: SessionToolContext, args: ScheduleWorkToolInput): Promise<ToolResult> {
  if (!ctx.scheduleWork) return errorResponse('schedule_work is only available to HNIC.');
  if (!args.idempotencyKey?.trim()) return errorResponse('idempotencyKey is required and must be reused when retrying the same request.');
  if (!args.title?.trim()) return errorResponse('title is required.');
  if (!args.explanation?.trim()) return errorResponse('explanation is required.');
  if (args.requiresUserConfirmation) {
    return errorResponse('Resolve the missing schedule or execution details and get user confirmation before scheduling work.');
  }
  if (!args.execution || (args.execution.type !== 'agent-task' && args.execution.type !== 'workflow-run')) {
    return errorResponse('execution must be an agent-task or workflow-run.');
  }
  if (args.execution.type === 'agent-task') {
    if (!args.execution.agentSlug?.trim()) return errorResponse('agent-task requires agentSlug.');
    if (!args.execution.brief?.trim()) return errorResponse('agent-task requires a clear brief.');
  } else if (!args.execution.workflowSlug?.trim()) {
    return errorResponse('workflow-run requires workflowSlug.');
  }
  if (args.continuation) {
    if (args.destination !== 'calendar' || args.execution.type !== 'agent-task') {
      return errorResponse('Continuation is available only for Calendar agent tasks.');
    }
    if (!args.continuation.goalSlug?.trim() || !args.continuation.objective?.trim()) {
      return errorResponse('Continuation requires goalSlug and objective.');
    }
    if (!Number.isInteger(args.continuation.maxRounds) || args.continuation.maxRounds < 2 || args.continuation.maxRounds > 8) {
      return errorResponse('Continuation maxRounds must be an integer from 2 through 8.');
    }
    if (args.execution.expectedOutput?.requirement !== 'required') {
      return errorResponse('Continuation requires a required expectedOutput contract.');
    }
    if (args.execution.permissionMode !== 'safe') {
      return errorResponse('Continuation runs are draft-only and require permissionMode safe.');
    }
  }
  for (const ref of args.inputRefs ?? []) {
    if (!ref.itemId?.trim() || !/^[a-f0-9]{64}$/i.test(ref.sha256)) {
      return errorResponse('Each Release Kit input requires an exact itemId and SHA-256 checksum.');
    }
  }
  if (args.destination === 'automation' && args.inputRefs?.length) {
    return errorResponse('Release Kit inputs are currently supported only for one-shot Calendar work.');
  }
  if (args.destination === 'calendar') {
    if (!args.startAt || Number.isNaN(Date.parse(args.startAt))) return errorResponse('Calendar work requires startAt as an ISO timestamp.');
    if (!args.timezone?.trim()) return errorResponse('Calendar work requires an IANA timezone.');
  } else if (args.destination === 'automation') {
    if (!args.trigger) return errorResponse('Automation work requires a trigger.');
  } else {
    return errorResponse('destination must be calendar or automation.');
  }

  try {
    const result = await ctx.scheduleWork(args);
    if (!result.ok) return errorResponse(result.error ?? 'Failed to schedule work.');
    const timing = result.nextFireAt ? ` Next run: ${result.nextFireAt}.` : '';
    return successResponse(`${result.destination === 'automation' ? 'Automation created' : 'Work scheduled'}: ${result.title ?? args.title}.${timing}`);
  } catch (error) {
    return errorResponse(`Failed to schedule work: ${error instanceof Error ? error.message : String(error)}`);
  }
}
