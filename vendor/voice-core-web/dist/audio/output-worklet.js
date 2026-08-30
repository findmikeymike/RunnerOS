"use strict";
class VoiceCoreOutputProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.pending = [];
        this.offset = 0;
        this.queuedSamples = 0;
        this.active = false;
        this.backpressured = false;
        this.prebufferSamples = Math.max(128, Math.round(sampleRate * 0.1));
        this.fadeSamples = Math.max(32, Math.round(sampleRate * 0.005));
        this.fadeInOffset = this.fadeSamples;
        this.tailRampRemaining = 0;
        this.tailRampStartSample = 0;
        this.inactiveGraceSamples = Math.max(128, Math.round(sampleRate * 0.12));
        this.inactiveSamplesRemaining = 0;
        this.reportedUnderrun = false;
        this.queueHighWaterSamples = Math.round(sampleRate * 0.75);
        this.queueLowWaterSamples = Math.round(sampleRate * 0.35);
        this.maxQueuedSamples = Math.round(sampleRate * 1.5);
        this.port.onmessage = (event) => {
            if (event.data?.type === "output" && event.data.frames) {
                const frames = event.data.frames;
                if (this.queuedSamples + frames.length > this.maxQueuedSamples) {
                    this.port.postMessage({
                        type: "outputRejected",
                        requestId: event.data.requestId,
                        droppedSamples: frames.length,
                        queuedSamples: this.queuedSamples,
                    });
                    return;
                }
                this.pending.push(frames);
                this.queuedSamples += frames.length;
                this.syncBackpressureState();
                this.port.postMessage({
                    type: "outputAccepted",
                    requestId: event.data.requestId,
                    queuedSamples: this.queuedSamples,
                });
                if (this.tailRampRemaining > 0) {
                    this.tailRampRemaining = 0;
                    this.tailRampStartSample = 0;
                }
                this.inactiveSamplesRemaining = 0;
                this.reportedUnderrun = false;
                return;
            }
            if (event.data?.type === "clearOutput") {
                this.pending = [];
                this.offset = 0;
                this.queuedSamples = 0;
                this.backpressured = false;
                this.fadeInOffset = this.fadeSamples;
                this.tailRampRemaining = 0;
                this.tailRampStartSample = 0;
                this.inactiveSamplesRemaining = 0;
                this.reportedUnderrun = false;
                if (this.active) {
                    this.active = false;
                    this.port.postMessage({ type: "playbackState", active: false });
                }
                this.port.postMessage({
                    type: "queueBackpressure",
                    active: false,
                    queuedSamples: 0,
                });
            }
        };
    }
    syncBackpressureState() {
        let nextBackpressured = this.backpressured;
        if (this.queuedSamples >= this.queueHighWaterSamples) {
            nextBackpressured = true;
        }
        else if (this.queuedSamples <= this.queueLowWaterSamples) {
            nextBackpressured = false;
        }
        if (nextBackpressured !== this.backpressured) {
            this.backpressured = nextBackpressured;
            this.port.postMessage({
                type: "queueBackpressure",
                active: this.backpressured,
                queuedSamples: this.queuedSamples,
            });
        }
    }
    process(_inputs, outputs) {
        const output = outputs[0];
        const channel = output?.[0];
        if (!channel) {
            return true;
        }
        channel.fill(0);
        if (this.pending.length === 0 && this.tailRampRemaining > 0) {
            const writable = Math.min(channel.length, this.tailRampRemaining);
            const rampProgressStart = this.fadeSamples - this.tailRampRemaining;
            for (let index = 0; index < writable; index += 1) {
                const progress = (rampProgressStart + index) / Math.max(1, this.fadeSamples - 1);
                channel[index] = this.tailRampStartSample * (1 - progress);
            }
            this.tailRampRemaining -= writable;
            if (this.tailRampRemaining === 0) {
                this.tailRampStartSample = 0;
            }
        }
        if (this.pending.length === 0) {
            if (this.active) {
                if (this.inactiveSamplesRemaining <= 0) {
                    this.inactiveSamplesRemaining = this.inactiveGraceSamples;
                    if (!this.reportedUnderrun) {
                        this.reportedUnderrun = true;
                        this.port.postMessage({ type: "playbackUnderrun" });
                    }
                }
                else {
                    this.inactiveSamplesRemaining = Math.max(0, this.inactiveSamplesRemaining - channel.length);
                }
                if (this.inactiveSamplesRemaining === 0) {
                    this.active = false;
                    this.port.postMessage({ type: "playbackState", active: false });
                }
            }
            return true;
        }
        if (!this.active && this.queuedSamples < this.prebufferSamples) {
            return true;
        }
        if (!this.active) {
            this.active = true;
            this.fadeInOffset = 0;
            this.reportedUnderrun = false;
            this.port.postMessage({ type: "playbackState", active: true });
        }
        this.inactiveSamplesRemaining = 0;
        let writeIndex = 0;
        while (writeIndex < channel.length && this.pending.length > 0) {
            const current = this.pending[0];
            const remaining = current.length - this.offset;
            const writable = Math.min(remaining, channel.length - writeIndex);
            channel.set(current.subarray(this.offset, this.offset + writable), writeIndex);
            writeIndex += writable;
            this.offset += writable;
            this.queuedSamples = Math.max(0, this.queuedSamples - writable);
            if (this.offset >= current.length) {
                this.pending.shift();
                this.offset = 0;
                this.syncBackpressureState();
            }
        }
        if (this.fadeInOffset < this.fadeSamples) {
            const fadeCount = Math.min(writeIndex, this.fadeSamples - this.fadeInOffset);
            for (let index = 0; index < fadeCount; index += 1) {
                const progress = (this.fadeInOffset + index) / Math.max(1, this.fadeSamples - 1);
                channel[index] *= progress;
            }
            this.fadeInOffset += fadeCount;
        }
        if (this.pending.length === 0 && writeIndex > 0) {
            this.tailRampRemaining = this.fadeSamples;
            this.tailRampStartSample = channel[writeIndex - 1];
            const writable = Math.min(channel.length - writeIndex, this.tailRampRemaining);
            for (let index = 0; index < writable; index += 1) {
                const progress = index / Math.max(1, this.fadeSamples - 1);
                channel[writeIndex + index] = this.tailRampStartSample * (1 - progress);
            }
            this.tailRampRemaining -= writable;
            if (this.tailRampRemaining === 0) {
                this.tailRampStartSample = 0;
            }
        }
        this.syncBackpressureState();
        return true;
    }
}
registerProcessor("voice-core-output", VoiceCoreOutputProcessor);
//# sourceMappingURL=output-worklet.js.map