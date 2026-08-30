import type { SttTranscriptEvent, WebSttTransport, WebTransportBundle } from "./types";
export declare function createMockTransportBundle(): WebTransportBundle;
export declare class MockSttTransport implements WebSttTransport {
    private handlers;
    private errorHandlers;
    private started;
    start(): Promise<void>;
    stop(): Promise<void>;
    sendAudio(_pcm16: Int16Array, _sampleRate: number, _channels: number): Promise<void>;
    onTranscript(handler: (event: SttTranscriptEvent) => void): () => void;
    onError(handler: (error: Error) => void): () => void;
    emitPartial(text: string): void;
    emitFinal(text: string): void;
    emitScriptedTurn(text: string, delayMs?: number): Promise<void>;
    private emit;
}
//# sourceMappingURL=mock.d.ts.map