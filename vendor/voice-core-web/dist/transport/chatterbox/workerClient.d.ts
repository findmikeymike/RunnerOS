import { type ChatterboxDtypeMap, type ChatterboxWorkerResponse } from "./protocol.js";
type ChatterboxWorkerClientOptions = {
    createWorker?: () => Worker;
    onDiagnostic?: (message: string) => void;
    requestTimeoutMs?: number;
    cancellationDeadlineMs?: number;
};
type LoadRequest = {
    modelBaseUrl: string;
    modelId: string;
    modelRevision: string;
    dtypeMap: ChatterboxDtypeMap;
    sessionToken: string | null;
};
type SynthesisRequest = LoadRequest & {
    text: string;
    voiceId: string;
    referenceSha256: string;
    referencePcm: Float32Array;
    referenceSampleRate: number;
    maxNewTokens: number;
    repetitionPenalty: number;
    signal: AbortSignal;
};
export declare class ChatterboxWorkerClient {
    private readonly createWorkerImpl;
    private readonly onDiagnostic?;
    private readonly requestTimeoutMs;
    private readonly cancellationDeadlineMs;
    private worker;
    private nextId;
    private readonly pending;
    private loadedKey;
    private activeSynthesisId;
    private readonly cancelledSyntheses;
    constructor(options?: ChatterboxWorkerClientOptions);
    load(request: LoadRequest): Promise<number>;
    synthesize(request: SynthesisRequest): Promise<Extract<ChatterboxWorkerResponse, {
        type: "synthesize_result";
    }>>;
    invalidateVoice(voiceId: string): Promise<void>;
    dispose(): Promise<void>;
    private send;
    private sendWithId;
    private ensureWorker;
    private disposeWorker;
    private cancelActiveSynthesis;
    private clearCancellationDeadline;
    private allocateId;
}
export {};
//# sourceMappingURL=workerClient.d.ts.map