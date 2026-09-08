const MAX_CUES = 4096;
const EPSILON_MS = 0.000001;
/** Side channel for metadata that the Rust PCM/resampler deliberately does not carry. */
export class TtsVisemeMetadataQueue {
    segments = [];
    tail = Promise.resolve();
    /** Acceptance and pop commands share this gate: output cannot overtake a pending
     * push acknowledgement, and rejected/backpressured retries never duplicate cues. */
    run(operation) {
        const result = this.tail.catch(() => undefined).then(operation);
        this.tail = result.then(() => undefined, () => undefined);
        return result;
    }
    appendAcceptedSlice(durationMs, chunkOffsetMs, visemes) {
        if (!Number.isFinite(durationMs) || durationMs <= 0)
            return;
        let sliced;
        if (Array.isArray(visemes) && visemes.length <= MAX_CUES && visemes.every(cue => cue && Number.isFinite(cue.startMs) && Number.isFinite(cue.endMs) &&
            cue.startMs >= 0 && cue.endMs > cue.startMs && typeof cue.viseme === "string" &&
            cue.viseme.length > 0 && cue.viseme.length <= 64 &&
            (cue.phoneme === undefined || (typeof cue.phoneme === "string" && cue.phoneme.length <= 64)))) {
            sliced = visemes.flatMap(cue => {
                const startMs = Math.max(0, cue.startMs - chunkOffsetMs);
                const endMs = Math.min(durationMs, cue.endMs - chunkOffsetMs);
                return endMs > startMs ? [{ ...cue, startMs, endMs }] : [];
            });
        }
        this.segments.push({ durationMs, visemes: sliced });
        // Bound optional graphics metadata without dropping its position in the audio
        // FIFO. Collapsing old entries to unknown preserves later alignment exactly.
        if (this.segments.length > MAX_CUES) {
            const collapsed = this.segments.splice(0, MAX_CUES / 2);
            this.segments.unshift({ durationMs: collapsed.reduce((sum, entry) => sum + entry.durationMs, 0) });
        }
    }
    /** Consume source time for an arbitrary resampler output block. Empty [] means
     * verified silence; any unknown span makes this block use amplitude fallback. */
    consume(outputFrames, outputSampleRate) {
        if (!Number.isInteger(outputFrames) || outputFrames <= 0 || !Number.isFinite(outputSampleRate) || outputSampleRate <= 0)
            return undefined;
        const durationMs = outputFrames * 1000 / outputSampleRate;
        const cues = [];
        let remaining = durationMs;
        let offset = 0;
        let known = true;
        let consumed = false;
        while (remaining > EPSILON_MS && this.segments.length) {
            const segment = this.segments[0];
            const take = Math.min(remaining, segment.durationMs);
            consumed = true;
            if (segment.visemes === undefined)
                known = false;
            else {
                for (const cue of segment.visemes) {
                    const startMs = Math.max(0, cue.startMs);
                    const endMs = Math.min(take, cue.endMs);
                    if (endMs > startMs)
                        cues.push({ ...cue, startMs: offset + startMs, endMs: offset + endMs });
                }
            }
            remaining -= take;
            offset += take;
            if (segment.durationMs - take <= EPSILON_MS)
                this.segments.shift();
            else {
                segment.durationMs -= take;
                segment.visemes = segment.visemes?.flatMap(cue => cue.endMs > take
                    ? [{ ...cue, startMs: Math.max(0, cue.startMs - take), endMs: cue.endMs - take }] : []);
            }
        }
        // Rust flush rounds total resampled duration up by at most one output sample.
        // That final padding is known silence, never debt against the next response.
        if (remaining > 1000 / outputSampleRate + EPSILON_MS || !consumed)
            known = false;
        return known ? cues : undefined;
    }
    reset() { this.segments = []; }
}
//# sourceMappingURL=TtsVisemeMetadataQueue.js.map