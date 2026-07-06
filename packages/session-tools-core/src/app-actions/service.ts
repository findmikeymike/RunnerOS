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
  readIdempotencyEntry,
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
  if (!ctx.activeAgentSlug) return 'user:current';
  return ctx.parentAgentSlug && ctx.parentAgentSlug !== ctx.activeAgentSlug
    ? `agent:${ctx.parentAgentSlug}->${ctx.activeAgentSlug}`
    : `agent:${ctx.activeAgentSlug}`;
}

function permissionMode(ctx: AppActionRuntimeContext): string | undefined {
  const info = ctx.getSessionInfo?.(ctx.sessionId);
  if (info?.permissionMode) return info.permissionMode;
  if (!ctx.activeAgentSlug) return undefined;
  const agents = ctx.listAgents?.({ activeOnly: false }).agents ?? [];
  return agents.find((agent) => agent.slug === ctx.activeAgentSlug)?.permissionMode;
}

type ActiveAgentGrantState =
  | { kind: 'user' }
  | { kind: 'missing_agent' }
  | { kind: 'legacy' }
  | { kind: 'none' }
  | { kind: 'invalid'; invalidGrants: string[] }
  | { kind: 'valid'; grants: string[] };

function agentGrantState(ctx: AppActionRuntimeContext, agentSlug?: string): ActiveAgentGrantState {
  if (!agentSlug) return { kind: 'user' };
  const agents = ctx.listAgents?.({ activeOnly: false }).agents ?? [];
  const agent = agents.find((candidate) => candidate.slug === agentSlug);
  if (!agent) return { kind: 'missing_agent' };
  if (agent.actionGrants === undefined) return { kind: 'legacy' };
  if (agent.actionGrants.length === 0) return { kind: 'none' };
  const invalidGrants = agent.actionGrants.filter((grant) => typeof grant !== 'string' || !isValidActionGrant(grant));
  if (invalidGrants.length > 0) return { kind: 'invalid', invalidGrants };
  return { kind: 'valid', grants: agent.actionGrants };
}

function singleAgentGrantAvailability(ctx: AppActionRuntimeContext, definition: AppActionDefinition, agentSlug?: string, label = 'Active agent') {
  const state = agentGrantState(ctx, agentSlug);
  if (state.kind === 'user') return { available: true };
  if (state.kind === 'legacy') {
    // Legacy agents predate actionGrants. Allow internal actions, never external/destructive/credential.
    return definition.risk === 'internal_safe' || definition.risk === 'internal_write' || definition.risk === 'read'
      ? { available: true }
      : {
          available: false,
          reason: `Legacy agent ${agentSlug} is missing explicit action grants for ${definition.id}.`,
          repairHint: `Add actionGrants: ["${definition.id}"] to the agent metadata.`,
        };
  }
  if (state.kind === 'missing_agent') {
    return {
      available: false,
      reason: `${label} ${agentSlug} is not available in the action grant catalog.`,
      repairHint: 'Refresh the agent catalog before executing app actions.',
    };
  }
  if (state.kind === 'none') {
    return {
      available: false,
      reason: `${label} ${agentSlug} has no action grants.`,
      repairHint: `Add actionGrants: ["${definition.id}"] to the agent metadata.`,
    };
  }
  if (state.kind === 'invalid') {
    return {
      available: false,
      reason: `${label} ${agentSlug} has invalid action grants: ${state.invalidGrants.join(', ')}.`,
      repairHint: 'Fix or remove invalid actionGrants before executing app actions.',
    };
  }
  return state.grants.some((grant) => actionGrantMatches(grant, definition))
    ? { available: true }
    : {
        available: false,
        reason: `${label} ${agentSlug} is missing action grant ${definition.id}.`,
        repairHint: `Add actionGrants: ["${definition.id}"] to the agent metadata or run from HNIC/user context.`,
      };
}

function grantAvailability(ctx: AppActionRuntimeContext, definition: AppActionDefinition) {
  const active = singleAgentGrantAvailability(ctx, definition, ctx.activeAgentSlug, 'Active agent');
  if (!active.available) return active;
  if (ctx.parentAgentSlug && ctx.parentAgentSlug !== ctx.activeAgentSlug) {
    return singleAgentGrantAvailability(ctx, definition, ctx.parentAgentSlug, 'Parent agent');
  }
  return active;
}

function riskAllowedByPermission(ctx: AppActionRuntimeContext, definition: AppActionDefinition): boolean {
  const mode = permissionMode(ctx);
  if (definition.risk === 'read') return true;
  if (definition.risk === 'internal_safe') return true;
  if (definition.risk === 'internal_write') return mode === 'ask' || mode === 'allow-all';
  if (definition.risk === 'external_write' || definition.risk === 'destructive' || definition.risk === 'credential') {
    return definition.approvalPolicy.mode !== 'never';
  }
  return false;
}

function approvalRequired(definition: AppActionDefinition): boolean {
  if (definition.approvalPolicy.mode === 'always') return true;
  if (definition.approvalPolicy.mode === 'never') return false;
  return definition.risk === 'external_write' || definition.risk === 'destructive' || definition.risk === 'credential';
}

function capabilityAvailability(ctx: AppActionRuntimeContext, definition: AppActionDefinition) {
  const requiredSourceSlugs = definition.capability.requiredSourceSlugs ?? [];
  if (requiredSourceSlugs.length > 0) {
    if (!ctx.listSources) {
      return {
        available: false,
        reason: `Action ${definition.id} requires source(s): ${requiredSourceSlugs.join(', ')}.`,
        repairHint: 'Run this action from a session with source inventory bindings.',
      };
    }
    try {
      const sources = ctx.listSources({ activeOnly: true }).sources ?? [];
      const missing = requiredSourceSlugs.filter((slug) => {
        const source = sources.find((candidate) => candidate.slug === slug);
        return !source || !source.enabled || !['connected', 'none'].includes(source.authStatus ?? 'untested');
      });
      if (missing.length > 0) {
        return {
          available: false,
          reason: `Required source(s) are not connected or enabled: ${missing.join(', ')}.`,
          repairHint: 'Connect and enable the required source before executing this action.',
        };
      }
    } catch (error) {
      return {
        available: false,
        reason: error instanceof Error ? error.message : 'Could not verify required sources.',
        repairHint: 'Refresh source inventory before executing this action.',
      };
    }
  }

  const requiredOAuthScopes = definition.capability.requiredOAuthScopes ?? [];
  if (requiredOAuthScopes.length > 0) {
    return {
      available: false,
      reason: `Action ${definition.id} requires OAuth scope verification: ${requiredOAuthScopes.join(', ')}.`,
      repairHint: 'Wire scope-aware source verification before enabling this action.',
    };
  }

  return { available: true };
}

function getAvailability(ctx: AppActionRuntimeContext, definition: AppActionDefinition) {
  const grant = grantAvailability(ctx, definition);
  if (!grant.available) return grant;
  if (!riskAllowedByPermission(ctx, definition)) {
    return {
      available: false,
      reason: `Permission mode does not allow ${definition.risk} actions.`,
      repairHint: 'Run from a session with ask/allow-all permission mode bound, or request user approval through an approval action.',
    };
  }
  const capability = capabilityAvailability(ctx, definition);
  if (!capability.available) return capability;
  if (!definition.execute) {
    return {
      available: false,
      reason: 'Action adapter is not implemented.',
      repairHint: 'Add a surface adapter before executing this action.',
    };
  }
  return definition.availability?.(ctx) ?? { available: true };
}

function redactionFields(...groups: string[][]): string[] {
  return Array.from(new Set(groups.flat().map((field) => field.trim()).filter(Boolean)));
}

function redacted(value: unknown, fields: string[]): unknown {
  if (!fields.length || value === null || typeof value !== 'object') return value;
  const fieldSet = new Set(fields);
  const visit = (current: unknown, path: string): unknown => {
    if (current === null || typeof current !== 'object') return current;
    if (Array.isArray(current)) return current.map((entry, index) => visit(entry, path ? `${path}.${index}` : String(index)));
    const copy: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      copy[key] = fieldSet.has(key) || fieldSet.has(childPath) ? '[redacted]' : visit(child, childPath);
    }
    return copy;
  };
  return visit(value, '');
}

function valueAtPath(value: unknown, path: string): unknown {
  if (!path) return undefined;
  let current = value;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function projectedIdempotencyInput(definition: AppActionDefinition, normalizedInput: unknown): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const field of definition.idempotency.keyFields) {
    projected[field] = valueAtPath(normalizedInput, field);
  }
  return projected;
}

function actionIdempotencyKeys(input: {
  ctx: AppActionRuntimeContext;
  definition: AppActionDefinition;
  requestId: string;
  normalizedInput: unknown;
}): { requestKey: string; naturalKey?: string } {
  const workspaceId = getWorkspaceId(input.ctx);
  const base = {
    workspaceId,
    actionId: input.definition.id,
    actorStableId: actorStableId(input.ctx),
  };
  const requestKey = buildIdempotencyKey({
    ...base,
    requestId: input.requestId,
    normalizedInput: input.normalizedInput,
  });
  const naturalKey = input.definition.idempotency.keyFields.length > 0
    ? buildIdempotencyKey({
        ...base,
        requestId: '',
        normalizedInput: projectedIdempotencyInput(input.definition, input.normalizedInput),
      })
    : undefined;
  return { requestKey, naturalKey };
}

function entryWithinDuplicateWindow(
  entry: { receipt: AppActionReceipt; updatedAt?: string } | null,
  definition: AppActionDefinition,
): entry is { receipt: AppActionReceipt; updatedAt?: string } {
  if (!entry || entry.receipt.status === 'failed') return false;
  const updatedAtMs = entry.updatedAt ? Date.parse(entry.updatedAt) : Number.NaN;
  if (!Number.isFinite(updatedAtMs)) return true;
  return Date.now() - updatedAtMs <= definition.idempotency.duplicateWindowSeconds * 1000;
}

function writeIdempotencyKeys(
  ctx: AppActionRuntimeContext,
  keys: { requestKey: string; naturalKey?: string },
  receiptId: string,
): void {
  writeIdempotency(ctx, keys.requestKey, receiptId);
  if (keys.naturalKey && keys.naturalKey !== keys.requestKey) {
    writeIdempotency(ctx, keys.naturalKey, receiptId);
  }
}

function existingIdempotencyReceipt(
  ctx: AppActionRuntimeContext,
  keys: { requestKey: string; naturalKey?: string },
  definition: AppActionDefinition,
  options: { includeRequestKey: boolean },
): { receipt: AppActionReceipt; source: 'request' | 'natural' } | null {
  if (options.includeRequestKey) {
    const requestEntry = readIdempotencyEntry(ctx, keys.requestKey);
    if (entryWithinDuplicateWindow(requestEntry, definition)) return { receipt: requestEntry.receipt, source: 'request' };
  }
  if (keys.naturalKey && definition.idempotency.duplicateBehavior === 'return_prior') {
    const naturalEntry = readIdempotencyEntry(ctx, keys.naturalKey);
    if (entryWithinDuplicateWindow(naturalEntry, definition)) return { receipt: naturalEntry.receipt, source: 'natural' };
  }
  return null;
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
  const inputRedactionFields = redactionFields(input.definition.audit.redactInputFields, input.definition.audit.piiFields);
  const outputRedactionFields = redactionFields(input.definition.audit.redactOutputFields, input.definition.audit.piiFields);
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
      parentAgentSlug: input.ctx.parentAgentSlug,
      permissionMode: permissionMode(input.ctx),
    },
    status: input.status,
    risk: input.definition.risk,
    approvalId: input.approvalId,
    approvalSnapshotHash: input.approvalSnapshotHash,
    target: input.target,
    redactedInput: redacted(input.normalizedInput, inputRedactionFields),
    redactedOutput: redacted(input.output, outputRedactionFields),
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

  const idempotencyKeys = actionIdempotencyKeys({
    ctx,
    definition,
    requestId: input.requestId ?? '',
    normalizedInput: validated.input,
  });
  const existing = existingIdempotencyReceipt(ctx, idempotencyKeys, definition, { includeRequestKey: Boolean(input.requestId) });
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
    idempotencyKey: idempotencyKeys.requestKey,
    duplicateOfReceiptId: existing?.receipt.id,
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

  const idempotencyKeys = actionIdempotencyKeys({
    ctx,
    definition,
    requestId: input.requestId,
    normalizedInput: validated.input,
  });
  const existing = existingIdempotencyReceipt(ctx, idempotencyKeys, definition, { includeRequestKey: true });
  const existingRequest = readIdempotencyReceipt(ctx, idempotencyKeys.requestKey);
  if (existing && existing.receipt.status !== 'failed') {
    if (existing.source !== 'request' || existing.receipt.status !== 'approval_required' || !input.approvalToken) {
      return {
        status: 'duplicate',
        duplicateOfReceiptId: existing.receipt.id,
        receipt: existing.receipt,
      };
    }
    if (input.approvalToken !== existing.receipt.approvalId) {
      const error = actionError('APPROVAL_STALE', 'Approval token does not match the pending app action approval.');
      const receipt = writeReceipt(ctx, makeReceipt({
        ctx,
        definition,
        requestId: input.requestId,
        idempotencyKey: idempotencyKeys.requestKey,
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
      idempotencyKey: idempotencyKeys.requestKey,
      status: 'failed',
      normalizedInput: validated.input,
      error,
    }));
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
      idempotencyKey: idempotencyKeys.requestKey,
      status: 'approval_required',
      normalizedInput: validated.input,
      approvalId,
      approvalSnapshotHash,
    }));
    writeIdempotencyKeys(ctx, idempotencyKeys, receipt.id);
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

  if (approvalRequired(definition)) {
    if (!existingRequest || existingRequest.status !== 'approval_required' || !existingRequest.approvalId || !existingRequest.approvalSnapshotHash) {
      const error = actionError('APPROVAL_REQUIRED', 'This app action requires a pending approval receipt before execution.');
      const receipt = writeReceipt(ctx, makeReceipt({
        ctx,
        definition,
        requestId: input.requestId,
        idempotencyKey: idempotencyKeys.requestKey,
        status: 'failed',
        normalizedInput: validated.input,
        error,
      }));
      return { status: 'failed', receipt, errors: [error] };
    }
    if (!ctx.verifyAppActionApproval) {
      const error = actionError('ACTION_UNAVAILABLE', 'Approval verification is not available in this session.', 'Run this action after a user-facing approval verifier is wired.');
      const receipt = writeReceipt(ctx, makeReceipt({
        ctx,
        definition,
        requestId: input.requestId,
        idempotencyKey: idempotencyKeys.requestKey,
        status: 'failed',
        normalizedInput: validated.input,
        error,
      }));
      return { status: 'failed', receipt, errors: [error] };
    }
    const verification = await ctx.verifyAppActionApproval({
      approvalId: existingRequest.approvalId,
      actionId: definition.id,
      actionVersion: definition.version,
      idempotencyKey: idempotencyKeys.requestKey,
      approvalSnapshotHash: existingRequest.approvalSnapshotHash,
      requestId: input.requestId,
      redactedInput: existingRequest.redactedInput,
    });
    if (!verification.approved) {
      const error = actionError('APPROVAL_REQUIRED', verification.reason ?? 'User approval has not been granted for this app action.');
      const receipt = writeReceipt(ctx, makeReceipt({
        ctx,
        definition,
        requestId: input.requestId,
        idempotencyKey: idempotencyKeys.requestKey,
        status: 'failed',
        normalizedInput: validated.input,
        error,
      }));
      return { status: 'failed', receipt, errors: [error] };
    }
  }

  try {
    const result = await definition.execute!(ctx, validated.input as never);
    const receipt = writeReceipt(ctx, makeReceipt({
      ctx,
      definition,
      requestId: input.requestId,
      idempotencyKey: idempotencyKeys.requestKey,
      status: 'succeeded',
      normalizedInput: validated.input,
      output: result.output,
      target: result.target,
      outputId: result.outputId,
      workProductId: result.workProductId,
      uiEvents: result.uiEvents,
    }));
    writeIdempotencyKeys(ctx, idempotencyKeys, receipt.id);
    return { status: 'succeeded', receipt };
  } catch (error) {
    const actionFailure = actionError('INTERNAL_ERROR', error instanceof Error ? error.message : 'Unknown app action failure.');
    const receipt = writeReceipt(ctx, makeReceipt({
      ctx,
      definition,
      requestId: input.requestId,
      idempotencyKey: idempotencyKeys.requestKey,
      status: 'failed',
      normalizedInput: validated.input,
      error: actionFailure,
    }));
    return { status: 'failed', receipt, errors: [actionFailure] };
  }
}

export function getAppActionReceipt(ctx: AppActionRuntimeContext, input: AppActionGetReceiptInput): AppActionReceipt | null {
  return readReceipt(ctx, input.receiptId);
}

export { isValidActionGrant };
