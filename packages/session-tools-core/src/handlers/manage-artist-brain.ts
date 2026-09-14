import { z } from 'zod';
import type { SessionToolContext } from '../context';
import { errorResponse, successResponse } from '../response';

export const BRAIN_FIELDS = {
  profile: ['artistName','mission','aliases','bio','themes','sound','visualWorld','brandWords','audience','similarArtists','priorityMarkets','socialLinks','spotifyProfile','team','promoBudget','rules'],
  voice: ['summary','speakingStyle','vocabulary','avoid','captionExamples','commentReplyExamples','postExamples','writingExcerpts'],
  branding: ['creativeDna','tensions','fascinations','reactionHooks','mythology','emotionalTerritory','audienceGravity','notes'],
} as const;
export const manageArtistBrainSchema = z.object({
  action: z.enum(['read','update']),
  topic: z.enum(['profile','voice','branding']),
  changes: z.record(z.string().max(12000).nullable()).optional(),
  expectedRevision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
export const validatedManageArtistBrainSchema = manageArtistBrainSchema.superRefine((input, ctx) => {
  if (input.action === 'read' && (input.changes || input.expectedRevision)) ctx.addIssue({code:'custom',message:'Read accepts only a topic.'});
  if (input.action === 'update' && (!input.expectedRevision || !input.changes || !Object.keys(input.changes).length)) ctx.addIssue({code:'custom',message:'Read first, then supply its expectedRevision and the specific fields to change.'});
  for (const field of Object.keys(input.changes ?? {})) {
    if (!(BRAIN_FIELDS[input.topic] as readonly string[]).includes(field)) ctx.addIssue({code:'custom',message:`Unsupported ${input.topic} field: ${field}`});
  }
});
export type ManageArtistBrainInput = z.infer<typeof manageArtistBrainSchema>;
export async function handleManageArtistBrain(ctx: SessionToolContext, input: ManageArtistBrainInput) {
  const parsed = validatedManageArtistBrainSchema.safeParse(input);
  if (!parsed.success) return errorResponse(parsed.error.issues.map(issue => issue.message).join(' '));
  if (!ctx.manageArtistBrain) return errorResponse('Artist Brain setup is unavailable here.');
  try { return successResponse(JSON.stringify(await ctx.manageArtistBrain(parsed.data))); }
  catch (error) { return errorResponse(error instanceof Error ? error.message : 'Brain setup failed.'); }
}
