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
export declare class RuntimeWorkerClient {
    private static readonly REQUEST_TIMEOUT_MS;
    private worker;
    private ready;
    private messageHandler;
    private nextRequestId;
    private pendingRequests;
    init(config: unknown): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    startListening(): Promise<void>;
    pushPartialTranscript(text: string): Promise<void>;
    completeUserTranscript(text: string): Promise<void>;
    pushAssistantText(text: string, isFinal: boolean): Promise<void>;
    setConfig(config: unknown): Promise<void>;
    notifyOutputPlaybackFinished(): Promise<void>;
    triggerBargeIn(): Promise<void>;
    flushOutputAudio(timestampMs?: number): Promise<void>;
    feedInputAudio(samples: Int16Array, sampleRateHz: number, channels: number): Promise<void>;
    pushTtsAudio(samples: Int16Array, sampleRateHz: number, channels: number, timestampMs: number): Promise<boolean>;
    popAudioChunk(): Promise<string | null>;
    getContextJson(): Promise<string>;
    getInputStatsJson(): Promise<string>;
    destroy(): void;
    setMessageHandler(handler: ((message: RuntimeWorkerResponse) => void) | null): void;
    private ensureReady;
    private sendCommand;
    private readonly handleRuntimeMessage;
    private readonly handleWorkerError;
    private readonly handleWorkerMessageError;
    private quarantineWorker;
}
export {};
//# sourceMappingURL=worker.d.ts.map