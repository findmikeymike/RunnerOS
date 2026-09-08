import type { TtsVisemeCue } from "../transport/types";
/** Side channel for metadata that the Rust PCM/resampler deliberately does not carry. */
export declare class TtsVisemeMetadataQueue {
    private segments;
    private tail;
    /** Acceptance and pop commands share this gate: output cannot overtake a pending
     * push acknowledgement, and rejected/backpressured retries never duplicate cues. */
    run<T>(operation: () => Promise<T>): Promise<T>;
    appendAcceptedSlice(durationMs: number, chunkOffsetMs: number, visemes?: readonly TtsVisemeCue[]): void;
    /** Consume source time for an arbitrary resampler output block. Empty [] means
     * verified silence; any unknown span makes this block use amplitude fallback. */
    consume(outputFrames: number, outputSampleRate: number): TtsVisemeCue[] | undefined;
    reset(): void;
}
//# sourceMappingURL=TtsVisemeMetadataQueue.d.ts.map