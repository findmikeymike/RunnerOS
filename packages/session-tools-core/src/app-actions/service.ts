import { randomUUID } from 'node:crypto';
import type {
  AppActionCallInput,
  AppActionDefinition,
  AppActionError,
  AppActionExecuteResult,
  AppActionGetReceiptInput,
  AppActionListInput,
  AppActionListItem,
  AppActionListResult,
  AppActionPreview,
  AppActionPreviewInput,
  AppActionReceipt,
  AppActionRuntimeContext,
} from './types.ts';
import {
  APP_ACTION_DEFINITIONS,
  actionGrantMatches,
  getAppActionDefinition,
  isValidActionGrant,
} from './registry.ts';
import {
  buildIdempotencyKey,
  getWorkspaceId,
  nowIso,
  readIdempotencyReceipt,
  readReceipt,
  sha256,
  stableStringify,
  writeIdempotency,
  writeReceipt,
} from './storage.ts';

function actionError(code: AppActionError['code'], message: string, repairHint?: string): AppActionError {
  return { code, message, repairHint };
}

function actorStableId(ctx: AppActionRuntimeContext): string {
  return ctx.activeAgentSlug ? `agent:${ctx.activeAgentSlug}` : 'user:current';
}

function permissionMode(ctx: AppActionRuntimeContext): string | undefined {
  const info = ctx.getSessionInfo?.(ctx.sessionId);
  if (info?.permissionMode) return info.permissionMode;
  if (!ctx.activeAgentSlug) return undefined;
  const agents = ctx.listAgents?.({ activeOnly: false }).agents ?? [];
  return agents.find((agent) => agent.slug === ctx.activeAgentSlug)?.permissionMode;
}

function activeAgentGrants(ctx: AppActionRuntimeContext): string[] | null {
  if (!ctx.activeAgentSlug) return null;
  const agents = ctx.listAgents?.({ activeOnly: false }).agents ?? [];
  const agent = agents.find((candidate) => candidate.slug === ctx.activeAgentSlug);
  if (!agent) return [];
  return agent.actionGrants?.filter(isValidActionGrant) ?? [];
}

function hasActionGrant(ctx: AppActionRuntimeContext, definition: AppActionDefinition): boolean {
  const grants = activeAgentGrants(ctx);
  if (grants === null) return true;
  if (grants.length === 0) {
    // Legacy agents predate actionGrants. Allow internal actions, never external/destructive/credential.
    return definition.risk === 'internal_safe' || definition.risk === 'internal_write' || definition.risk === 'read';
  }
  return grants.some((grant) => actionGrantMatches(grant, definition));
}

function riskAllowedByPermission(ctx: AppActionRuntimeContext, definition: AppActionDefinition): boolean {
  const mode = permissionMode(ctx);
  if (definition.risk === 'read') return true;
  if (definition.risk === 'internal_safe') return true;
  if (definition.risk === 'internal_write') return mode !== 'safe';
  return false;
}

function approvalRequired(definition: AppActionDefinition): boolean {
  if (definition.approvalPolicy.mode === 'always') return true;
  if (definition.approvalPolicy.mode === 'never') return false;
  return definition.risk === 'external_write' || definition.risk === 'destructive' || definition.risk === 'credential';
}

function getAvailability(ctx: AppActionRuntimeContext, definition: AppActionDefinition) {
  if (!hasActionGrant(ctx, definition)) {
    return {
      available: false,
      reason: `Actor is missing action grant ${definition.id}.`,
      repairHint: `Add actionGrants: ["${definition.id}"] to the agent metadata or run from HNIC/user context.`,
    };
  }
  if (!riskAllowedByPermission(ctx, definition)) {
    return {
      available: false,
      reason: `Permission mode does not allow ${definition.risk} actions.`,
      repairHint: 'Use ask/allow-all mode or request user approval through an approval action.',
    };
  }
  if (!definition.execute) {
    return {
      available: false,
      reason: 'Action adapter is not implemented.',
      repairHint: 'Add a surface adapter before executing this action.',
    };
  }
  return definition.availability?.(ctx) ?? { available: true };
}

function redacted(value: unknown, fields: string[]): unknown {
  if (!fields.length || value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const copy = { ...(value as Record<string, unknown>) };
  for (const field of fields) {
    if (field in copy) copy[field] = '[redacted]';
  }
  return copy;
}

function makeReceipt(input: {
  ctx: AppActionRuntimeContext;
  definition: AppActionDefinition;
  requestId: string;
  idempotencyKey: string;
  status: AppActionReceipt['status'];
  normalizedInput: unknown;
  output?: unknown;
  target?: AppActionReceipt['target'];
  error?: AppActionError;
  outputId?: string;
  workProductId?: string;
  approvalId?: string;
  approvalSnapshotHash?: string;
  uiEvents?: AppActionReceipt['uiEvents'];
}): AppActionReceipt {
  const createdAt = nowIso();
  const actorAgentSlug = input.ctx.activeAgentSlug;
  return {
    schemaVersion: 1,
    id: `appact_${randomUUID()}`,
    actionId: input.definition.id,
    actionVersion: input.definition.version,
    requestId: input.requestId,
    idempotencyKey: input.idempotencyKey,
    workspaceId: getWorkspaceId(input.ctx),
    sessionId: input.ctx.sessionId,
    actor: {
      type: actorAgentSlug ? 'agent' : 'user',
      agentSlug: actorAgentSlug,
      permissionMode: permissionMode(input.ctx),
    },
    status: input.status,
    risk: input.definition.risk,
    approvalId: input.approvalId,
    approvalSnapshotHash: input.approvalSnapshotHash,
    target: input.target,
    redactedInput: redacted(input.normalizedInput, input.definition.audit.redactInputFields),
    redactedOutput: redacted(input.output, input.definition.audit.redactOutputFields),
    error: input.error,
    outputId: input.outputId,
    workProductId: input.workProductId,
    uiEvents: input.uiEvents ?? input.definition.uiEvents.map((event) => ({ type: event.type, payload: { target: event.target } })),
    createdAt,
    completedAt: input.status === 'approval_required' ? undefined : createdAt,
  };
}

export function listAppActions(ctx: AppActionRuntimeContext, input: AppActionListInput = {}): AppActionListResult {
  const items: AppActionListItem[] = [];
  for (const definition of APP_ACTION_DEFINITIONS) {
    if (input.surface && definition.surface !== input.surface) continue;
    const availability = getAvailability(ctx, definition);
    if (!input.includeUnavailable && !availability.available) continue;
    items.push({
      id: definition.id,
      title: definition.title,
      description: definition.description,
      surface: definition.surface,
      kind: definition.kind,
      risk: definition.risk,
      inputSchema: definition.inputSchema,
      outputSchema: definition.outputSchema,
      approval: {
        mode: definition.approvalPolicy.mode,
        reason: definition.approvalPolicy.reason,
      },
      availability,
    });
  }
  return { actions: items };
}

export async function previewAppAction(ctx: AppActionRuntimeContext, input: AppActionPreviewInput): Promise<AppActionPreview> {
  const definition = getAppActionDefinition(input.actionId);
  if (!definition) {
    return { ok: false, actionId: input.actionId, errors: [actionError('ACTION_NOT_FOUND', `Unknown app action: ${input.actionId}`)] };
  }

  const validated = definition.validate(input.input);
  if (!validated.ok) return { ok: false, actionId: definition.id, errors: validated.errors };

  const workspaceId = getWorkspaceId(ctx);
  const idempotencyKey = buildIdempotencyKey({
    workspaceId,
    actionId: definition.id,
    actorStableId: actorStableId(ctx),
    requestId: input.requestId ?? '',
    normalizedInput: validated.input,
  });
  const existing = input.requestId ? readIdempotencyReceipt(ctx, idempotencyKey) : null;
  const availability = getAvailability(ctx, definition);
  const expectedChange = definition.preview
    ? await definition.preview(ctx, validated.input as never)
    : { summary: definition.description, target: { surface: definition.surface } };

  return {
    ok: availability.available,
    actionId: definition.id,
    normalizedInput: validated.input,
    risk: definition.risk,
    approvalRequired: approvalRequired(definition),
    approvalReason: approvalRequired(definition) ? definition.approvalPolicy.reason ?? `${definition.risk} action requires approval.` : undefined,
    idempotencyKey,
    duplicateOfReceiptId: existing?.id,
    expectedChange,
    errors: availability.available ? undefined : [actionError('ACTION_UNAVAILABLE', availability.reason ?? 'Action unavailable.', availability.repairHint)],
  };
}

export async function executeAppAction(ctx: AppActionRuntimeContext, input: AppActionCallInput): Promise<AppActionExecuteResult> {
  const definition = getAppActionDefinition(input.actionId);
  if (!definition) {
    return { status: 'failed', errors: [actionError('ACTION_NOT_FOUND', `Unknown app action: ${input.actionId}`)] };
  }

  const validated = definition.validate(input.input);
  if (!validated.ok) return { status: 'failed', errors: validated.errors };

  const workspaceId = getWorkspaceId(ctx);
  const idempotencyKey = buildIdempotencyKey({
    workspaceId,
    actionId: definition.id,
    actorStableId: actorStableId(ctx),
    requestId: input.requestId,
    normalizedInput: validated.input,
  });
  const existing = readIdempotencyReceipt(ctx, idempotencyKey);
  if (existing) {
    if (existing.status !== 'approval_required' || !input.approvalToken) {
      return {
        status: 'duplicate',
        duplicateOfReceiptId: existing.id,
        receipt: existing,
      };
    }
    if (input.approvalToken !== existing.approvalId) {
      const error = actionError('APPROVAL_STALE', 'Approval token does not match the pending app action approval.');
      const receipt = writeReceipt(ctx, makeReceipt({
        ctx,
        definition,
        requestId: input.requestId,
        idempotencyKey,
        status: 'failed',
        normalizedInput: validated.input,
        error,
      }));
      return { status: 'failed', receipt, errors: [error] };
    }
  }

  const availability = getAvailability(ctx, definition);
  if (!availability.available) {
    const error = actionError('ACTION_UNAVAILABLE', availability.reason ?? 'Action unavailable.', availability.repairHint);
    const receipt = writeReceipt(ctx, makeReceipt({
      ctx,
      definition,
      requestId: input.requestId,
      idempotencyKey,
      status: 'failed',
      normalizedInput: validated.input,
      error,
    }));
    writeIdempotency(ctx, idempotencyKey, receipt.id);
    return { status: 'failed', receipt, errors: [error] };
  }

  if (input.dryRun) {
    const preview = await previewAppAction(ctx, {
      actionId: definition.id,
      input: validated.input,
      requestId: input.requestId,
      intendedSurface: input.intendedSurface,
    });
    return {
      status: preview.ok ? 'queued' : 'failed',
      errors: preview.errors,
    };
  }

  if (approvalRequired(definition) && !input.approvalToken) {
    const approvalId = `approval_${randomUUID()}`;
    const approvalSnapshotHash = sha256(stableStringify({
      actionId: definition.id,
      actionVersion: definition.version,
      input: validated.input,
      actor: actorStableId(ctx),
    }));
    const receipt = writeReceipt(ctx, makeReceipt({
      ctx,
      definition,
      requestId: input.requestId,
      idempotencyKey,
      status: 'approval_required',
      normalizedInput: validated.input,
      approvalId,
      approvalSnapshotHash,
    }));
    writeIdempotency(ctx, idempotencyKey, receipt.id);
    return {
      status: 'approval_required',
      receipt,
      approval: {
        approvalId,
        requiredBy: definition.id,
        summary: {
          title: definition.title,
          actionId: definition.id,
          risk: definition.risk,
          reason: definition.approvalPolicy.reason ?? `${definition.risk} action requires approval.`,
          input: receipt.redactedInput,
        },
      },
    };
  }

  try {
    const result = await definition.execute!(ctx, validated.input as never);
    const receipt = writeReceipt(ctx, makeReceipt({
      ctx,
      definition,
      requestId: input.requestId,
      idempotencyKey,
      status: 'succeeded',
      normalizedInput: validated.input,
      output: result.output,
      target: result.target,
      outputId: result.outputId,
      workProductId: result.workProductId,
      uiEvents: result.uiEvents,
    }));
    writeIdempotency(ctx, idempotencyKey, receipt.id);
    return { status: 'succeeded', receipt };
  } catch (error) {
    const actionFailure = actionError('INTERNAL_ERROR', error instanceof Error ? error.message : 'Unknown app action failure.');
    const receipt = writeReceipt(ctx, makeReceipt({
      ctx,
      definition,
      requestId: input.requestId,
      idempotencyKey,
      status: 'failed',
      normalizedInput: validated.input,
      error: actionFailure,
    }));
    writeIdempotency(ctx, idempotencyKey, receipt.id);
    return { status: 'failed', receipt, errors: [actionFailure] };
  }
}

export function getAppActionReceipt(ctx: AppActionRuntimeContext, input: AppActionGetReceiptInput): AppActionReceipt | null {
  return readReceipt(ctx, input.receiptId);
}

export { isValidActionGrant };
