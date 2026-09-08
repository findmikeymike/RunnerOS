declare class VoiceCoreOutputProcessor {
    constructor(options: any);
    playbackEpoch: any;
    playbackSamples: number;
    playbackConsuming: boolean;
    playbackFrameActive: boolean;
    playbackFrameInterval: number;
    playbackFrameElapsed: number;
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
    flushRequestId: any;
    queueHighWaterSamples: number;
    queueLowWaterSamples: number;
    maxQueuedSamples: number;
    postPlaybackFrame(active: any, level: any, consuming?: boolean): void;
    observeOutput(channel: any, consumedSamples?: number): void;
    syncBackpressureState(): void;
    process(_inputs: any, outputs: any): boolean;
}
//# sourceMappingURL=output-worklet.d.ts.map