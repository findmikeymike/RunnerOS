import { canonical, digest, type DurableClaim, type DurableJournal } from '../../../shared/src/durable-execution/index.ts';
import type { DurableJson } from '../../../shared/src/protocol/durable-execution.ts';
import { appendOutputSchemaInstruction, parseStructuredStepOutput } from '../../../shared/src/workflows/output-schema.ts';
import type { JsonSchema } from '../../../shared/src/workflows/types.ts';
import type { DurableReadInput, DurableReadRunner } from './durable-read-runner.ts';

/** Stable child identity belongs to its parent slot, never completion order or retry count. */
export function durableChildRunId(workspaceId: string, parentRunId: string, slotId: string): string {
  const hash = digest(['durable-child-v1', workspaceId, parentRunId, slotId]);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/** Certify only the schema subset actually enforced by the existing workflow parser. */
export function validateDurableChildSchema(schema: JsonSchema): void {
  canonical(schema);
  if (!schema || Array.isArray(schema) || typeof schema !== 'object' || Object.keys(schema).some(key => !['type', 'properties', 'required', 'items', 'enum'].includes(key)) || !['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(schema.type as string)) throw new Error('durable-child-schema-unsupported');
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.some(value => value !== null && typeof value === 'object'))) throw new Error('durable-child-schema-unsupported');
  if (schema.required !== undefined && (schema.type !== 'object' || !Array.isArray(schema.required) || schema.required.some(key => typeof key !== 'string' || key in Object.prototype))) throw new Error('durable-child-schema-unsupported');
  if (schema.properties !== undefined) {
    if (schema.type !== 'object' || !schema.properties || Array.isArray(schema.properties) || typeof schema.properties !== 'object') throw new Error('durable-child-schema-unsupported');
    for (const value of Object.values(schema.properties)) validateDurableChildSchema(value as JsonSchema);
  }
  if (schema.items !== undefined) {
    if (schema.type !== 'array') throw new Error('durable-child-schema-unsupported');
    validateDurableChildSchema(schema.items as JsonSchema);
  }
}

export interface DurableChildRequest {
  slotId: string;
  mode: 'required' | 'detached';
  /** Detachment is explicit independent work; required children remain parent-owned. */
  prompt: string;
  systemPrompt: string;
  allowedTools: DurableReadInput['allowedTools'];
  maxOutputTokens: number;
  maxModelAttempts: number;
  deadlineAt: number;
  costPolicy: DurableReadInput['costPolicy'];
  outputSchema: JsonSchema;
}
export interface DurableChildResult { childRunId: string; status: 'joined' | 'waiting' | 'detached'; output?: DurableJson }
export interface DurableChildRunnerOptions { journal: DurableJournal; runner: Pick<DurableReadRunner, 'resume'> }

/** One-level, local-read delegation. No legacy messaging/session fallback is permitted. */
export class DurableChildRunner {
  constructor(private readonly options: DurableChildRunnerOptions) {}

  async start(claim: DurableClaim, request: DurableChildRequest): Promise<DurableChildResult> {
    claim = Object.freeze(JSON.parse(canonical(claim)) as DurableClaim);
    const pinned = JSON.parse(canonical(request)) as DurableChildRequest;
    if (Object.keys(pinned).some(key => !['slotId', 'mode', 'prompt', 'systemPrompt', 'allowedTools', 'maxOutputTokens', 'maxModelAttempts', 'deadlineAt', 'costPolicy', 'outputSchema'].includes(key)) || !pinned.slotId?.trim() || !['required', 'detached'].includes(pinned.mode) || !pinned.prompt?.trim() || !pinned.systemPrompt?.trim()) throw new Error('invalid-durable-child-request');
    validateDurableChildSchema(pinned.outputSchema);
    const parent = this.options.journal.get(claim.runId, claim.workspaceId);
    if (!parent.spec.approvalPrincipalId) throw new Error('durable-child-principal-required');
    const childRunId = durableChildRunId(claim.workspaceId, claim.runId, pinned.slotId);
    const frozen = parent.spec.context as Record<string, DurableJson>;
    const childSpec = {
      ...parent.spec, runId: childRunId, commandId: `child:${claim.runId}:${pinned.slotId}`,
      context: { ...frozen, prompt: appendOutputSchemaInstruction(pinned.prompt, pinned.outputSchema), systemPrompt: pinned.systemPrompt },
      allowedTools: pinned.allowedTools, maxOutputTokens: pinned.maxOutputTokens,
      maxModelAttempts: pinned.maxModelAttempts, deadlineAt: pinned.deadlineAt, costPolicy: pinned.costPolicy,
      parent: { runId: claim.runId, slotId: pinned.slotId, mode: pinned.mode },
    };
    const edge = this.options.journal.admitChild(claim, { slotId: pinned.slotId, mode: pinned.mode, childSpec, outputSchema: pinned.outputSchema as DurableJson });
    if (edge.status === 'joined') return { childRunId, status: 'joined', output: edge.result! };
    if (pinned.mode === 'detached') {
      void this.options.runner.resume(childRunId, claim.workspaceId).catch(() => {});
      return { childRunId, status: 'detached' };
    }
    const child = await this.options.runner.resume(childRunId, claim.workspaceId);
    if (child.status !== 'succeeded') {
      if (['failed', 'cancelled'].includes(child.status)) throw new Error(`durable-child-${child.status}`);
      return { childRunId, status: 'waiting' };
    }
    const joined = this.options.journal.joinChild(claim, pinned.slotId, (text, schema) => {
      validateDurableChildSchema(schema as JsonSchema);
      const result = parseStructuredStepOutput(text, schema as JsonSchema);
      if (!result.ok) throw new Error(`durable-child-${result.code}`);
      return JSON.parse(canonical(result.value)) as DurableJson;
    });
    return { childRunId, status: 'joined', output: joined.result! };
  }
}
