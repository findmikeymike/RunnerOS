/** Serial realtime delivery with explicit failure instead of dropped or stale audio. */
export class BoundedAudioDispatcher {
    generation = 0;
    pending = [];
    bufferedMs = 0;
    entries = 0;
    active = false;
    failed = false;
    cancelWait = null;
    deliver;
    onError;
    label;
    maxBufferedMs;
    deliveryTimeoutMs;
    constructor(deliver, onError, label, maxBufferedMs = 2_000, deliveryTimeoutMs = 5_000) {
        this.deliver = deliver;
        this.onError = onError;
        this.label = label;
        this.maxBufferedMs = maxBufferedMs;
        this.deliveryTimeoutMs = deliveryTimeoutMs;
    }
    submit(value, durationMs) {
        if (this.failed)
            return;
        if (!Number.isFinite(durationMs) || durationMs <= 0) {
            this.fail(new Error(`${this.label}: invalid audio duration. Press Start to reconnect.`));
            return;
        }
        if (this.bufferedMs + durationMs > this.maxBufferedMs || this.entries >= 128) {
            this.fail(new Error(`${this.label} cannot keep up with the microphone (${this.maxBufferedMs}ms audio backlog). Audio was not transcribed safely. Close busy apps and press Start to retry.`));
            return;
        }
        this.pending.push({ value, durationMs });
        this.bufferedMs += durationMs;
        this.entries++;
        if (!this.active)
            void this.drain(this.generation);
    }
    reset() {
        this.generation++;
        this.cancelWait?.();
        this.cancelWait = null;
        this.pending = [];
        this.bufferedMs = 0;
        this.entries = 0;
        this.active = false;
        this.failed = false;
    }
    fail(error) {
        if (this.failed)
            return;
        this.reset();
        this.failed = true;
        this.onError(error);
    }
    async drain(generation) {
        this.active = true;
        try {
            while (generation === this.generation && this.pending.length > 0) {
                const current = this.pending.shift();
                let timeout;
                try {
                    await Promise.race([
                        Promise.resolve().then(() => generation === this.generation ? this.deliver(current.value) : undefined),
                        new Promise((resolve, reject) => {
                            this.cancelWait = resolve;
                            timeout = setTimeout(() => reject(new Error(`${this.label} stopped responding. Press Start to reconnect.`)), this.deliveryTimeoutMs);
                        }),
                    ]);
                }
                finally {
                    clearTimeout(timeout);
                    if (generation === this.generation)
                        this.cancelWait = null;
                }
                if (generation !== this.generation)
                    return;
                this.bufferedMs -= current.durationMs;
                this.entries--;
            }
        }
        catch (error) {
            if (generation === this.generation)
                this.fail(error instanceof Error ? error : new Error(String(error)));
        }
        finally {
            if (generation === this.generation)
                this.active = false;
        }
    }
}
//# sourceMappingURL=BoundedAudioDispatcher.js.map