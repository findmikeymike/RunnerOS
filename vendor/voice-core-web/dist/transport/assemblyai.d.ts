import type { WebSttTransport } from "./types";
export type AssemblyAiSttTransportOptions = {
    getToken?: (signal?: AbortSignal) => Promise<string>;
    webSocketUrl?: string;
    sessionToken?: string;
    sampleRateHz?: number;
    formatTurns?: boolean;
    encoding?: "pcm_s16le";
    endOfTurnConfidenceThreshold?: number;
    minEndOfTurnSilenceMs?: number;
    maxTurnSilenceMs?: number;
    vadThreshold?: number;
    inactivityTimeoutSecs?: number;
    wordBoost?: string[];
    languageDetection?: boolean;
    speechModel?: string;
};
export type AssemblyAiTemporaryTokenResponse = {
    token: string;
} | {
    temporary_token: string;
};
export declare function createAssemblyAiSttTransport(options: AssemblyAiSttTransportOptions): WebSttTransport;
export declare function createAssemblyAiTemporaryTokenFetcher(endpoint: string, init?: RequestInit): (signal?: AbortSignal) => Promise<string>;
//# sourceMappingURL=assemblyai.d.ts.map