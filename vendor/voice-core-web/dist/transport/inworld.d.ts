import type { VoiceRuntimeConfig } from "../types";
import type { WebTtsTransport } from "./types";
export type InworldTtsTransportOptions = Pick<VoiceRuntimeConfig, "inworldRuntimeKey" | "inworldVoiceId" | "inworldModelId" | "sessionToken"> & {
    webSocketUrl?: string;
    sampleRateHz?: number;
    bufferCharThreshold?: number;
};
export declare function createInworldTtsTransport(options?: InworldTtsTransportOptions): WebTtsTransport;
//# sourceMappingURL=inworld.d.ts.map