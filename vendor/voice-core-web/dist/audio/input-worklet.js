"use strict";
class VoiceCoreInputProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        const requestedChunkSize = Number(options?.processorOptions?.chunkSize ?? 2048);
        const minimumChunkSize = Math.ceil((sampleRate * 0.05) / 128) * 128;
        this.chunkSize = Math.max(minimumChunkSize, Math.min(8192, requestedChunkSize | 0));
        this.pending = new Float32Array(this.chunkSize);
        this.offset = 0;
    }
    process(inputs) {
        const input = inputs[0];
        if (input && input[0]) {
            const channel = input[0];
            let readIndex = 0;
            while (readIndex < channel.length) {
                const writable = Math.min(this.chunkSize - this.offset, channel.length - readIndex);
                this.pending.set(channel.subarray(readIndex, readIndex + writable), this.offset);
                this.offset += writable;
                readIndex += writable;
                if (this.offset === this.chunkSize) {
                    this.port.postMessage({
                        type: "input",
                        frames: this.pending.slice(),
                    });
                    this.offset = 0;
                }
            }
        }
        return true;
    }
}
registerProcessor("voice-core-input", VoiceCoreInputProcessor);
//# sourceMappingURL=input-worklet.js.map