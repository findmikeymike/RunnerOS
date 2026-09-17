import { z } from 'zod';
import type { SessionToolContext } from '../context';
import { errorResponse, successResponse } from '../response';

export const proposeBrandingUpdateSchema = z.object({
  title: z.string().trim().min(1).max(160).describe('Short, plain-language description of the artist direction to review.'),
  patches: z.array(z.object({
    field: z.enum(['creativeDna', 'tensions', 'fascinations', 'reactionHooks', 'mythology', 'emotionalTerritory', 'audienceGravity', 'notes']),
    before: z.string().max(12000).describe('Exact current field text read from artist-branding; empty string only for an empty field.'),
    after: z.string().max(12000).describe('Complete proposed replacement for this field only. Preserve approved details unrelated to this change.'),
  }).strict()).max(8).default([]),
  additions: z.array(z.object({
    title: z.string().trim().min(1).max(160),
    body: z.string().trim().min(1).max(11000).describe('Useful supporting context, not scratch work. Once the artist applies it, agents can read it as supplementary context.'),
    sourceOutputId: z.string().trim().min(1).max(200).optional(),
  }).strict()).max(5).default([]),
}).strict();

export type ProposeBrandingUpdateInput = z.infer<typeof proposeBrandingUpdateSchema>;

export async function handleProposeBrandingUpdate(ctx: SessionToolContext, input: ProposeBrandingUpdateInput) {
  const parsed = proposeBrandingUpdateSchema.safeParse(input);
  if (!parsed.success) return errorResponse(parsed.error.issues.map(issue => issue.message).join(' '));
  if (parsed.data.patches.length + parsed.data.additions.length === 0) return errorResponse('Propose at least one specific change or supporting document.');
  if (!ctx.proposeBrandingUpdate) return errorResponse('Branding proposals are available to Artist Direction in Artist HQ.');
  try { return successResponse(JSON.stringify(await ctx.proposeBrandingUpdate(parsed.data))); }
  catch (error) { return errorResponse(error instanceof Error ? error.message : 'Could not prepare the branding proposal.'); }
}
