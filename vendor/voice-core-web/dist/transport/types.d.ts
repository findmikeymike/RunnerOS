export type SttTranscriptEvent = {
    type: "partial";
    text: string;
} | {
    type: "final";
    text: string;
};
export type LlmTokenEvent = {
    text: string;
    done?: boolean;
};
export type TtsAudioChunk = {
    frames: Float32Array;
    sampleRate: number;
    channels: number;
};
export type LlmGenerateRequest = {
    userText: string;
    contextJson: string;
    signal: AbortSignal;
    maxOutputTokens?: number;
};
export type TtsSynthesisRequest = {
    text: string;
    signal: AbortSignal;
};
export interface WebTtsStreamingSession extends AsyncIterable<TtsAudioChunk> {
    pushText(text: string, flush: boolean): Promise<void>;
    finish(): Promise<void>;
}
export type WebTransportBundle = {
    stt?: WebSttTransport;
    llm?: WebLlmTransport;
    tts?: WebTtsTransport;
};
export interface WebSttTransport {
    start(): Promise<void>;
    cancelStart?(): void;
    stop(): Promise<void>;
    sendAudio(pcm16: Int16Array, sampleRate: number, channels: number): Promise<void>;
    onTranscript(handler: (event: SttTranscriptEvent) => void): () => void;
    onError?(handler: (error: Error) => void): () => void;
}
export interface WebLlmTransport {
    generateReply(request: LlmGenerateRequest): Promise<AsyncIterable<LlmTokenEvent>>;
}
export interface WebTtsTransport {
    synthesize(request: TtsSynthesisRequest): Promise<AsyncIterable<TtsAudioChunk>>;
    createStreamingSession?(signal: AbortSignal): Promise<WebTtsStreamingSession>;
    stop?(): Promise<void>;
    dispose?(): Promise<void>;
}
//# sourceMappingURL=types.d.ts.map