export type ChatterboxDtype = "fp16" | "q4f16";
export type ChatterboxDtypeMap = {
    embed_tokens: ChatterboxDtype;
    speech_encoder: ChatterboxDtype;
    language_model: ChatterboxDtype;
    conditional_decoder: ChatterboxDtype;
};
export declare const DEFAULT_CHATTERBOX_DTYPE_MAP: ChatterboxDtypeMap;
export declare const DEFAULT_CHATTERBOX_SAMPLE_RATE = 24000;
export declare const DEFAULT_CHATTERBOX_MODEL_ID = "chatterbox-turbo-webgpu";
export declare const MAX_CHATTERBOX_TEXT_BYTES = 16384;
export declare const MAX_CHATTERBOX_REFERENCE_SECONDS = 30;
export declare const MAX_CHATTERBOX_OUTPUT_SECONDS = 120;
export type ChatterboxLoadIdentity = {
    modelBaseUrl: string;
    modelId: string;
    modelRevision: string;
    dtypeMap: ChatterboxDtypeMap;
    sessionToken: string | null;
};
export declare function createChatterboxLoadKey(request: ChatterboxLoadIdentity): string;
export type ChatterboxWorkerRequest = {
    id: number;
    type: "load";
    modelBaseUrl: string;
    modelId: string;
    modelRevision: string;
    dtypeMap: ChatterboxDtypeMap;
    sessionToken: string | null;
} | {
    id: number;
    type: "synthesize";
    text: string;
    voiceId: string;
    referenceSha256: string;
    referencePcm: ArrayBuffer;
    referenceSampleRate: number;
    maxNewTokens: number;
    repetitionPenalty: number;
} | {
    id: number;
    type: "cancel_synthesis";
    synthesisId: number;
} | {
    id: number;
    type: "dispose_voice";
    voiceId: string;
} | {
    id: number;
    type: "dispose_model";
};
export type ChatterboxWorkerResponse = {
    type: "progress";
    message: string;
} | {
    id: number;
    type: "load_ready";
    loadMs: number;
} | {
    id: number;
    type: "synthesize_result";
    audio: ArrayBuffer;
    sampleRate: number;
    synthesisMs: number;
    audioSeconds: number;
} | {
    id: number;
    type: "dispose_complete";
} | {
    id: number;
    type: "dispose_voice_complete";
} | {
    id: number;
    type: "synthesis_cancelled";
    synthesisId: number;
} | {
    id: number;
    type: "error";
    message: string;
};
//# sourceMappingURL=protocol.d.ts.map