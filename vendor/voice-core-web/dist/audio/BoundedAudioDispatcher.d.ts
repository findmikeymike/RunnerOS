/** Serial realtime delivery with explicit failure instead of dropped or stale audio. */
export declare class BoundedAudioDispatcher<T> {
    private generation;
    private pending;
    private bufferedMs;
    private entries;
    private active;
    private failed;
    private cancelWait;
    private readonly deliver;
    private readonly onError;
    private readonly label;
    private readonly maxBufferedMs;
    private readonly deliveryTimeoutMs;
    constructor(deliver: (value: T) => Promise<void>, onError: (error: Error) => void, label: string, maxBufferedMs?: number, deliveryTimeoutMs?: number);
    submit(value: T, durationMs: number): void;
    reset(): void;
    private fail;
    private drain;
}
//# sourceMappingURL=BoundedAudioDispatcher.d.ts.map