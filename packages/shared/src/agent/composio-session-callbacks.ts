import type { ComposioEmailInput, ComposioReadInput, ComposioSearchInput, ComposioToolResult } from '@craft-agent/session-tools-core';
import type { SessionScopedToolCallbacks } from './session-scoped-tool-callback-registry.ts';
import { deriveSessionToolFilterOptions } from './session-tool-filter-options.ts';

interface Dependencies {
  actor(): { agentSlug?: string; scope?: string; variant: string };
  /** Must check current access to the global connection on every call. */
  authorize(): void | Promise<void>;
  service: {
    refresh(): Promise<unknown>;
    execute(operation: 'search' | 'read' | 'draft' | 'send', input: ComposioSearchInput | ComposioReadInput | ComposioEmailInput): Promise<ComposioToolResult>;
  };
}
/** Host-side checks remain mandatory even if a caller forges a hidden tool call. */
export function createComposioSessionCallbacks(deps: Dependencies): Pick<SessionScopedToolCallbacks,
  'composioStatusFn' | 'composioGmailSearchFn' | 'composioGmailReadFn' | 'composioGmailDraftFn' | 'composioGmailSendFn'> {
  async function checked<T>(run: () => Promise<T>): Promise<T> {
    const actor = deps.actor();
    if (!deriveSessionToolFilterOptions(actor.agentSlug, actor.scope, actor.variant).includeComposioTools) {
      throw new Error('Composio Gmail is unavailable to this role or workspace.');
    }
    await deps.authorize();
    return run();
  }
  return {
    composioStatusFn: async () => checked(() => deps.service.refresh()),
    composioGmailSearchFn: input => checked(() => deps.service.execute('search', input)),
    composioGmailReadFn: input => checked(() => deps.service.execute('read', input)),
    composioGmailDraftFn: input => checked(() => deps.service.execute('draft', input)),
    composioGmailSendFn: input => checked(() => deps.service.execute('send', input)),
  };
}
