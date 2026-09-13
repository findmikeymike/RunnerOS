import { test, expect } from 'bun:test';
import { playbackHarness } from './playback-harness';
import { attachEventTurnProof } from './event-turn-proof';
const input = { origin: 'worker-result' as const, turnId: 'delivery-1', text: 'Your teaser draft is saved.' };
async function ready(h: Awaited<ReturnType<typeof playbackHarness>>, bridge: ReturnType<typeof attachEventTurnProof>) {
  expect(bridge.offer(input).status).toBe('deferred'); await h.advance(700);
  const offer = bridge.offer(input); expect(offer.status).toBe('accepted');
  if (offer.status !== 'accepted') throw new Error('not accepted');
  await h.settle(); return offer.delivery;
}
async function finishAudio(h: Awaited<ReturnType<typeof playbackHarness>>) {
  for (let i = 0; i < 8; i++) { await h.drain(); await h.consume(120); }
}
test('actual wrapper/WASM/worklet consumes event audio before committing assistant-only history', async () => {
  const h = await playbackHarness(); const bridge = attachEventTurnProof(h.runtime, h.now);
  try {
    const d = await ready(h, bridge); await h.drain();
    expect(d.state).toBe('playing'); expect(JSON.parse(await h.runtime.getContextJson())).toEqual([]);
    expect(h.spoken).toEqual([input.text]); expect(h.commands).not.toContain('completeUserTranscript');
    await finishAudio(h); expect(await d.done).toBe('delivered');
    const context = JSON.parse(await h.runtime.getContextJson()); expect(context).toHaveLength(1); expect(context[0].role).toBe('assistant');
    expect(h.events.some(e => e.type === 'userSpeechComplete')).toBe(false);
    expect(h.frames.some(f => f.active)).toBe(true);
    expect(h.frames.some(f => f.visemes?.some((v: any) => v.symbol === 'PP' && v.weight > 0))).toBe(true);
    expect(h.frames.some(f => f.visemes?.some((v: any) => v.symbol === 'O' && v.weight > 0))).toBe(true);
  } finally { bridge.detach(); await h.close(); }
});
test('generation, queued PCM and a silent gap all defer external speech; normal response is preserved', async () => {
  const h = await playbackHarness(); const bridge = attachEventTurnProof(h.runtime, h.now);
  try {
    let release!: () => void; const wait = new Promise<void>(r => release = r);
    h.runtime.transports.llm.generateReply = async () => (async function* () { await wait; yield { text: 'The unrelated answer remains intact.', done: true }; })();
    const normal = h.runtime.completeUserTranscript('Tell me about rhythm.'); await h.settle();
    expect(bridge.offer(input).status).toBe('deferred');
    release(); await normal; await h.drain(); expect(bridge.offer(input).status).toBe('deferred');
    // An inactive/RMS-zero edge is not a consumed final flush.
    await h.runtime.handleOutputPlaybackState(false); expect(bridge.offer(input).status).toBe('deferred');
    await finishAudio(h); expect(h.spoken).toEqual(['The unrelated answer remains intact.']);
    const d = await ready(h, bridge); await finishAudio(h); expect(await d.done).toBe('delivered');
    expect(h.commands.filter(c => c === 'completeUserTranscript')).toHaveLength(1);
  } finally { bridge.detach(); await h.close(); }
});
test('barge-in cancels queued event PCM and visemes; interrupted text is not heard history', async () => {
  const h = await playbackHarness(); const bridge = attachEventTurnProof(h.runtime, h.now);
  try {
    const d = await ready(h, bridge); await h.drain(); await h.consume(10);
    h.runtime.executeLocalBargeIn(); await h.settle(); expect(await d.done).toBe('interrupted');
    expect(h.outputs[0].processor.queuedSamples).toBe(0);
    expect(h.frames.at(-1).visemes).toEqual([]);
    expect(JSON.parse(await h.runtime.getContextJson())).toEqual([]);
    await finishAudio(h); expect(d.state).toBe('interrupted');
  } finally { bridge.detach(); await h.close(); }
});
test('late provider completion cannot restart interrupted generation', async () => {
  const h = await playbackHarness(); const bridge = attachEventTurnProof(h.runtime, h.now);
  try {
    let release!: () => void; const wait = new Promise<void>(r => release = r);
    h.runtime.transports.tts.synthesize = async () => (async function* () { await wait; yield { frames: new Float32Array(9600).fill(.5), sampleRate: 48000, channels: 1 }; })();
    const d = await ready(h, bridge); h.runtime.executeLocalBargeIn(); await h.settle(); release(); await h.settle();
    await h.drain(); expect(await d.done).toBe('interrupted'); expect(h.commands.filter(c => c === 'pushTtsAudio')).toHaveLength(0);
  } finally { bridge.detach(); await h.close(); }
});
test('new user speech resets quiet window; detach removes handlers and disables future event turns', async () => {
  const h = await playbackHarness(); const bridge = attachEventTurnProof(h.runtime, h.now);
  try {
    expect(bridge.offer(input).status).toBe('deferred'); await h.advance(699);
    h.runtime.userSpeechActive = true; expect(bridge.offer(input).status).toBe('deferred');
    h.runtime.userSpeechActive = false; expect(bridge.offer(input).status).toBe('deferred'); await h.advance(699);
    expect(bridge.offer(input).status).toBe('deferred'); await h.advance(1);
    const offer = bridge.offer(input); expect(offer.status).toBe('accepted');
    const handlers = h.runtime.handlers.size; bridge.detach(); expect(h.runtime.handlers.size).toBe(handlers - 1);
    expect(bridge.offer(input).status).toBe('unsupported'); await h.settle();
    if (offer.status === 'accepted') expect(await offer.delivery.done).toBe('interrupted');
  } finally { bridge.detach(); await h.close(); }
});

test('stale output flush acknowledgement cannot finish a newer delivery', async () => {
  const h = await playbackHarness(); const bridge = attachEventTurnProof(h.runtime, h.now);
  try {
    const d = await ready(h, bridge); await h.drain();
    h.outputs[0].port.onmessage({ data: { type: 'outputFlushed', requestId: -1 } }); await h.settle();
    expect(d.state).toBe('playing'); expect(JSON.parse(await h.runtime.getContextJson())).toEqual([]);
    await finishAudio(h); expect(await d.done).toBe('delivered');
  } finally { bridge.detach(); await h.close(); }
});
test('failed TTS is failed delivery with no committed history', async () => {
  const h = await playbackHarness(); const bridge = attachEventTurnProof(h.runtime, h.now);
  try {
    h.runtime.transports.tts.synthesize = async () => { throw new Error('fixture provider failure'); };
    const d = await ready(h, bridge); await h.settle(); expect(await d.done).toBe('failed');
    expect(JSON.parse(await h.runtime.getContextJson())).toEqual([]); expect(h.outputs[0].processor.queuedSamples).toBe(0);
  } finally { bridge.detach(); await h.close(); }
});
test('real runtime stop detaches audio ports and prevents future delivery', async () => {
  const h = await playbackHarness(); const bridge = attachEventTurnProof(h.runtime, h.now);
  try {
    const d = await ready(h, bridge); await h.drain(); await h.runtime.stop(); await h.settle();
    expect(await d.done).toBe('interrupted'); expect(h.outputs[0].port.onmessage).toBeNull();
    expect(bridge.offer(input).status).toBe('deferred'); expect(h.runtime.runtimeWorker.pendingRequests.size).toBe(0);
  } finally { bridge.detach(); await h.close(); }
});

test('empty successful TTS cannot leave a playing delivery or claim it was heard', async () => {
  const h = await playbackHarness(); const bridge = attachEventTurnProof(h.runtime, h.now);
  try {
    h.runtime.transports.tts.synthesize = async () => (async function* () {})();
    const d = await ready(h, bridge); await h.settle(); expect(await d.done).toBe('failed');
    expect(JSON.parse(await h.runtime.getContextJson())).toEqual([]);
    expect(bridge.offer(input).status).toBe('deferred');
    await h.advance(700); expect(bridge.offer(input).status).toBe('accepted'); await h.settle();
  } finally { bridge.detach(); await h.close(); }
});
