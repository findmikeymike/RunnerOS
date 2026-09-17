import { z } from 'zod';
import type { SessionToolContext } from '../context';
import { errorResponse, successResponse } from '../response';

export const saveReleaseCreativeBriefSchema = z.object({
  body: z.string().trim().min(1).max(11000).describe('The concise release creative brief in Markdown, without the stored Direction status header. Preserve useful existing artist decisions when revising.'),
  status: z.enum(['proposed', 'accepted']).describe('Use proposed unless the artist explicitly accepted this direction. Saving does not imply acceptance or authorize execution.'),
  expectedBody: z.string().max(12000).nullable().describe('Exact full body from get_workspace_context for campaign-creative-direction (maxChars: 12000); null only when no brief exists. Read and reconcile before replacing a saved brief.'),
}).strict();

export type SaveReleaseCreativeBriefInput = z.infer<typeof saveReleaseCreativeBriefSchema>;

export async function handleSaveReleaseCreativeBrief(ctx: SessionToolContext, input: SaveReleaseCreativeBriefInput) {
  const parsed = saveReleaseCreativeBriefSchema.safeParse(input);
  if (!parsed.success) return errorResponse(parsed.error.issues.map(issue => issue.message).join(' '));
  if (!ctx.saveReleaseCreativeBrief) return errorResponse('Saving release creative direction is available only to Creative Direction in a campaign.');
  try {
    return successResponse(JSON.stringify(await ctx.saveReleaseCreativeBrief(parsed.data)));
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'The release creative brief could not be saved.');
  }
}
