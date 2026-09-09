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
    return deps.openHost({ runnerOptions, resolvePrincipal });
  };
}

/** Prepared entry point; Electron bootstrap does not invoke it yet. */
export const startElectronDurableWorkflowHost = createDurableWorkflowStartup();
