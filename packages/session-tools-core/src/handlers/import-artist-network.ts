import { z } from 'zod';
import type { SessionToolContext } from '../context.ts';
import { errorResponse, successResponse } from '../response.ts';

const text = (limit: number) => z.string().trim().min(1).max(limit);
export const importArtistNetworkSchema = z.object({
  people: z.array(z.object({
    name: text(200),
    email: z.string().trim().email().max(320).optional(),
    distinctPersonConfirmed: z.boolean().optional().describe("Only true after the user confirms this is a different person sharing a saved name; requires a different supplied email."),
    role: text(300).optional(),
    notes: text(4000).optional(),
    canHelpWith: text(1000).optional(),
    tags: z.array(text(80)).max(20).optional(),
  }).strict().superRefine((person, ctx) => {
    if (person.distinctPersonConfirmed && !person.email) ctx.addIssue({ code: 'custom', message: 'A distinct-person confirmation requires an email.', path: ['email'] });
  })).min(1).max(100),
}).strict();
export type ImportArtistNetworkInput = z.infer<typeof importArtistNetworkSchema>;

export async function handleImportArtistNetwork(ctx: SessionToolContext, input: ImportArtistNetworkInput) {
  const parsed = importArtistNetworkSchema.safeParse(input);
  if (!parsed.success) return errorResponse(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  if (!ctx.importArtistNetwork) return errorResponse('Network import is unavailable in this context.');
  try { return successResponse(JSON.stringify(await ctx.importArtistNetwork(parsed.data))); }
  catch (error) { return errorResponse(error instanceof Error ? error.message : 'Network import failed.'); }
}
