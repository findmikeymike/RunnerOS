import { z } from 'zod';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse, successResponse } from '../response.ts';

/** Browser sign-in belongs to the artist; this contract never accepts credentials. */
export const setupSocialAccountSchema = z.object({
  action: z.enum(['list', 'add', 'open', 'verify']),
  platform: z.enum(['instagram', 'tiktok', 'x', 'youtube', 'spotify']).optional(),
  profile: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/i, 'Use a short account reference with no spaces.').optional(),
  spotifySurface: z.enum(['artists', 'web-player', 'ads-manager']).optional(),
  accountGroup: z.string().max(120).optional(),
  handle: z.string().max(120).optional(),
  accountUrl: z.string().url().max(2048).optional(),
}).strict();
export const validatedSetupSocialAccountSchema = setupSocialAccountSchema.superRefine((input, ctx) => {
  if (input.action !== 'list' && (!input.platform || !input.profile)) {
    ctx.addIssue({ code: 'custom', message: 'Platform and saved account reference are required.' });
  }
  if (input.platform === 'spotify' && ['open', 'verify'].includes(input.action) && !input.spotifySurface) {
    ctx.addIssue({ code: 'custom', message: 'Choose the Spotify surface explicitly: artists, web-player, or ads-manager.' });
  }
  if (input.spotifySurface && input.platform !== 'spotify') {
    ctx.addIssue({ code: 'custom', message: 'Spotify surface applies only to Spotify.' });
  }
  if (input.action !== 'add' && [input.accountGroup, input.handle, input.accountUrl].some(value => value !== undefined)) {
    ctx.addIssue({ code: 'custom', message: 'Account identity fields are only accepted when adding an account.' });
  }
});
export type SetupSocialAccountInput = z.infer<typeof setupSocialAccountSchema>;

export async function handleSetupSocialAccount(ctx: SessionToolContext, input: SetupSocialAccountInput): Promise<ToolResult> {
  const parsed = validatedSetupSocialAccountSchema.safeParse(input);
  if (!parsed.success) return errorResponse(parsed.error.issues.map(issue => issue.message).join(' '));
  if (!ctx.setupSocialAccount) return errorResponse('Social account setup is not available in this context.');
  try {
    return successResponse(JSON.stringify(await ctx.setupSocialAccount(parsed.data), null, 2));
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Social account setup failed.');
  }
}
