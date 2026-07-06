import type {
  AppActionDefinition,
  AppActionError,
  AppActionRuntimeContext,
  AppActionVaultKindHint,
  JsonSchema,
} from './types.ts';
import { appendSurfaceRecord, upsertSurfaceRecord } from './storage.ts';

function objectSchema(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required,
  };
}

const stringSchema = { type: 'string' };
const optionalStringSchema = { type: 'string' };
const stringArraySchema = { type: 'array', items: { type: 'string' } };
const vaultKindHints = new Set<AppActionVaultKindHint>([
  'master-final',
  'demo',
  'raw-footage',
  'cover-art',
  'artist-photo',
  'contract',
  'any',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validationError(message: string, fieldPath?: string): AppActionError {
  return { code: 'VALIDATION_FAILED', message, fieldPath };
}

function requireString(input: Record<string, unknown>, field: string): string | AppActionError {
  const value = input[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    return validationError(`${field} is required and must be a non-empty string.`, field);
  }
  return value.trim();
}

function optionalString(input: Record<string, unknown>, field: string): string | undefined | AppActionError {
  const value = input[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return validationError(`${field} must be a string when provided.`, field);
  return value.trim() || undefined;
}

function optionalStringArray(input: Record<string, unknown>, field: string): string[] | undefined | AppActionError {
  const value = input[field];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    return validationError(`${field} must be an array of strings when provided.`, field);
  }
  return value.map((entry) => entry.trim()).filter(Boolean);
}

function optionalVaultKindHint(input: Record<string, unknown>, field: string): AppActionVaultKindHint | undefined | AppActionError {
  const value = input[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !vaultKindHints.has(value as AppActionVaultKindHint)) {
    return validationError(`${field} must be one of: ${Array.from(vaultKindHints).join(', ')}.`, field);
  }
  return value as AppActionVaultKindHint;
}

function optionalRecord(input: Record<string, unknown>, field: string): Record<string, unknown> | undefined | AppActionError {
  const value = input[field];
  if (value === undefined) return undefined;
  if (!isRecord(value)) return validationError(`${field} must be an object when provided.`, field);
  return value;
}

function validateRecord<T>(input: unknown, fn: (record: Record<string, unknown>) => T | AppActionError): { ok: true; input: T } | { ok: false; errors: AppActionError[] } {
  if (!isRecord(input)) return { ok: false, errors: [validationError('input must be an object.')] };
  const result = fn(input);
  if (isActionError(result)) return { ok: false, errors: [result] };
  return { ok: true, input: result };
}

function isActionError(value: unknown): value is AppActionError {
  return isRecord(value) && typeof value.code === 'string' && typeof value.message === 'string';
}

function callbackAvailability(name: keyof AppActionRuntimeContext, label: string) {
  return (ctx: AppActionRuntimeContext) => typeof ctx[name] === 'function'
    ? { available: true }
    : { available: false, reason: `${label} adapter is not available in this session.`, repairHint: `Run this action from the desktop app after ${label} is wired.` };
}

function internalRecordAction<TInput extends Record<string, unknown>>(input: {
  id: string;
  title: string;
  description: string;
  surface: AppActionDefinition<TInput>['surface'];
  recordType: string;
  operation?: 'append' | 'upsert';
  matchFields?: string[];
  schema: JsonSchema;
  validate: (record: Record<string, unknown>) => TInput | AppActionError;
  summary: (input: TInput) => string;
}): AppActionDefinition<TInput> {
  return {
    id: input.id,
    version: 1,
    title: input.title,
    description: input.description,
    surface: input.surface,
    kind: 'create',
    risk: 'internal_write',
    inputSchema: input.schema,
    idempotency: { required: true, keyFields: ['title'], duplicateWindowSeconds: 86400, duplicateBehavior: 'return_prior' },
    approvalPolicy: { mode: 'never', summaryFields: ['title'], snapshotFields: ['title'] },
    capability: { defaultGrant: 'specialist', requiredActionGrants: [input.id], allowedBackground: true },
    audit: { redactInputFields: [], redactOutputFields: [], piiFields: [] },
    uiEvents: [{ type: `${input.surface}:updated`, target: input.recordType }],
    validate: (raw) => validateRecord(raw, input.validate),
    preview: (_ctx, normalized) => ({
      summary: input.summary(normalized),
      target: { surface: input.surface, entityType: input.recordType },
    }),
    execute: async (ctx, normalized) => {
      const record = input.operation === 'upsert'
        ? upsertSurfaceRecord(ctx, input.surface, input.recordType, normalized, input.matchFields ?? [])
        : appendSurfaceRecord(ctx, input.surface, input.recordType, normalized);
      return {
        output: record,
        target: { surface: input.surface, entityType: input.recordType, entityId: record.id },
        uiEvents: [{ type: `${input.surface}:updated`, payload: { entityType: input.recordType, entityId: record.id } }],
      };
    },
  };
}

function validateLinks(input: Record<string, unknown>): Array<{ type: string; id: string }> | undefined | AppActionError {
  const value = input.links;
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return validationError('links must be an array when provided.', 'links');
  const links: Array<{ type: string; id: string }> = [];
  for (const [index, link] of value.entries()) {
    if (!isRecord(link)) return validationError(`links[${index}] must be an object.`, `links[${index}]`);
    const type = requireString(link, 'type');
    if (isActionError(type)) return { ...type, fieldPath: `links[${index}].type` };
    const id = requireString(link, 'id');
    if (isActionError(id)) return { ...id, fieldPath: `links[${index}].id` };
    links.push({ type, id });
  }
  return links;
}

export const APP_ACTION_DEFINITIONS: Array<AppActionDefinition<any, any>> = [
  {
    id: 'outputs.create',
    version: 1,
    title: 'Create Output',
    description: 'Publish a durable RunnerOS Output or Work Product.',
    surface: 'outputs',
    kind: 'create',
    risk: 'internal_write',
    inputSchema: objectSchema({
      title: stringSchema,
      kind: { type: 'string' },
      summary: stringSchema,
      content: { type: 'string' },
      contentMimeType: { type: 'string' },
      tags: stringArraySchema,
      context: { type: 'object' },
      approval: { type: 'object' },
      showInCanvas: { type: 'boolean' },
    }, ['title', 'kind', 'summary']),
    idempotency: { required: true, keyFields: ['title', 'kind'], duplicateWindowSeconds: 86400, duplicateBehavior: 'return_prior' },
    approvalPolicy: { mode: 'never', summaryFields: ['title', 'kind'], snapshotFields: ['title', 'kind', 'summary'] },
    capability: { defaultGrant: 'all', requiredActionGrants: ['outputs.create'], allowedBackground: true },
    audit: { redactInputFields: [], redactOutputFields: [], piiFields: [] },
    uiEvents: [{ type: 'outputs:updated' }],
    availability: callbackAvailability('createOutput', 'Output'),
    validate: (raw) => validateRecord(raw, (record) => {
      const title = requireString(record, 'title');
      if (isActionError(title)) return title;
      const kind = requireString(record, 'kind');
      if (isActionError(kind)) return kind;
      const summary = requireString(record, 'summary');
      if (isActionError(summary)) return summary;
      return { ...record, title, kind, summary };
    }),
    preview: (_ctx, input) => ({
      summary: `Create Output "${String((input as Record<string, unknown>).title)}".`,
      target: { surface: 'outputs', entityType: 'output' },
    }),
    execute: async (ctx, input) => {
      if (!ctx.createOutput) throw new Error('Output adapter unavailable.');
      const result = await ctx.createOutput(input as Parameters<NonNullable<AppActionRuntimeContext['createOutput']>>[0]);
      if (!result.ok) throw new Error(result.error ?? 'Failed to create output.');
      return {
        output: result,
        target: { surface: 'outputs', entityType: 'output', entityId: result.outputId },
        outputId: result.outputId,
        uiEvents: [{ type: 'outputs:updated', payload: { outputId: result.outputId } }],
      };
    },
  },
  {
    id: 'approvals.request',
    version: 1,
    title: 'Request Approval',
    description: 'Create a pending approval Output for a proposed action.',
    surface: 'approvals',
    kind: 'create',
    risk: 'internal_write',
    inputSchema: objectSchema({
      title: stringSchema,
      summary: stringSchema,
      reason: optionalStringSchema,
      target: { type: 'object' },
    }, ['title', 'summary']),
    idempotency: { required: true, keyFields: ['title', 'target'], duplicateWindowSeconds: 86400, duplicateBehavior: 'return_prior' },
    approvalPolicy: { mode: 'never', summaryFields: ['title', 'summary'], snapshotFields: ['title', 'summary', 'target'] },
    capability: { defaultGrant: 'all', requiredActionGrants: ['approvals.request'], allowedBackground: true },
    audit: { redactInputFields: [], redactOutputFields: [], piiFields: [] },
    uiEvents: [{ type: 'approvals:updated' }, { type: 'outputs:updated' }],
    availability: callbackAvailability('createOutput', 'Output'),
    validate: (raw) => validateRecord(raw, (record) => {
      const title = requireString(record, 'title');
      if (isActionError(title)) return title;
      const summary = requireString(record, 'summary');
      if (isActionError(summary)) return summary;
      const reason = optionalString(record, 'reason');
      if (isActionError(reason)) return reason;
      const target = optionalRecord(record, 'target');
      if (isActionError(target)) return target;
      return { title, summary, reason, target };
    }),
    preview: (_ctx, input) => ({
      summary: `Request approval: ${String((input as Record<string, unknown>).title)}.`,
      target: { surface: 'approvals', entityType: 'approval' },
    }),
    execute: async (ctx, input) => {
      if (!ctx.createOutput) throw new Error('Output adapter unavailable.');
      const normalized = input as { title: string; summary: string; reason?: string; target?: unknown };
      const content = [
        `# ${normalized.title}`,
        '',
        normalized.summary,
        normalized.reason ? ['', `Reason: ${normalized.reason}`].join('\n') : '',
        normalized.target ? ['', '```json', JSON.stringify(normalized.target, null, 2), '```'].join('\n') : '',
      ].filter(Boolean).join('\n');
      const result = await ctx.createOutput({
        title: normalized.title,
        kind: 'receipt',
        summary: normalized.summary,
        content,
        contentMimeType: 'text/markdown',
        approval: { state: 'pending', note: normalized.reason },
        tags: ['approval'],
      });
      if (!result.ok) throw new Error(result.error ?? 'Failed to request approval.');
      return {
        output: result,
        target: { surface: 'approvals', entityType: 'approval', entityId: result.outputId },
        outputId: result.outputId,
        uiEvents: [
          { type: 'approvals:updated', payload: { outputId: result.outputId } },
          { type: 'outputs:updated', payload: { outputId: result.outputId } },
        ],
      };
    },
  },
  {
    id: 'workflows.start',
    version: 1,
    title: 'Start Workflow',
    description: 'Start an active RunnerOS workflow with trigger inputs.',
    surface: 'workflows',
    kind: 'create',
    risk: 'internal_write',
    inputSchema: objectSchema({
      slug: stringSchema,
      triggerInputs: { type: 'object' },
    }, ['slug']),
    idempotency: { required: true, keyFields: ['slug', 'triggerInputs'], duplicateWindowSeconds: 3600, duplicateBehavior: 'return_prior' },
    approvalPolicy: { mode: 'never', summaryFields: ['slug'], snapshotFields: ['slug', 'triggerInputs'] },
    capability: { defaultGrant: 'specialist', requiredActionGrants: ['workflows.start'], allowedBackground: true },
    audit: { redactInputFields: [], redactOutputFields: [], piiFields: [] },
    uiEvents: [{ type: 'workflow-runs:updated' }],
    availability: callbackAvailability('startWorkflow', 'Workflow'),
    validate: (raw) => validateRecord(raw, (record) => {
      const slug = requireString(record, 'slug');
      if (isActionError(slug)) return slug;
      const triggerInputs = optionalRecord(record, 'triggerInputs');
      if (isActionError(triggerInputs)) return triggerInputs;
      return { slug, triggerInputs: triggerInputs ?? {} };
    }),
    preview: (_ctx, input) => ({
      summary: `Start workflow "${String((input as Record<string, unknown>).slug)}".`,
      target: { surface: 'workflows', entityType: 'workflow', entityId: String((input as Record<string, unknown>).slug) },
    }),
    execute: async (ctx, input) => {
      if (!ctx.startWorkflow) throw new Error('Workflow adapter unavailable.');
      const normalized = input as { slug: string; triggerInputs?: Record<string, unknown> };
      const run = await ctx.startWorkflow(normalized.slug, normalized.triggerInputs ?? {});
      const runId = isRecord(run) && typeof run.id === 'string' ? run.id : undefined;
      return {
        output: run,
        target: { surface: 'workflows', entityType: 'workflow_run', entityId: runId ?? normalized.slug },
        uiEvents: [{ type: 'workflow-runs:updated', payload: { runId, slug: normalized.slug } }],
      };
    },
  },
  {
    id: 'vault.add_file',
    version: 1,
    title: 'Add File To Vault',
    description: 'Import one or more local files into Artist Vault.',
    surface: 'vault',
    kind: 'create',
    risk: 'internal_write',
    inputSchema: objectSchema({
      paths: stringArraySchema,
      kindHint: { type: 'string' },
    }, ['paths']),
    idempotency: { required: true, keyFields: ['paths', 'kindHint'], duplicateWindowSeconds: 86400, duplicateBehavior: 'return_prior' },
    approvalPolicy: { mode: 'never', summaryFields: ['paths'], snapshotFields: ['paths', 'kindHint'] },
    capability: { defaultGrant: 'specialist', requiredActionGrants: ['vault.add_file'], allowedBackground: true },
    audit: { redactInputFields: [], redactOutputFields: [], piiFields: ['paths'] },
    uiEvents: [{ type: 'vault:updated' }],
    availability: callbackAvailability('addVaultFiles', 'Vault'),
    validate: (raw) => validateRecord(raw, (record) => {
      const paths = optionalStringArray(record, 'paths');
      if (isActionError(paths)) return paths;
      if (!paths?.length) return validationError('paths must include at least one file path.', 'paths');
      const kindHint = optionalVaultKindHint(record, 'kindHint');
      if (isActionError(kindHint)) return kindHint;
      return { paths, kindHint };
    }),
    preview: (_ctx, input) => ({
      summary: `Add ${(input as { paths: string[] }).paths.length} file(s) to Vault.`,
      target: { surface: 'vault', entityType: 'asset' },
    }),
    execute: async (ctx, input) => {
      if (!ctx.addVaultFiles) throw new Error('Vault adapter unavailable.');
      const result = await ctx.addVaultFiles(input as Parameters<NonNullable<AppActionRuntimeContext['addVaultFiles']>>[0]);
      const first = result.imported?.[0];
      return {
        output: result,
        target: { surface: 'vault', entityType: 'asset', entityId: first?.id },
        uiEvents: [{ type: 'vault:updated', payload: { imported: result.imported ?? [] } }],
      };
    },
  },
  {
    id: 'vault.add_from_output',
    version: 1,
    title: 'Save Output To Vault',
    description: 'Save an existing Output asset into Artist Vault.',
    surface: 'vault',
    kind: 'create',
    risk: 'internal_write',
    inputSchema: objectSchema({
      outputId: stringSchema,
      assetId: optionalStringSchema,
      kindHint: optionalStringSchema,
    }, ['outputId']),
    idempotency: { required: true, keyFields: ['outputId', 'assetId', 'kindHint'], duplicateWindowSeconds: 86400, duplicateBehavior: 'return_prior' },
    approvalPolicy: { mode: 'never', summaryFields: ['outputId'], snapshotFields: ['outputId', 'assetId', 'kindHint'] },
    capability: { defaultGrant: 'specialist', requiredActionGrants: ['vault.add_from_output'], allowedBackground: true },
    audit: { redactInputFields: [], redactOutputFields: [], piiFields: [] },
    uiEvents: [{ type: 'vault:updated' }],
    availability: callbackAvailability('addOutputToVault', 'Vault'),
    validate: (raw) => validateRecord(raw, (record) => {
      const outputId = requireString(record, 'outputId');
      if (isActionError(outputId)) return outputId;
      const assetId = optionalString(record, 'assetId');
      if (isActionError(assetId)) return assetId;
      const kindHint = optionalVaultKindHint(record, 'kindHint');
      if (isActionError(kindHint)) return kindHint;
      return { outputId, assetId, kindHint };
    }),
    preview: (_ctx, input) => ({
      summary: `Save Output "${String((input as Record<string, unknown>).outputId)}" to Vault.`,
      target: { surface: 'vault', entityType: 'asset' },
    }),
    execute: async (ctx, input) => {
      if (!ctx.addOutputToVault) throw new Error('Vault adapter unavailable.');
      const result = await ctx.addOutputToVault(input as Parameters<NonNullable<AppActionRuntimeContext['addOutputToVault']>>[0]);
      const first = result.imported?.[0];
      return {
        output: result,
        target: { surface: 'vault', entityType: 'asset', entityId: first?.id },
        uiEvents: [{ type: 'vault:updated', payload: { imported: result.imported ?? [] } }],
      };
    },
  },
  internalRecordAction({
    id: 'kanban.create_card',
    title: 'Create Kanban Card',
    description: 'Create a durable internal Kanban card record.',
    surface: 'kanban',
    recordType: 'cards',
    schema: objectSchema({
      boardId: stringSchema,
      columnId: stringSchema,
      title: stringSchema,
      description: optionalStringSchema,
      dueAt: optionalStringSchema,
      links: { type: 'array' },
      labels: stringArraySchema,
    }, ['boardId', 'columnId', 'title']),
    validate: (record) => {
      const boardId = requireString(record, 'boardId');
      if (isActionError(boardId)) return boardId;
      const columnId = requireString(record, 'columnId');
      if (isActionError(columnId)) return columnId;
      const title = requireString(record, 'title');
      if (isActionError(title)) return title;
      const description = optionalString(record, 'description');
      if (isActionError(description)) return description;
      const dueAt = optionalString(record, 'dueAt');
      if (isActionError(dueAt)) return dueAt;
      const links = validateLinks(record);
      if (isActionError(links)) return links;
      const labels = optionalStringArray(record, 'labels');
      if (isActionError(labels)) return labels;
      return { boardId, columnId, title, description, dueAt, links, labels };
    },
    summary: (input) => `Create Kanban card "${input.title}".`,
  }),
  internalRecordAction({
    id: 'campaigns.create',
    title: 'Create Campaign',
    description: 'Create a durable internal campaign record.',
    surface: 'campaigns',
    recordType: 'campaigns',
    schema: objectSchema({
      title: stringSchema,
      description: optionalStringSchema,
      status: optionalStringSchema,
      startsAt: optionalStringSchema,
      endsAt: optionalStringSchema,
      tags: stringArraySchema,
    }, ['title']),
    validate: (record) => {
      const title = requireString(record, 'title');
      if (isActionError(title)) return title;
      const description = optionalString(record, 'description');
      if (isActionError(description)) return description;
      const status = optionalString(record, 'status');
      if (isActionError(status)) return status;
      const startsAt = optionalString(record, 'startsAt');
      if (isActionError(startsAt)) return startsAt;
      const endsAt = optionalString(record, 'endsAt');
      if (isActionError(endsAt)) return endsAt;
      const tags = optionalStringArray(record, 'tags');
      if (isActionError(tags)) return tags;
      return { title, description, status, startsAt, endsAt, tags };
    },
    summary: (input) => `Create campaign "${input.title}".`,
  }),
  internalRecordAction({
    id: 'campaigns.add_milestone',
    title: 'Add Campaign Milestone',
    description: 'Add a durable milestone record to a campaign.',
    surface: 'campaigns',
    recordType: 'milestones',
    schema: objectSchema({
      campaignId: stringSchema,
      title: stringSchema,
      dueAt: optionalStringSchema,
      status: optionalStringSchema,
      notes: optionalStringSchema,
    }, ['campaignId', 'title']),
    validate: (record) => {
      const campaignId = requireString(record, 'campaignId');
      if (isActionError(campaignId)) return campaignId;
      const title = requireString(record, 'title');
      if (isActionError(title)) return title;
      const dueAt = optionalString(record, 'dueAt');
      if (isActionError(dueAt)) return dueAt;
      const status = optionalString(record, 'status');
      if (isActionError(status)) return status;
      const notes = optionalString(record, 'notes');
      if (isActionError(notes)) return notes;
      return { campaignId, title, dueAt, status, notes };
    },
    summary: (input) => `Add campaign milestone "${input.title}".`,
  }),
  internalRecordAction({
    id: 'network.upsert_person',
    title: 'Upsert Network Person',
    description: 'Create or update an internal Network person record.',
    surface: 'network',
    recordType: 'people',
    operation: 'upsert',
    matchFields: ['email', 'socialHandle', 'name'],
    schema: objectSchema({
      name: stringSchema,
      email: optionalStringSchema,
      organization: optionalStringSchema,
      role: optionalStringSchema,
      socialHandle: optionalStringSchema,
      notes: optionalStringSchema,
      tags: stringArraySchema,
    }, ['name']),
    validate: (record) => {
      const name = requireString(record, 'name');
      if (isActionError(name)) return name;
      const email = optionalString(record, 'email');
      if (isActionError(email)) return email;
      const organization = optionalString(record, 'organization');
      if (isActionError(organization)) return organization;
      const role = optionalString(record, 'role');
      if (isActionError(role)) return role;
      const socialHandle = optionalString(record, 'socialHandle');
      if (isActionError(socialHandle)) return socialHandle;
      const notes = optionalString(record, 'notes');
      if (isActionError(notes)) return notes;
      const tags = optionalStringArray(record, 'tags');
      if (isActionError(tags)) return tags;
      return { name, email, organization, role, socialHandle, notes, tags };
    },
    summary: (input) => `Upsert Network person "${input.name}".`,
  }),
  internalRecordAction({
    id: 'fans.upsert_fan',
    title: 'Upsert Fan',
    description: 'Create or update an internal fan/community record.',
    surface: 'fans',
    recordType: 'fans',
    operation: 'upsert',
    matchFields: ['email', 'handle', 'name'],
    schema: objectSchema({
      name: stringSchema,
      email: optionalStringSchema,
      handle: optionalStringSchema,
      segment: optionalStringSchema,
      notes: optionalStringSchema,
      tags: stringArraySchema,
    }, ['name']),
    validate: (record) => {
      const name = requireString(record, 'name');
      if (isActionError(name)) return name;
      const email = optionalString(record, 'email');
      if (isActionError(email)) return email;
      const handle = optionalString(record, 'handle');
      if (isActionError(handle)) return handle;
      const segment = optionalString(record, 'segment');
      if (isActionError(segment)) return segment;
      const notes = optionalString(record, 'notes');
      if (isActionError(notes)) return notes;
      const tags = optionalStringArray(record, 'tags');
      if (isActionError(tags)) return tags;
      return { name, email, handle, segment, notes, tags };
    },
    summary: (input) => `Upsert fan "${input.name}".`,
  }),
  {
    id: 'calendar.create_event',
    version: 1,
    title: 'Create Calendar Event',
    description: 'Create a calendar event through a connected calendar provider.',
    surface: 'calendar',
    kind: 'create',
    risk: 'external_write',
    inputSchema: objectSchema({ title: stringSchema, start: { type: 'object' }, end: { type: 'object' } }, ['title', 'start', 'end']),
    idempotency: { required: true, keyFields: ['title', 'start', 'end'], duplicateWindowSeconds: 86400, duplicateBehavior: 'return_prior' },
    approvalPolicy: { mode: 'always', reason: 'Calendar writes can notify attendees or modify external state.', summaryFields: ['title'], snapshotFields: ['title', 'start', 'end', 'attendees'] },
    capability: { defaultGrant: 'none', requiredActionGrants: ['calendar.create_event'], requiredSourceSlugs: ['google-calendar'], allowedBackground: false, requiresExplicitUserIntent: true },
    audit: { redactInputFields: [], redactOutputFields: [], piiFields: ['attendees'] },
    uiEvents: [{ type: 'calendar:updated' }],
    availability: () => ({ available: false, reason: 'Calendar adapter is not implemented yet.', repairHint: 'Wire the Google Calendar adapter before enabling this action.' }),
    validate: (raw) => validateRecord(raw, (record) => record),
  },
  {
    id: 'outputs.update_approval',
    version: 1,
    title: 'Update Output Approval',
    description: 'Update approval state on an existing Output.',
    surface: 'outputs',
    kind: 'update',
    risk: 'internal_write',
    inputSchema: objectSchema({ outputId: stringSchema, state: stringSchema, note: optionalStringSchema }, ['outputId', 'state']),
    idempotency: { required: true, keyFields: ['outputId', 'state', 'note'], duplicateWindowSeconds: 86400, duplicateBehavior: 'return_prior' },
    approvalPolicy: { mode: 'never', summaryFields: ['outputId', 'state'], snapshotFields: ['outputId', 'state', 'note'] },
    capability: { defaultGrant: 'specialist', requiredActionGrants: ['outputs.update_approval'], allowedBackground: true },
    audit: { redactInputFields: [], redactOutputFields: [], piiFields: [] },
    uiEvents: [{ type: 'outputs:updated' }],
    availability: () => ({ available: false, reason: 'Output approval update adapter is not implemented yet.', repairHint: 'Add an OutputService approval update method before enabling this action.' }),
    validate: (raw) => validateRecord(raw, (record) => record),
  },
];

export const APP_ACTION_REGISTRY = new Map(APP_ACTION_DEFINITIONS.map((definition) => [definition.id, definition]));

export function getAppActionDefinition(actionId: string): AppActionDefinition | null {
  return APP_ACTION_REGISTRY.get(actionId) ?? null;
}

export function listAppActionIds(): string[] {
  return APP_ACTION_DEFINITIONS.map((definition) => definition.id);
}

export function isKnownAppActionId(actionId: string): boolean {
  return APP_ACTION_REGISTRY.has(actionId);
}

export function isValidActionGrant(grant: string): boolean {
  if (grant === '*') return true;
  if (grant === '*:read') return true;
  if (/^[a-z_]+\.\*$/.test(grant)) {
    const surface = grant.slice(0, -2);
    return APP_ACTION_DEFINITIONS.some((definition) => definition.surface === surface);
  }
  return isKnownAppActionId(grant);
}

export function actionGrantMatches(grant: string, definition: AppActionDefinition): boolean {
  if (grant === '*') return true;
  if (grant === '*:read') return definition.risk === 'read';
  if (grant.endsWith('.*')) return grant.slice(0, -2) === definition.surface;
  return grant === definition.id;
}
