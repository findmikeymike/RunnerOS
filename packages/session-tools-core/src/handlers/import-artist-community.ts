import { z } from 'zod';
import type { SessionToolContext } from '../context.ts';
import { errorResponse, successResponse } from '../response.ts';

const text = (max: number) => z.string().trim().min(1).max(max);
export const importArtistCommunitySchema = z.object({
  people: z.array(z.object({
    email: z.string().trim().email().max(320),
    name: text(200).optional(),
    city: text(200).optional(),
    notes: text(4000).optional(),
    tags: z.array(text(80)).max(20).optional(),
    segment: z.enum(['vip', 'local', 'buyers', 'street-team', 'general']).optional(),
    consent: z.object({
      status: z.enum(['opted-in', 'transactional-only']),
      source: text(500).describe('Specific consent evidence supplied by the user, such as the signup form or original opted-in list. Never infer consent from an email address.'),
      capturedAt: z.string().datetime({ offset: true }).optional(),
    }).strict().optional().describe('Only include when the user explicitly supplies this consent and its source; otherwise consent stays unknown.'),
  }).strict()).min(1).max(100),
}).strict();
export type ImportArtistCommunityInput = z.infer<typeof importArtistCommunitySchema>;

export async function handleImportArtistCommunity(ctx: SessionToolContext, input: ImportArtistCommunityInput) {
  const parsed = importArtistCommunitySchema.safeParse(input);
  if (!parsed.success) return errorResponse(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  if (!ctx.importArtistCommunity) return errorResponse('Community import is unavailable in this context.');
  try { return successResponse(JSON.stringify(await ctx.importArtistCommunity(parsed.data))); }
  catch (error) { return errorResponse(error instanceof Error ? error.message : 'Community import failed.'); }
}
