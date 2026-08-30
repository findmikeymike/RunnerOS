declare class VoiceCoreOutputProcessor {
    pending: any[];
    offset: number;
    queuedSamples: number;
    active: boolean;
    backpressured: boolean;
    prebufferSamples: number;
    fadeSamples: number;
    fadeInOffset: number;
    tailRampRemaining: number;
    tailRampStartSample: number;
    inactiveGraceSamples: number;
    inactiveSamplesRemaining: number;
    reportedUnderrun: boolean;
    queueHighWaterSamples: number;
    queueLowWaterSamples: number;
    maxQueuedSamples: number;
    syncBackpressureState(): void;
    process(_inputs: any, outputs: any): boolean;
}
//# sourceMappingURL=output-worklet.d.ts.map