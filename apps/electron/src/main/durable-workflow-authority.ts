import { createDurableWorkflowAuthority } from '@craft-agent/server-core/workflows/durable-workflow-authority';
import type { WsRpcServer } from '@craft-agent/server-core/transport';

interface LocalAuthorityOptions {
  installationId: string;
  server: Pick<WsRpcServer, 'isAuthenticatedClientConnected'>;
  /** Read current binding policy; shared-server clients must not inherit local ownership. */
  getBinding: () => { host: string; serverModeEnabled: boolean };
  getWorkspaces: () => ReadonlyArray<{ id: string }>;
}

/** Single-owner desktop profile only; installation identity is an identifier, not a credential. */
export function createLocalDurableWorkflowAuthority(options: LocalAuthorityOptions) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(options.installationId)) {
    throw new Error('durable-local-installation-required');
  }
  const principal = `desktop-owner:${options.installationId.toLowerCase()}`;
  return createDurableWorkflowAuthority({
    getAuthenticatedPrincipal(clientId) {
      const binding = options.getBinding();
      if (binding.serverModeEnabled || !['127.0.0.1', '::1', '[::1]'].includes(binding.host)) return null;
      return options.server.isAuthenticatedClientConnected(clientId) ? principal : null;
    },
    canAccessWorkspace: (candidate, workspaceId) => candidate === principal && options.getWorkspaces().some(workspace => workspace.id === workspaceId),
  });
}

/** Called later by startup wiring; does not create or activate a workflow host. */
export async function createElectronDurableWorkflowAuthority(options: Omit<LocalAuthorityOptions, 'installationId' | 'getWorkspaces'>) {
  const [{ ElectronInstallationIdentityStore }, { getWorkspaces }] = await Promise.all([
    import('./licensing/protected-store'), import('@craft-agent/shared/config'),
  ]);
  const installationId = await new ElectronInstallationIdentityStore().getOrCreate();
  return createLocalDurableWorkflowAuthority({ ...options, installationId, getWorkspaces });
}
