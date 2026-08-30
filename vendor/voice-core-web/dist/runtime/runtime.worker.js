"use strict";
let runtime = null;
async function flushEvents() {
    if (!runtime) {
        return;
    }
    const eventsJson = runtime.tick();
    const events = JSON.parse(eventsJson);
    if (events.length > 0) {
        self.postMessage({ type: "events", events });
    }
}
self.onmessage = (event) => {
    const post = (message) => {
        self.postMessage(message);
    };
    const requestId = event.data.requestId;
    void (async () => {
        try {
            switch (event.data.type) {
                case "init": {
                    const module = (await import("../../pkg/conversational_web.js"));
                    if (typeof module.default === "function") {
                        await module.default();
                    }
                    runtime = new module.WebRuntime(JSON.stringify(event.data.config ?? {}));
                    await flushEvents();
                    post({ type: "ack", requestId });
                    break;
                }
                case "start":
                    if (!runtime) {
                        post({
                            type: "error",
                            message: "worker runtime not initialized",
                            requestId,
                        });
                        return;
                    }
                    runtime.start();
                    await flushEvents();
                    post({ type: "ack", requestId });
                    break;
                case "stop":
                    if (!runtime) {
                        post({ type: "ack", requestId });
                        return;
                    }
                    runtime.stop();
                    await flushEvents();
                    post({ type: "ack", requestId });
                    break;
                case "startListening":
                    if (!runtime) {
                        post({ type: "error", message: "worker runtime not initialized", requestId });
                        return;
                    }
                    runtime.start_listening();
                    await flushEvents();
                    post({ type: "ack", requestId });
                    break;
                case "tick":
                    await flushEvents();
                    post({ type: "ack", requestId });
                    break;
                case "pushPartialTranscript":
                    if (!runtime) {
                        post({ type: "error", message: "worker runtime not initialized", requestId });
                        return;
                    }
                    runtime.push_partial_transcript(event.data.text);
                    await flushEvents();
                    post({ type: "ack", requestId });
                    break;
                case "completeUserTranscript":
                    if (!runtime) {
                        post({ type: "error", message: "worker runtime not initialized", requestId });
                        return;
                    }
                    runtime.complete_user_transcript(event.data.text);
                    await flushEvents();
                    post({ type: "ack", requestId });
                    break;
                case "pushAssistantText":
                    if (!runtime) {
                        post({ type: "error", message: "worker runtime not initialized", requestId });
                        return;
                    }
                    runtime.push_assistant_text(event.data.text, event.data.isFinal);
                    await flushEvents();
                    post({ type: "ack", requestId });
                    break;
                case "setConfig":
                    if (!runtime) {
                        post({ type: "error", message: "worker runtime not initialized", requestId });
                        return;
                    }
                    runtime.set_config(JSON.stringify(event.data.config ?? {}));
                    post({ type: "ack", requestId });
                    break;
                case "notifyOutputPlaybackFinished":
                    if (!runtime) {
                        post({ type: "error", message: "worker runtime not initialized", requestId });
                        return;
                    }
                    runtime.notify_output_playback_finished();
                    await flushEvents();
                    post({ type: "ack", requestId });
                    break;
                case "triggerBargeIn":
                    if (!runtime) {
                        post({ type: "error", message: "worker runtime not initialized", requestId });
                        return;
                    }
                    runtime.trigger_barge_in();
                    await flushEvents();
                    post({ type: "ack", requestId });
                    break;
                case "flushOutputAudio":
                    if (!runtime) {
                        post({ type: "error", message: "worker runtime not initialized", requestId });
                        return;
                    }
                    runtime.flush_output_audio(BigInt(Math.max(0, Math.trunc(event.data.timestampMs))));
                    await flushEvents();
                    post({ type: "ack", requestId });
                    break;
                case "feedInputAudio":
                    if (!runtime) {
                        post({ type: "error", message: "worker runtime not initialized", requestId });
                        return;
                    }
                    runtime.feed_input_audio(event.data.samples, event.data.sampleRateHz, event.data.channels);
                    post({ type: "ack", requestId });
                    break;
                case "pushTtsAudio":
                    if (!runtime) {
                        post({ type: "error", message: "worker runtime not initialized", requestId });
                        return;
                    }
                    const accepted = runtime.push_tts_audio(event.data.samples, event.data.sampleRateHz, event.data.channels, BigInt(Math.max(0, Math.trunc(event.data.timestampMs))));
                    await flushEvents();
                    post({ type: "ttsAudio", requestId, accepted });
                    break;
                case "popAudio":
                    if (!runtime) {
                        post({ type: "error", message: "worker runtime not initialized", requestId });
                        return;
                    }
                    post({
                        type: "audio",
                        requestId,
                        chunk: runtime.pop_audio_json(),
                    });
                    await flushEvents();
                    break;
                case "getContext":
                    if (!runtime) {
                        post({ type: "error", message: "worker runtime not initialized", requestId });
                        return;
                    }
                    post({
                        type: "context",
                        requestId,
                        context: runtime.get_context_json(),
                    });
                    break;
                case "getInputStats":
                    if (!runtime) {
                        post({ type: "error", message: "worker runtime not initialized", requestId });
                        return;
                    }
                    post({
                        type: "inputStats",
                        requestId,
                        stats: runtime.get_input_stats_json(),
                    });
                    break;
                default:
                    post({
                        type: "error",
                        message: "unknown worker message",
                        requestId,
                    });
            }
        }
        catch (error) {
            post({
                type: "error",
                message: error instanceof Error ? error.message : String(error),
                requestId,
            });
        }
    })();
};
//# sourceMappingURL=runtime.worker.js.map