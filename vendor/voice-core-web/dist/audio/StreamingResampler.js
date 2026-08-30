/** Stateful mono linear resampler that preserves phase across streamed chunks. */
export class StreamingResampler {
    sourceRate = 0;
    targetRate = 0;
    nextSourcePosition = 0;
    tail = null;
    reset() {
        this.sourceRate = 0;
        this.targetRate = 0;
        this.nextSourcePosition = 0;
        this.tail = null;
    }
    process(frames, sourceRate, targetRate) {
        if (!Number.isFinite(sourceRate) || sourceRate <= 0)
            throw new RangeError("VoiceCore output sample rate must be positive and finite");
        if (!Number.isFinite(targetRate) || targetRate <= 0)
            throw new RangeError("VoiceCore AudioContext sample rate must be positive and finite");
        if (frames.length === 0)
            return frames;
        if (sourceRate === targetRate) {
            this.reset();
            return frames;
        }
        if (this.sourceRate !== sourceRate || this.targetRate !== targetRate) {
            this.reset();
            this.sourceRate = sourceRate;
            this.targetRate = targetRate;
        }
        const combined = new Float32Array(frames.length + (this.tail === null ? 0 : 1));
        let offset = 0;
        if (this.tail !== null) {
            combined[0] = this.tail;
            offset = 1;
        }
        combined.set(frames, offset);
        if (combined.length < 2) {
            this.tail = combined[0];
            return new Float32Array(0);
        }
        const step = sourceRate / targetRate;
        // Two guard slots absorb floating-point boundary drift; writing past a
        // TypedArray would otherwise silently drop a sample while advancing phase.
        const output = new Float32Array(Math.max(0, Math.ceil((combined.length - 1 - this.nextSourcePosition) / step) + 2));
        let written = 0;
        while (this.nextSourcePosition < combined.length - 1) {
            const leftIndex = Math.floor(this.nextSourcePosition);
            const fraction = this.nextSourcePosition - leftIndex;
            const left = combined[leftIndex] ?? 0;
            const right = combined[leftIndex + 1] ?? left;
            output[written++] = left + (right - left) * fraction;
            this.nextSourcePosition += step;
        }
        this.nextSourcePosition -= combined.length - 1;
        this.tail = combined[combined.length - 1];
        return written === output.length ? output : output.slice(0, written);
    }
}
//# sourceMappingURL=StreamingResampler.js.map