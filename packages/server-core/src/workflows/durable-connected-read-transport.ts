import { lookup } from 'node:dns/promises';
import { request, type RequestOptions } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { isPublicDurableWebIpv4 } from '../../../shared/src/durable-execution/public-ipv4';
import { isDurableWebReadUrls } from '../../../shared/src/protocol/durable-execution';
import { createDurableConnectedReadBindingResolver, type DurableConnectedReadBinding } from './durable-connected-read-binding';

export type ConnectedReadFailure = 'not-authorized' | 'binding-unavailable' | 'destination-unavailable'
  | 'cancelled' | 'timeout' | 'redirect' | 'http' | 'unsupported-response' | 'too-large' | 'invalid-json';
export type ConnectedReadResult = { ok: true; data: unknown } | { ok: false; reason: ConnectedReadFailure; status?: number };
export interface ConnectedReadTransportDependencies {
  lookup(hostname: string): Promise<{ address: string; family: number }>;
  request(url: URL, options: RequestOptions, receive: (response: IncomingMessage) => void): ClientRequest;
  binding: Pick<ReturnType<typeof createDurableConnectedReadBindingResolver>, 'withCurrentCredential'>;
  timeoutMs: number;
}
const defaults: ConnectedReadTransportDependencies = {
  lookup: hostname => lookup(hostname, { family: 4 }),
  request, binding: createDurableConnectedReadBindingResolver(), timeoutMs: 15_000,
};
const MAX_BYTES = 512 * 1024;

/**
 * Host-only GET transport, not a model tool. Caller must certify endpoint read
 * semantics and apply EXISTING policy. isAuthorized is a synchronous, noninteractive
 * final policy/fence check; this adapter creates no approvals, retries or prompts.
 * A successful body is untrusted private source data, never instructions.
 */
export function createDurableConnectedReadTransport(deps: ConnectedReadTransportDependencies = defaults) {
  return async (binding: DurableConnectedReadBinding, url: string, isAuthorized: () => boolean, signal?: AbortSignal): Promise<ConnectedReadResult> => {
    let pinned: DurableConnectedReadBinding;
    try {
      pinned = structuredClone(binding);
      if (!isDurableWebReadUrls(pinned.urls) || !pinned.urls.includes(url)) return { ok: false, reason: 'not-authorized' };
    } catch { return { ok: false, reason: 'not-authorized' }; }
    return new Promise(resolve => {
      let settled = false;
      let req: ClientRequest | undefined;
      let response: IncomingMessage | undefined;
      const finish = (result: ConnectedReadResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        resolve(result);
        response?.destroy(); req?.destroy();
      };
      const fail = (reason: ConnectedReadFailure, status?: number) => finish({ ok: false, reason, ...(status === undefined ? {} : { status }) });
      const abort = () => fail('cancelled');
      const timer = setTimeout(() => fail('timeout'), deps.timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      const allowed = () => {
        try { return isAuthorized() === true; } catch { return false; }
      };
      const perform = async () => {
        if (!allowed()) { fail('not-authorized'); return; }
        const target = new URL(url);
        const address = await deps.lookup(target.hostname);
        if (settled) return;
        if (address.family !== 4 || !isPublicDurableWebIpv4(address.address)) { fail('destination-unavailable'); return; }
        try {
          await deps.binding.withCurrentCredential(pinned, token => {
            // No await between current account/policy checks and native dispatch.
            if (settled) return;
            if (!allowed()) { fail('not-authorized'); return; }
            req = deps.request(target, {
              method: 'GET', agent: false, family: 4, rejectUnauthorized: true,
              servername: isIP(target.hostname) ? undefined : target.hostname,
              headers: { Accept: 'application/json', 'Accept-Encoding': 'identity', Authorization: `Bearer ${token}` },
              lookup: (_hostname, options, callback) => {
                if (options.all) callback(null, [{ address: address.address, family: 4 }]);
                else callback(null, address.address, 4);
              },
            }, incoming => {
              response = incoming;
              incoming.on('error', () => fail('destination-unavailable'));
              incoming.on('aborted', () => fail('destination-unavailable'));
              if (settled) { incoming.destroy(); return; }
              const status = incoming.statusCode ?? 0;
              if (status >= 300 && status < 400) { fail('redirect'); return; }
              if (status < 200 || status >= 300) { fail('http', status); return; }
              const mime = incoming.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
              const encoding = incoming.headers['content-encoding'];
              if (mime !== 'application/json' || encoding && encoding.toLowerCase() !== 'identity') { fail('unsupported-response'); return; }
              if (Number(incoming.headers['content-length']) > MAX_BYTES) { fail('too-large'); return; }
              const chunks: Buffer[] = []; let bytes = 0;
              incoming.on('data', (chunk: Buffer) => {
                if (settled) return;
                const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                bytes += data.length;
                if (bytes > MAX_BYTES) { fail('too-large'); return; }
                chunks.push(data);
              });
              incoming.on('end', () => {
                if (settled) return;
                try {
                  const body = Buffer.concat(chunks).toString('utf8');
                  // Never allow an upstream echo of the transport secret into saved tool output.
                  const data: unknown = JSON.parse(body);
                  if (JSON.stringify(data).includes(token)) { fail('unsupported-response'); return; }
                  finish({ ok: true, data });
                } catch { fail('invalid-json'); }
              });
            });
            req.on('error', () => fail('destination-unavailable'));
            req.end();
          });
        } catch { fail('binding-unavailable'); }
      };
      void perform().catch(() => fail('destination-unavailable'));
    });
  };
}
