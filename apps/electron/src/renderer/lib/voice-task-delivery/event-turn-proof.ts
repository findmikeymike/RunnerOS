/** Experimental wrapper extension only; never imported by app production code. */
export function attachEventTurnProof(runtime: any, now: () => number) {
  type Delivery = { turnId: string; origin: 'worker-result'; generation: number; epoch: number; text: string;
    sawAudio: boolean; state: 'generating' | 'playing' | 'delivered' | 'interrupted' | 'failed'; done: Promise<string>; resolve: (outcome: string) => void };
  let current: Delivery | undefined, idleSince: number | undefined, detached = false;
  const originalFlush = runtime.audioGraph.outputFlushedHandler;
  const busy = () => !runtime.running || runtime.userSpeechActive || runtime.responseAbortController !== null
    || runtime.drainingAudio || runtime.outputPlaybackActive || runtime.audioGraph.pendingOutputFlush !== null
    || !['idle', 'listening'].includes(runtime.state);
  const valid = (d: Delivery) => current === d && !detached && runtime.running && d.generation === runtime.responseGeneration && d.epoch === runtime.audioGraph.getPlaybackEpoch();
  const finish = (d: Delivery, state: Delivery['state']) => { d.state = state; d.resolve(state); if (current === d) current = undefined; idleSince = undefined; };
  const unsubscribe = runtime.onEvent((event: any) => {
    if (current && valid(current) && event.type === 'assistantAudioStart') current.sawAudio = true;
    if (current && (!valid(current) || ['bargeIn', 'userSpeechPartial', 'userSpeechComplete'].includes(event.type))) finish(current, 'interrupted');
    if (busy()) idleSince = undefined;
  });
  runtime.audioGraph.setOutputFlushedHandler(() => {
    const d = current;
    originalFlush?.(); // actual runtime-worker completion command/event path
    if (!d || !valid(d) || d.state !== 'playing') return;
    // The AudioGraph accepted its exact pending flush ID after real worklet consumption.
    void (async () => {
      await runtime.pushAssistantText(d.text, true);
      if (valid(d)) finish(d, 'delivered');
      else if (current === d) finish(d, 'interrupted');
    })().catch(() => { if (current === d) finish(d, 'failed'); });
  });
  return {
    offer(input: { origin: 'worker-result'; turnId: string; text: string }) {
      if (detached) return { status: 'unsupported' as const };
      if (!input.turnId || input.origin !== 'worker-result' || !input.text.trim() || input.text.trim().split(/\s+/).length > 40) throw new Error('invalid_request');
      if (current || busy()) { idleSince = undefined; return { status: 'deferred' as const }; }
      idleSince ??= now();
      if (now() - idleSince < 700) return { status: 'deferred' as const };
      let resolve!: (value: string) => void;
      const done = new Promise<string>(r => { resolve = r; });
      const controller = new AbortController();
      const d: Delivery = { ...input, generation: ++runtime.responseGeneration, epoch: runtime.audioGraph.getPlaybackEpoch(), sawAudio: false, state: 'generating', done, resolve };
      current = d; runtime.responseAbortController = controller;
      void (async () => {
        await runtime.pushAssistantText(input.text, false);
        if (!valid(d)) return;
        await runtime.synthesizeAssistantChunk(runtime.prepareTextForTts(input.text), controller, d.generation);
        if (!valid(d)) return;
        await runtime.runtimeWorker.flushOutputAudio();
        if (!valid(d)) return;
        if (!d.sawAudio) throw new Error('Event speech produced no audio');
        d.state = 'playing';
        runtime.responseAbortController = null; runtime.scheduleDrainOutputAudio(0);
      })().catch(async () => {
        if (!valid(d)) return;
        finish(d, 'failed'); runtime.abortResponsePipeline(); await runtime.runtimeWorker.triggerBargeIn();
      }).finally(() => { if (current === d && !valid(d)) finish(d, 'interrupted'); });
      return { status: 'accepted' as const, delivery: d };
    },
    detach() {
      detached = true; unsubscribe(); runtime.audioGraph.setOutputFlushedHandler(originalFlush);
      if (current) { const d = current; finish(d, 'interrupted'); runtime.abortResponsePipeline(); void runtime.runtimeWorker.triggerBargeIn(); }
    },
  };
}
