import type { PlaybackViseme } from "../types";
import type { TtsAudioChunk } from "../transport/types";
type Input = {
    playbackEpoch: number;
    chunk: Pick<TtsAudioChunk, "visemes">;
    outputFrames: number;
    outputSampleRate: number;
};
/** Consumed source-PCM time, never queued duration or wall time, selects the pose. */
export declare class ConsumedAudioVisemeScheduler {
    private epoch;
    private chunks;
    private cursor;
    private queuedEnd;
    beginEpoch(epoch: number): void;
    enqueueChunk(input: Input): void;
    sample(epoch: number, samples: number, rate: number): readonly PlaybackViseme[] | undefined;
    private prune;
    reset(): void;
}
export {};
//# sourceMappingURL=ConsumedAudioVisemeScheduler.d.ts.map