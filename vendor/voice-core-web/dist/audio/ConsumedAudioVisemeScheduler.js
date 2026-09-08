const EPSILON = 1e-7;
const BLEND_SECONDS = 0.025;
/** Consumed source-PCM time, never queued duration or wall time, selects the pose. */
export class ConsumedAudioVisemeScheduler {
    epoch = -1;
    chunks = [];
    cursor = 0;
    queuedEnd = 0;
    beginEpoch(epoch) {
        if (!Number.isSafeInteger(epoch) || epoch < 0 || epoch <= this.epoch)
            return;
        this.epoch = epoch;
        this.reset();
    }
    enqueueChunk(input) {
        if (input.playbackEpoch !== this.epoch || !Number.isSafeInteger(input.outputFrames) || input.outputFrames <= 0
            || !Number.isFinite(input.outputSampleRate) || input.outputSampleRate <= 0)
            return;
        const start = this.queuedEnd;
        const end = start + input.outputFrames / input.outputSampleRate;
        this.queuedEnd = end;
        const raw = input.chunk.visemes;
        let cues;
        if (Array.isArray(raw) && raw.length <= 4096 && raw.every(cue => cue && typeof cue.viseme === "string"
            && cue.viseme.length <= 32 && Number.isFinite(cue.startMs) && Number.isFinite(cue.endMs) && cue.endMs > cue.startMs)) {
            cues = raw.map(cue => ({ symbol: cue.viseme, start: Math.max(start, start + cue.startMs / 1000), end: Math.min(end, start + cue.endMs / 1000) }))
                .filter(cue => cue.end > cue.start).sort((a, b) => a.start - b.start);
        }
        this.prune();
        // Losing metadata under pathological producer pressure must never shift the audio clock.
        if (this.chunks.length < 4096 && start <= this.cursor + 120)
            this.chunks.push({ start, end, cues });
    }
    sample(epoch, samples, rate) {
        if (epoch !== this.epoch || !Number.isSafeInteger(samples) || samples < 0 || !Number.isFinite(rate) || rate <= 0)
            return undefined;
        const time = samples / rate;
        if (time + EPSILON < this.cursor)
            return undefined;
        this.cursor = time;
        this.prune();
        const chunk = this.chunks.find(entry => time + EPSILON >= entry.start && time < entry.end - EPSILON);
        if (!chunk || chunk.cues === undefined)
            return undefined;
        const current = chunk.cues.find(cue => time + EPSILON >= cue.start && time < cue.end - EPSILON);
        if (!current)
            return [];
        const nearby = this.chunks.filter(entry => entry.end >= current.start - 0.1 && entry.start <= current.end + 0.1).flatMap(entry => entry.cues ?? []);
        const previous = nearby.find(cue => cue !== current && Math.abs(cue.end - current.start) < EPSILON);
        const next = nearby.find(cue => cue !== current && Math.abs(cue.start - current.end) < EPSILON);
        const blend = Math.min(BLEND_SECONDS, (current.end - current.start) / 2);
        const previousBlend = previous ? Math.min(blend, (previous.end - previous.start) / 2) : 0;
        const nextBlend = next ? Math.min(blend, (next.end - next.start) / 2) : 0;
        const result = new Map();
        const add = (symbol, weight) => result.set(symbol, (result.get(symbol) ?? 0) + weight);
        if (previous && previousBlend && time < current.start + previousBlend) {
            const alpha = 0.5 + (time - current.start) / (2 * previousBlend);
            add(previous.symbol, 1 - alpha);
            add(current.symbol, alpha);
        }
        else if (next && nextBlend && time > current.end - nextBlend) {
            const alpha = 0.5 - (current.end - time) / (2 * nextBlend);
            add(current.symbol, 1 - alpha);
            add(next.symbol, alpha);
        }
        else {
            const attack = previousBlend ? 1 : Math.min(1, Math.max(0, (time - current.start) / blend));
            const release = nextBlend ? 1 : Math.min(1, Math.max(0, (current.end - time) / blend));
            add(current.symbol, Math.min(attack, release));
        }
        return [...result].map(([symbol, weight]) => ({ symbol, weight }));
    }
    prune() {
        // Keep the previous short cue for blending at a chunk boundary.
        while (this.chunks.length && this.chunks[0].end < this.cursor - 0.1)
            this.chunks.shift();
    }
    reset() { this.chunks = []; this.cursor = 0; this.queuedEnd = 0; }
}
//# sourceMappingURL=ConsumedAudioVisemeScheduler.js.map