import { beforeAll, describe, expect, it } from 'bun:test';

let omniRouteWantsRetry: typeof import('../unified-network-interceptor.ts').omniRouteWantsRetry;
let isReplayableRequestBody: typeof import('../unified-network-interceptor.ts').isReplayableRequestBody;

function reply(status: number, headers: Record<string, string> = {}) {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => lower.get(name.toLowerCase()) ?? null },
  };
}

describe('honouring the gateway when it asks to retry', () => {
  beforeAll(async () => {
    process.env.CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL = '1';
    ({ omniRouteWantsRetry, isReplayableRequestBody } = await import('../unified-network-interceptor.ts'));
  });

  it('retries when the gateway says the failure was transient', () => {
    // The exact header OmniRoute returns alongside a closed upstream socket.
    expect(omniRouteWantsRetry(reply(502, { 'x-omniroute-recovery-action': 'retry' }))).toBe(true);
  });

  it('reads the header case-insensitively and ignores surrounding space', () => {
    expect(omniRouteWantsRetry(reply(502, { 'X-OmniRoute-Recovery-Action': ' Retry ' }))).toBe(true);
  });

  it('never retries a request that succeeded', () => {
    // A hint on a 200 is information, not an instruction to send it twice.
    expect(omniRouteWantsRetry(reply(200, { 'x-omniroute-recovery-action': 'retry' }))).toBe(false);
  });

  it('leaves failures the gateway did not flag alone', () => {
    expect(omniRouteWantsRetry(reply(500))).toBe(false);
    expect(omniRouteWantsRetry(reply(429))).toBe(false);
    expect(omniRouteWantsRetry(reply(401, { 'x-omniroute-recovery-action': 'reauthenticate' }))).toBe(false);
  });

  it('does not touch traffic from any other provider', () => {
    expect(omniRouteWantsRetry(reply(502, { 'retry-after': '1' }))).toBe(false);
  });
});

describe('deciding whether a request can be sent again', () => {
  beforeAll(async () => {
    process.env.CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL = '1';
    ({ isReplayableRequestBody } = await import('../unified-network-interceptor.ts'));
  });

  it('a serialized body can be sent again', () => {
    expect(isReplayableRequestBody('{"model":"auto/best-free"}')).toBe(true);
    expect(isReplayableRequestBody(undefined)).toBe(true);
    expect(isReplayableRequestBody(null)).toBe(true);
  });

  it('a stream cannot — the first attempt already drained it', () => {
    // Replaying one of these sends an empty or truncated request, which is a
    // worse outcome than the error being retried.
    expect(isReplayableRequestBody(new ReadableStream())).toBe(false);
    expect(isReplayableRequestBody(new Uint8Array([1, 2, 3]))).toBe(false);
    expect(isReplayableRequestBody(new FormData())).toBe(false);
  });
});

describe('the retry loop itself', () => {
  let sendHonouringOmniRouteRetry: typeof import('../unified-network-interceptor.ts').sendHonouringOmniRouteRetry;

  beforeAll(async () => {
    process.env.CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL = '1';
    ({ sendHonouringOmniRouteRetry } = await import('../unified-network-interceptor.ts'));
  });

  const noSleep = async () => {};
  /** `replies` are consumed in order; the last one repeats. */
  function sender(replies: Array<{ status: number; retry?: boolean }>) {
    let calls = 0;
    const send = async () => {
      const spec = replies[Math.min(calls, replies.length - 1)]!;
      calls += 1;
      return new Response(null, {
        status: spec.status,
        headers: spec.retry ? { 'x-omniroute-recovery-action': 'retry' } : {},
      });
    };
    return { send, attempts: () => calls };
  }

  it('sends once when the first attempt works', async () => {
    const s = sender([{ status: 200 }]);
    expect((await sendHonouringOmniRouteRetry(s.send, true, noSleep)).status).toBe(200);
    expect(s.attempts()).toBe(1);
  });

  it('retries a flagged failure and returns the success', async () => {
    const s = sender([{ status: 502, retry: true }, { status: 200 }]);
    expect((await sendHonouringOmniRouteRetry(s.send, true, noSleep)).status).toBe(200);
    expect(s.attempts()).toBe(2);
  });

  it('gives up after two retries rather than hammering the gateway', async () => {
    const s = sender([{ status: 502, retry: true }]);
    expect((await sendHonouringOmniRouteRetry(s.send, true, noSleep)).status).toBe(502);
    expect(s.attempts()).toBe(3);
  });

  it('does not retry an unflagged failure', async () => {
    const s = sender([{ status: 500 }]);
    expect(s.attempts()).toBe(0);
    await sendHonouringOmniRouteRetry(s.send, true, noSleep);
    expect(s.attempts()).toBe(1);
  });

  it('never resends a request whose body cannot be replayed', async () => {
    // Sending a drained stream twice is worse than surfacing the error.
    const s = sender([{ status: 502, retry: true }]);
    expect((await sendHonouringOmniRouteRetry(s.send, false, noSleep)).status).toBe(502);
    expect(s.attempts()).toBe(1);
  });
});
