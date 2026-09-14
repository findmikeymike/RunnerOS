import { z } from 'zod';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse, successResponse } from '../response.ts';

/** Credentials are deliberately absent: create/reauth opens the existing secure wizard. */
export const setupLlmConnectionSchema = z.object({
  action: z.enum(['list', 'open', 'test', 'set-default']),
  slug: z.string().min(1).max(120).optional(),
  provider: z.enum(['claude', 'chatgpt', 'copilot', 'api_key', 'local']).optional(),
  scope: z.enum(['app', 'workspace']).optional(),
}).strict();
const validatedInput = setupLlmConnectionSchema.superRefine((input, ctx) => {
  if ((input.action === 'test' || input.action === 'set-default') && !input.slug) {
    ctx.addIssue({ code: 'custom', message: 'A saved connection slug is required.', path: ['slug'] });
  }
  if (input.action === 'set-default' && !input.scope) {
    ctx.addIssue({ code: 'custom', message: 'Choose app or workspace scope explicitly.', path: ['scope'] });
  }
});
export type SetupLlmConnectionInput = z.infer<typeof setupLlmConnectionSchema>;

export async function handleSetupLlmConnection(ctx: SessionToolContext, input: SetupLlmConnectionInput): Promise<ToolResult> {
  const parsed = validatedInput.safeParse(input);
  if (!parsed.success) return errorResponse(parsed.error.issues.map(issue => issue.message).join(' '));
  if (!ctx.setupLlmConnection) return errorResponse('LLM connection setup is not available in this context.');
  try {
    return successResponse(JSON.stringify(await ctx.setupLlmConnection(parsed.data), null, 2));
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'LLM connection setup failed.');
  }
}
