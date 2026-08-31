/**
 * AcpSpawnHandler — routes "acp-spawn" automation actions to a remote
 * ACP-compliant agent over stdio JSON-RPC.
 *
 * Ported from Hermes hermes_acp/ (MIT). See THIRD_PARTY_NOTICES.md.
 *
 * Config shape (per matcher):
 *   {
 *     type: "acp-spawn",
 *     acpEndpoint: "stdio:./bin/agent",
 *     prompt: "<task>",
 *     cwd?: string
 *   }
 */

import { createLogger } from '../../utils/debug.ts';
import type { EventBus, BaseEventPayload } from '../event-bus.ts';
import type { AutomationHandler } from './types.ts';
import { delegateToAcpEndpoint, type DelegateToAcpResult } from '../../protocol/acp/spawn-bridge.ts';

const log = createLogger('acp-spawn-handler');
const logWarn = (msg: string): void => log.warn(msg);

export interface AcpSpawnAction {
  type: 'acp-spawn';
  acpEndpoint: string;
  prompt: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface AcpSpawnHandlerOptions {
  workspaceId: string;
  onResult?: (result: DelegateToAcpResult) => void;
  onError?: (action: AcpSpawnAction, error: Error) => void;
}

interface AcpSpawnEventPayload extends BaseEventPayload {
  action: AcpSpawnAction;
}

export class AcpSpawnHandler implements AutomationHandler {
  private bus?: EventBus;
  private listener?: (payload: unknown) => void;
  constructor(private readonly opts: AcpSpawnHandlerOptions) {}

  subscribe(bus: EventBus): void {
    // We register on a synthetic "automation:acp-spawn" event so the
    // automations engine can hand off pre-matched actions.
    this.bus = bus;
    this.listener = (payload: unknown) => {
      void this.handle(payload as AcpSpawnEventPayload);
    };
    (bus.on as unknown as (event: string, fn: (p: unknown) => void) => void)(
      'automation:acp-spawn',
      this.listener,
    );
  }

  dispose(): void {
    if (this.bus && this.listener) {
      const off = (this.bus as unknown as {
        off?: (event: string, fn: (p: unknown) => void) => void;
      }).off;
      off?.call(this.bus, 'automation:acp-spawn', this.listener);
    }
    this.bus = undefined;
    this.listener = undefined;
  }

  /** Direct invocation path used by tests + the automations engine. */
  async handle(payload: AcpSpawnEventPayload): Promise<DelegateToAcpResult | null> {
    const action = payload.action;
    if (!action || action.type !== 'acp-spawn' || !action.acpEndpoint) {
      logWarn('Ignoring invalid acp-spawn payload');
      return null;
    }
    try {
      const result = await delegateToAcpEndpoint({
        endpoint: action.acpEndpoint,
        prompt: action.prompt ?? '',
        cwd: action.cwd ?? process.cwd(),
        timeoutMs: action.timeoutMs,
      });
      this.opts.onResult?.(result);
      return result;
    } catch (err) {
      const e = err as Error;
      logWarn(`acp-spawn failed: ${e.message}`);
      this.opts.onError?.(action, e);
      return null;
    }
  }
}
