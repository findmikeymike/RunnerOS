import type { SessionToolContext } from './context.ts';

export type ResultLinkTarget = 'agent' | 'skill' | 'workflow' | 'automation' | 'work';

/** Desktop compound routes, scoped to the canonical identity supplied by the host. */
export function buildSessionResultLink(
  ctx: Pick<SessionToolContext, 'workspaceId'>,
  target: ResultLinkTarget,
  id?: string,
  variant = process.env.CRAFT_PRODUCT_VARIANT,
): string | undefined {
  const workspaceId = ctx.workspaceId;
  // Desktop URL parsing preserves path components, so reject ambiguous separators.
  if (typeof workspaceId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(workspaceId)) return undefined;
  if (target !== 'work' && (typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id))) return undefined;
  const route = target === 'agent' ? `agents/agent/${id}`
    : target === 'skill' ? `skills/skill/${id}`
    : target === 'workflow' ? `workflows/${id}`
    : target === 'automation' ? `automations/automation/${id}` : 'automations';
  return `${variant === 'artist-os' ? 'artistos' : 'craftagents'}://workspace/${workspaceId}/${route}`;
}

export function sessionResultLinkText(ctx: Pick<SessionToolContext, 'workspaceId'>, target: ResultLinkTarget, id?: string): string {
  const url = buildSessionResultLink(ctx, target, id);
  const label = target === 'work' ? 'Open Active work' : `Open ${target}`;
  return url ? ` [${label}](${url})` : '';
}
