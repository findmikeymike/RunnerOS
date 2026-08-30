import type { TtsAudioChunk, WebTtsTransport } from "./types";
export type PocketTtsTransportOptions = {
    apiBaseUrl?: string;
    voiceId?: string;
    sessionToken?: string;
    getAuthHeaders?: () => Record<string, string>;
    onDiagnostic?: (message: string) => void;
};
export declare function createPocketTtsTransport(options?: PocketTtsTransportOptions): WebTtsTransport;
export declare function checkPocketTtsHealth(options?: Pick<PocketTtsTransportOptions, "apiBaseUrl" | "sessionToken" | "getAuthHeaders">): Promise<void>;
export declare function decodePcm16Wav(bytes: Uint8Array): TtsAudioChunk;
//# sourceMappingURL=pocket.d.ts.map