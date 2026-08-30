/** Stateful mono linear resampler that preserves phase across streamed chunks. */
export declare class StreamingResampler {
    private sourceRate;
    private targetRate;
    private nextSourcePosition;
    private tail;
    reset(): void;
    process(frames: Float32Array, sourceRate: number, targetRate: number): Float32Array;
}
//# sourceMappingURL=StreamingResampler.d.ts.map