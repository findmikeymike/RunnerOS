import { createDurableReadAuthorization, readDurablePolicyRevision } from '@craft-agent/server-core/workflows/durable-read-authorization';
import { RUNTIME_IDENTITY } from '@craft-agent/shared/config/runtime-identity';
import type { DurableWorkflowHostOptions } from '@craft-agent/server-core/workflows/durable-workflow-host';
import { createElectronDurableWorkflowAuthority } from './durable-workflow-authority';
import { openElectronDurableWorkflowHost } from './durable-workflow-storage';

type AuthorityOptions = Parameters<typeof createElectronDurableWorkflowAuthority>[0];
export interface DurableWorkflowStartupOptions extends AuthorityOptions {
  /** Host-owned opt-in only; omission keeps identity and journal storage untouched. */
  enabled?: boolean;
  runnerOptions: DurableWorkflowHostOptions['runnerOptions'];
}

/** Injectable seams keep tests off the real keychain and profile. Production uses the existing factories. */
export function createDurableWorkflowStartup(deps = {
  createAuthority: createElectronDurableWorkflowAuthority,
  openHost: openElectronDurableWorkflowHost,
}) {
  return async (options: DurableWorkflowStartupOptions) => {
    if (options.enabled !== true) return undefined;
    const { server, getBinding, runnerOptions } = options;
    const assertLocal = () => {
      const binding = getBinding();
      if (binding.serverModeEnabled || !['127.0.0.1', '::1', '[::1]'].includes(binding.host)) {
        throw new Error('durable-local-startup-required');
      }
    };
    assertLocal();
    const resolvePrincipal = await deps.createAuthority({ server, getBinding });
    // Identity loading is asynchronous; policy may have changed while it waited.
    assertLocal();
    return deps.openHost({ runnerOptions: { ...runnerOptions, readPolicyRevision: workspaceRoot => readDurablePolicyRevision(RUNTIME_IDENTITY.dataRoot, workspaceRoot), authorizeRun: context => resolvePrincipal.assertRunPrincipal(context.workspaceId, context.approvalPrincipalId), authorizeTool: createDurableReadAuthorization({
      configRoot: RUNTIME_IDENTITY.dataRoot, resolveBinding: runnerOptions.resolveBinding,
      assertRunPrincipal: resolvePrincipal.assertRunPrincipal,
    }) }, resolvePrincipal });
  };
}

/** Electron invokes this only behind the host-owned CRAFT_DURABLE_READ_HOST=1 opt-in. */
export const startElectronDurableWorkflowHost = createDurableWorkflowStartup();
