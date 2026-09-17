import { canonical } from '../../../shared/src/durable-execution';
import type { DurableJson } from '../../../shared/src/protocol/durable-execution';
import type { DurableOperationIntent } from '../../../shared/src/durable-execution/operation-types';
import { createDurableConnectedReadBindingResolver, type DurableConnectedReadBinding } from './durable-connected-read-binding';
import { createDurableConnectedReadTransport } from './durable-connected-read-transport';
import type { DurableEffectAdapter } from './durable-effect-runner';

const unavailable = () => new Error('durable-connected-read-unavailable');
export interface DurableConnectedReadAdapterOptions {
  /** Trusted host certification of endpoint semantics, never model/user supplied code. */
  isCertifiedRead(url: string): boolean;
  /** Existing noninteractive policy check. This adapter adds no approval UI. */
  isAuthorized(url: string): boolean;
  bindingResolver?: Pick<ReturnType<typeof createDurableConnectedReadBindingResolver>, 'assertCurrent'>;
  transport?: ReturnType<typeof createDurableConnectedReadTransport>;
}

/** Host operation-journal adapter; normal Start/Pi registration is a separate gate. */
export function createDurableConnectedReadAdapter(binding: DurableConnectedReadBinding, options: DurableConnectedReadAdapterOptions): DurableEffectAdapter {
  const pinned = structuredClone(binding);
  const resolver = options.bindingResolver ?? createDurableConnectedReadBindingResolver();
  const transport = options.transport ?? createDurableConnectedReadTransport();
  const inputUrl = (intent: Readonly<DurableOperationIntent>): string => {
    const input = intent.input;
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 2 || !Object.hasOwn(input, 'binding')
      || canonical(input.binding) !== canonical(pinned)
      || typeof input.url !== 'string' || !pinned.urls.includes(input.url)) throw unavailable();
    return input.url;
  };
  const check = (url: string) => {
    if (options.isCertifiedRead(url) !== true || options.isAuthorized(url) !== true) throw unavailable();
  };
  const authorize = async (intent: Readonly<DurableOperationIntent>) => {
    try {
      const url = inputUrl(intent);
      check(url);
      await resolver.assertCurrent(pinned);
      check(url);
    } catch { throw unavailable(); }
  };
  return {
    id: 'connected-api-json-read', version: '1', workspaceId: pinned.workspaceId, effectClass: 'read', credentialIdentity: pinned.credentialIdentity,
    outputSchema: { id: 'connected-api-json-result', version: '1', validate(output) {
      if (!output || typeof output !== 'object' || Array.isArray(output) || output.untrusted !== true
        || typeof output.sourceUrl !== 'string' || !pinned.urls.includes(output.sourceUrl)) return false;
      if (output.ok === true) return Object.keys(output).length === 4 && Object.hasOwn(output, 'data');
      if (output.ok !== false || Object.keys(output).some(key => !['ok', 'reason', 'status', 'sourceUrl', 'untrusted'].includes(key))) return false;
      return typeof output.reason === 'string' && ['not-authorized', 'binding-unavailable', 'destination-unavailable', 'cancelled', 'timeout', 'redirect', 'http', 'unsupported-response', 'too-large', 'invalid-json'].includes(output.reason)
        && (output.status === undefined || Number.isInteger(output.status) && Number(output.status) >= 0 && Number(output.status) <= 599);
    } },
    authorize,
    async invoke(intent, assertDispatch) {
      if (!assertDispatch) throw unavailable();
      const url = inputUrl(intent);
      // Transport repeats source binding checks after DNS. The final callback checks
      // journal ownership/control/deadline as well as the existing policy, without awaits.
      const result = await transport(pinned, url, () => {
        assertDispatch(); check(url); return true;
      });
      // A prevented dispatch has no response to cache. Preserve the same slot for
      // explicit resume/repair rather than permanently replaying a preflight error.
      if (!result.ok && ['not-authorized', 'binding-unavailable'].includes(result.reason)) {
        return { kind: 'not-applied', reason: 'connected-read-dispatch-blocked' };
      }
      // A handled HTTP/tool error is a saved observation, not a successful API response.
      const output = JSON.parse(canonical({ ...result, sourceUrl: url, untrusted: true })) as DurableJson;
      return { kind: 'succeeded', output };
    },
    async reconcile(intent) {
      await authorize(intent);
      // A read changes no remote state. An unsaved response cannot be reconstructed;
      // release it for a separately bounded retry, never issue a GET during reconciliation.
      return { kind: 'not-applied', reason: 'connected-read-result-not-saved' };
    },
  };
}
