import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse } from '../response.ts';

export type SaveSecretTarget = 'env' | 'source' | 'global-source' | 'source-override';

export interface SaveSecretToolInput {
  target: SaveSecretTarget;
  name?: string;
  sourceSlug?: string;
  value: string;
  confirmed?: boolean;
}

export interface SaveSecretResult {
  ok: boolean;
  target?: SaveSecretTarget;
  name?: string;
  sourceSlug?: string;
  error?: string;
}

const ENV_SECRET_RE = /^[A-Z_][A-Z0-9_]*$/;
const SOURCE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const BLOCKED_NAME_HINTS = [
  'PASSWORD',
  'PASSWD',
  'COOKIE',
  'SESSION',
  '2FA',
  'MFA',
  'RECOVERY',
  'PRIVATE_BROWSER',
];

function validateInput(args: SaveSecretToolInput): string | null {
  if (!ctxTargets.has(args.target)) {
    return 'target must be one of: env, source, global-source, source-override.';
  }
  if (args.confirmed !== true) {
    return 'confirmed must be true. Ask the user for explicit permission before saving a credential.';
  }
  if (typeof args.value !== 'string' || args.value.trim().length === 0) {
    return 'value is required.';
  }
  if (args.value.length > 20_000) {
    return 'value is too large to save as a RunnerOS secret.';
  }

  if (args.target === 'env') {
    const name = args.name?.trim().toUpperCase();
    if (!name || !ENV_SECRET_RE.test(name)) {
      return 'name must use ENV_VAR format: uppercase letters, numbers, and underscores.';
    }
    if (BLOCKED_NAME_HINTS.some((hint) => name.includes(hint))) {
      return 'Do not save passwords, cookies, recovery codes, 2FA codes, or browser session secrets.';
    }
    return null;
  }

  if (!args.sourceSlug || !SOURCE_SLUG_RE.test(args.sourceSlug)) {
    return 'sourceSlug is required for source credential targets.';
  }
  return null;
}

const ctxTargets = new Set<SaveSecretTarget>(['env', 'source', 'global-source', 'source-override']);

export async function handleSaveSecret(
  ctx: SessionToolContext,
  args: SaveSecretToolInput,
): Promise<ToolResult> {
  if (!ctx.saveSecret) {
    return errorResponse('save_secret is not available in this context.');
  }

  const validationError = validateInput(args);
  if (validationError) return errorResponse(validationError);

  const input: SaveSecretToolInput = {
    target: args.target,
    name: args.name?.trim().toUpperCase(),
    sourceSlug: args.sourceSlug?.trim(),
    value: args.value.trim(),
    confirmed: true,
  };

  try {
    const result = await ctx.saveSecret(input);
    if (!result.ok) {
      return errorResponse(result.error ?? 'Failed to save credential.');
    }

    const label = result.target === 'env'
      ? result.name
      : `${result.sourceSlug} (${result.target})`;
    return {
      content: [{ type: 'text', text: `Saved credential: ${label}.` }],
      structuredContent: {
        ok: true,
        target: result.target,
        name: result.name,
        sourceSlug: result.sourceSlug,
      },
      isError: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(`Failed to save credential: ${message}`);
  }
}
