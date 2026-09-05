import type { VoiceRuntimeConfig } from "../types";
import type { WebTtsTransport } from "./types";
export type InworldTtsTransportOptions = Pick<VoiceRuntimeConfig, "inworldRuntimeKey" | "inworldVoiceId" | "inworldModelId" | "sessionToken"> & {
    webSocketUrl?: string;
    sampleRateHz?: number;
    bufferCharThreshold?: number;
};
export declare function createInworldTtsTransport(options?: InworldTtsTransportOptions): WebTtsTransport;
export declare function createAsyncQueue<T>(maxQueuedWeight?: number, weightOf?: (value: T) => number, overflowMessage?: string): {
    push(value: T): void;
    end(): void;
    throw(nextError: Error): void;
    [Symbol.asyncIterator](): {
        next: () => Promise<IteratorResult<T, any>>;
    };
};
//# sourceMappingURL=inworld.d.ts.map