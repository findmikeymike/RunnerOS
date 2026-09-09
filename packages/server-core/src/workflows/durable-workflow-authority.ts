import type { DurableWorkflowActor } from './durable-workflow-controls.ts';

export interface DurableWorkflowAuthorityOptions {
  /** Host authentication record, never handshake fields or renderer-supplied identity. */
  getAuthenticatedPrincipal: (clientId: string) => string | null;
  /** Read current host-owned workspace membership, including workspace existence. */
  canAccessWorkspace: (principalId: string, workspaceId: string) => boolean;
}

/** Synchronous current-access check. Stable principals come from the host, not connection IDs. */
export function createDurableWorkflowAuthority(options: DurableWorkflowAuthorityOptions) {
  return (workspaceId: string, actor: DurableWorkflowActor): string => {
    if (typeof workspaceId !== 'string' || !workspaceId.trim() || !actor ||
      typeof actor.clientId !== 'string' || !actor.clientId.trim() ||
      actor.workspaceId !== undefined && actor.workspaceId !== workspaceId) {
      throw new Error('durable-authority-workspace-mismatch');
    }
    const principal = options.getAuthenticatedPrincipal(actor.clientId);
    if (typeof principal !== 'string' || !principal.trim()) throw new Error('durable-authority-unauthenticated');
    if (options.canAccessWorkspace(principal, workspaceId) !== true) throw new Error('durable-authority-access-denied');
    return principal;
  };
}
