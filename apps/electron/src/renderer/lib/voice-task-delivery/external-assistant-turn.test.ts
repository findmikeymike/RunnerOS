import { test, expect } from 'bun:test';
import { playbackHarness } from './playback-harness';
const input = { origin: 'worker-result' as const, turnId: 'delivery-1', text: 'Your teaser draft is saved.' };
const fixture = () => playbackHarness(process.env.VOICE_TASK_SDK_TEST_ROOT);
async function ready(h: Awaited<ReturnType<typeof playbackHarness>>) {
  expect(h.runtime.externalAssistantTurn(input).status).toBe('deferred'); await h.advance(700);
  const offer = h.runtime.externalAssistantTurn(input); expect(offer.status).toBe('accepted');
  if (offer.status !== 'accepted') throw new Error('not accepted'); await h.settle(); return offer.delivery;
}
async function finishAudio(h: Awaited<ReturnType<typeof playbackHarness>>) {
  for (let i = 0; i < 8; i++) { await h.drain(); await h.consume(120); }
}
test('production wrapper consumes correlated PCM and visemes before committing assistant-only history', async () => {
  const h = await fixture();
  try {
    const d = await ready(h); let outcome: string | undefined; d.done.then((value: string) => outcome = value); await h.drain();
    expect(outcome).toBeUndefined(); expect(JSON.parse(await h.runtime.getContextJson())).toEqual([]);
    expect(h.spoken).toEqual([input.text]); expect(h.commands).not.toContain('completeUserTranscript');
    await finishAudio(h); expect(await d.done).toBe('delivered');
    const context = JSON.parse(await h.runtime.getContextJson()); expect(context).toHaveLength(1); expect(context[0].role).toBe('assistant');
    expect(h.events.some(e => e.type === 'userSpeechComplete')).toBe(false);
    expect(h.frames.some(f => f.visemes?.some((v: any) => v.symbol === 'PP' && v.weight > 0))).toBe(true);
    expect(h.frames.some(f => f.visemes?.some((v: any) => v.symbol === 'O' && v.weight > 0))).toBe(true);
    expect(h.runtime.getSdkCapabilities().externalAssistantTurns).toBe(true);
  } finally { await h.close(); }
});
test('busy foreground generation, queued playback and false silence defer without aborting ordinary speech', async () => {
  const h = await fixture();
  try {
    let release!: () => void; const wait = new Promise<void>(r => release = r);
    h.runtime.transports.llm.generateReply = async () => (async function* () { await wait; yield { text: 'The unrelated answer remains intact.', done: true }; })();
    const normal = h.runtime.completeUserTranscript('Tell me about rhythm.'); await h.settle();
    expect(h.runtime.externalAssistantTurn(input).status).toBe('deferred'); release(); await normal; await h.drain();
    expect(h.runtime.externalAssistantTurn(input).status).toBe('deferred');
    await h.runtime.handleOutputPlaybackState(false); expect(h.runtime.externalAssistantTurn(input).status).toBe('deferred');
    await finishAudio(h); expect(h.spoken).toEqual(['The unrelated answer remains intact.']);
    const d = await ready(h); await finishAudio(h); expect(await d.done).toBe('delivered');
    expect(h.commands.filter(c => c === 'completeUserTranscript')).toHaveLength(1);
  } finally { await h.close(); }
});
test('barge-in clears real queued PCM/visemes and never commits interrupted event text', async () => {
  const h = await fixture();
  try {
    const d = await ready(h); await h.drain(); await h.consume(10); h.runtime.executeLocalBargeIn(); await h.settle();
    expect(await d.done).toBe('interrupted'); expect(h.outputs[0].processor.queuedSamples).toBe(0);
    expect(h.frames.at(-1).visemes).toEqual([]); expect(JSON.parse(await h.runtime.getContextJson())).toEqual([]);
  } finally { await h.close(); }
});
test('cancelled handle cannot clear a later generation or accept late provider PCM', async () => {
  const h = await fixture();
  try {
    let release!: () => void; const wait = new Promise<void>(r => release = r); const original = h.runtime.transports.tts;
    h.runtime.transports.tts = { synthesize: async () => (async function* () { await wait; yield { frames: new Float32Array(9600).fill(.5), sampleRate: 48000, channels: 1 }; })() };
    const d = await ready(h); d.cancel(); await h.settle(); expect(await d.done).toBe('interrupted'); release(); await h.settle();
    expect(h.commands.filter(c => c === 'pushTtsAudio')).toHaveLength(0); h.runtime.transports.tts = original;
    const next = await ready(h); d.cancel(); await finishAudio(h); expect(await next.done).toBe('delivered');
  } finally { await h.close(); }
});
test('user activity resets the exact 700ms eligibility window', async () => {
  const h = await fixture();
  try {
    expect(h.runtime.externalAssistantTurn(input).status).toBe('deferred'); await h.advance(699);
    h.runtime.userSpeechActive = true; h.runtime.emit({ type: 'userSpeechStarted' });
    h.runtime.userSpeechActive = false; expect(h.runtime.getExternalAssistantTurnStatus().idleForMs).toBe(0); await h.advance(699);
    expect(h.runtime.externalAssistantTurn(input).status).toBe('deferred'); await h.advance(1);
    const offer = h.runtime.externalAssistantTurn(input); expect(offer.status).toBe('accepted'); offer.delivery.cancel(); await h.settle();
    expect(await offer.delivery.done).toBe('interrupted');
  } finally { await h.close(); }
});
test('wrong and stale flush acknowledgements cannot consume current delivery', async () => {
  const h = await fixture();
  try {
    const d = await ready(h); await h.drain(); let outcome: string | undefined; d.done.then((value: string) => outcome = value);
    h.outputs[0].port.onmessage({ data: { type: 'outputFlushed', requestId: -1 } }); await h.settle();
    expect(outcome).toBeUndefined(); expect(JSON.parse(await h.runtime.getContextJson())).toEqual([]);
    await finishAudio(h); expect(await d.done).toBe('delivered');
  } finally { await h.close(); }
});
for (const failure of ['throw', 'empty', 'stall'] as const) test(`provider ${failure} fails bounded delivery and leaves history uncommitted`, async () => {
  const h = await fixture();
  try {
    h.runtime.transports.tts = { synthesize: async () => {
      if (failure === 'throw') throw new Error('fixture failure');
      if (failure === 'stall') await new Promise(() => {});
      return (async function* () {})();
    } };
    const d = await ready(h); if (failure === 'stall') await h.advance(45_000); await h.settle();
    expect(await d.done).toBe('failed'); expect(JSON.parse(await h.runtime.getContextJson())).toEqual([]);
    expect(h.outputs[0].processor.queuedSamples).toBe(0);
  } finally { await h.close(); }
});
test('observer exceptions cannot fail delivery; synchronous observer cancellation cannot restart audio', async () => {
  const h = await fixture();
  try {
    const off = h.runtime.onEvent(() => { throw new Error('observer exception'); });
    const d = await ready(h); await finishAudio(h); expect(await d.done).toBe('delivered'); off();
    let interruptedAt = -1;
    h.runtime.onEvent((event: any) => { if (event.type === 'assistantAudioStart') { h.runtime.executeLocalBargeIn(); interruptedAt = h.events.length; } });
    const interrupted = await ready(h); await h.settle(); expect(await interrupted.done).toBe('interrupted');
    expect(h.outputs[0].processor.queuedSamples).toBe(0);
    expect(JSON.parse(await h.runtime.getContextJson())).toHaveLength(1);
    expect(interruptedAt).toBeGreaterThan(-1);
    expect(h.events.slice(interruptedAt).some(e => e.type === 'agentSpeechStarted')).toBe(false);
  } finally { await h.close(); }
});
test('real runtime stop resolves handle and disables admission with no pending worker requests', async () => {
  const h = await fixture();
  try {
    const d = await ready(h); await h.drain(); await h.runtime.stop(); await h.settle();
    expect(await d.done).toBe('interrupted'); expect(h.runtime.externalAssistantTurn(input).status).toBe('unsupported');
    expect(h.runtime.runtimeWorker.pendingRequests.size).toBe(0); expect(h.outputs[0].port.onmessage).toBeNull();
  } finally { await h.close(); }
});
