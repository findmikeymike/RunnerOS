type RuntimeWorkerRequest = {
    type: "init";
    config: unknown;
    requestId: number;
} | {
    type: "start";
    requestId: number;
} | {
    type: "stop";
    requestId: number;
} | {
    type: "tick";
    requestId: number;
} | {
    type: "startListening";
    requestId: number;
} | {
    type: "pushPartialTranscript";
    text: string;
    requestId: number;
} | {
    type: "completeUserTranscript";
    text: string;
    requestId: number;
} | {
    type: "pushAssistantText";
    text: string;
    isFinal: boolean;
    requestId: number;
} | {
    type: "setConfig";
    config: unknown;
    requestId: number;
} | {
    type: "notifyOutputPlaybackFinished";
    requestId: number;
} | {
    type: "triggerBargeIn";
    requestId: number;
} | {
    type: "flushOutputAudio";
    timestampMs: number;
    requestId: number;
} | {
    type: "feedInputAudio";
    samples: Int16Array;
    sampleRateHz: number;
    channels: number;
    requestId: number;
} | {
    type: "pushTtsAudio";
    samples: Int16Array;
    sampleRateHz: number;
    channels: number;
    timestampMs: number;
    requestId: number;
} | {
    type: "popAudio";
    requestId: number;
} | {
    type: "getContext";
    requestId: number;
} | {
    type: "getInputStats";
    requestId: number;
};
type RuntimeWorkerResponse = {
    type: "ack";
    requestId: number;
} | {
    type: "events";
    events: unknown[];
} | {
    type: "audio";
    requestId: number;
    chunk: string | null;
} | {
    type: "ttsAudio";
    requestId: number;
    accepted: boolean;
} | {
    type: "context";
    requestId: number;
    context: string;
} | {
    type: "inputStats";
    requestId: number;
    stats: string;
} | {
    type: "error";
    message: string;
    requestId?: number;
};
type RuntimeModule = {
    default?: () => Promise<unknown>;
    WebRuntime: new (configJson: string) => {
        start(): void;
        stop(): void;
        tick(): string;
        start_listening(): void;
        push_partial_transcript(text: string): void;
        complete_user_transcript(text: string): void;
        push_assistant_text(text: string, isFinal: boolean): void;
        set_config(configJson: string): void;
        notify_output_playback_finished(): void;
        trigger_barge_in(): void;
        flush_output_audio(timestampMs: bigint): void;
        feed_input_audio(samples: Int16Array, sampleRateHz: number, channels: number): void;
        push_tts_audio(samples: Int16Array, sampleRateHz: number, channels: number, timestampMs: bigint): boolean;
        pop_audio_json(): string;
        get_context_json(): string;
        get_input_stats_json(): string;
    };
};
declare let runtime: InstanceType<RuntimeModule["WebRuntime"]> | null;
declare function flushEvents(): Promise<void>;
//# sourceMappingURL=runtime.worker.d.ts.map