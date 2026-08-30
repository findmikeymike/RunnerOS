import { OutputAdmissionTracker } from "./OutputAdmissionTracker";
import { StreamingResampler } from "./StreamingResampler";
export class AudioGraph {
    static OUTPUT_ACK_TIMEOUT_MS = 2_000;
    static MEDIA_START_TIMEOUT_MS = 10_000;
    audioContext = null;
    mediaStream = null;
    sourceNode = null;
    inputNode = null;
    inputSinkNode = null;
    outputNode = null;
    inputFramesHandler = null;
    outputPlaybackHandler = null;
    outputQueuePressureHandler = null;
    outputDebugHandler = null;
    outputErrorHandler = null;
    outputResampler = new StreamingResampler();
    inputDeliveryActive = false;
    pendingInputDelivery = null;
    inputDeliveryGeneration = 0;
    startGeneration = 0;
    pendingStartCancellation = null;
    outputAdmissions = new OutputAdmissionTracker(AudioGraph.OUTPUT_ACK_TIMEOUT_MS);
    async start(config) {
        if (this.audioContext || this.mediaStream) {
            await this.stop();
        }
        const AudioContextCtor = window.AudioContext ||
            window
                .webkitAudioContext;
        if (!AudioContextCtor) {
            throw new Error("AudioContext is not available in this browser");
        }
        const startGeneration = ++this.startGeneration;
        try {
            const mediaRequest = navigator.mediaDevices.getUserMedia({
                audio: {
                    ...(config.inputDeviceId ? { deviceId: { exact: config.inputDeviceId } } : {}),
                    echoCancellation: config.echoCancellation ?? true,
                    noiseSuppression: config.noiseSuppression ?? true,
                    autoGainControl: config.autoGainControl ?? true,
                },
            });
            this.mediaStream = await this.withMediaStartTimeout(mediaRequest, startGeneration);
            if (startGeneration !== this.startGeneration) {
                this.mediaStream.getTracks().forEach((track) => track.stop());
                this.mediaStream = null;
                throw new Error("VoiceCore audio startup was cancelled");
            }
            this.audioContext = new AudioContextCtor();
            if (config.outputDeviceId) {
                const audioContextWithSink = this.audioContext;
                if (typeof audioContextWithSink.setSinkId === "function") {
                    try {
                        await audioContextWithSink.setSinkId(config.outputDeviceId);
                    }
                    catch {
                        // The browser already falls back to its default output device.
                    }
                }
            }
            await this.audioContext.audioWorklet.addModule(new URL("./input-worklet.js", import.meta.url));
            await this.audioContext.audioWorklet.addModule(new URL("./output-worklet.js", import.meta.url));
            this.sourceNode = new MediaStreamAudioSourceNode(this.audioContext, {
                mediaStream: this.mediaStream,
            });
            const minimumInputBatchFrames = Math.ceil((this.audioContext.sampleRate * 0.05) / 128) * 128;
            this.inputNode = new AudioWorkletNode(this.audioContext, "voice-core-input", {
                processorOptions: {
                    chunkSize: Math.max(config.inputBatchFrames ?? 2048, minimumInputBatchFrames),
                },
            });
            const inputGeneration = this.inputDeliveryGeneration;
            this.inputNode.port.onmessage = (event) => {
                if (inputGeneration !== this.inputDeliveryGeneration)
                    return;
                if (event.data?.type !== "input" || !event.data.frames) {
                    return;
                }
                this.enqueueInputDelivery(event.data.frames, this.audioContext?.sampleRate ?? 0, 1);
            };
            this.sourceNode.connect(this.inputNode);
            this.inputSinkNode = this.audioContext.createGain();
            this.inputSinkNode.gain.value = 0;
            this.inputNode.connect(this.inputSinkNode);
            this.inputSinkNode.connect(this.audioContext.destination);
            this.outputNode = new AudioWorkletNode(this.audioContext, "voice-core-output");
            this.outputNode.port.onmessage = (event) => {
                if ((event.data?.type === "outputAccepted" ||
                    event.data?.type === "outputRejected") &&
                    typeof event.data.requestId === "number") {
                    this.outputAdmissions.settle(event.data.requestId, event.data.type === "outputAccepted");
                    return;
                }
                if (event.data?.type === "playbackState" &&
                    "active" in event.data &&
                    typeof event.data.active === "boolean") {
                    this.outputPlaybackHandler?.(event.data.active);
                    return;
                }
                if (event.data?.type === "outputOverflow" &&
                    "droppedSamples" in event.data &&
                    typeof event.data.droppedSamples === "number") {
                    this.outputDebugHandler?.(`[output] overflow droppedSamples=${event.data.droppedSamples}`);
                    return;
                }
                if (event.data?.type === "playbackUnderrun") {
                    this.outputDebugHandler?.("[output] playback underrun");
                    return;
                }
                if (event.data?.type === "queueBackpressure" &&
                    "active" in event.data &&
                    typeof event.data.active === "boolean" &&
                    "queuedSamples" in event.data &&
                    typeof event.data.queuedSamples === "number") {
                    this.outputQueuePressureHandler?.(event.data.active, event.data.queuedSamples);
                }
            };
            this.outputNode.onprocessorerror = () => {
                const error = new Error("VoiceCore output worklet processor failed");
                this.cancelPendingOutputRequests(error.message);
                this.outputErrorHandler?.(error);
            };
            this.outputNode.connect(this.audioContext.destination);
            await this.audioContext.resume();
        }
        catch (error) {
            await this.stop();
            throw error;
        }
    }
    async stop() {
        this.cancelPendingStart();
        this.inputDeliveryGeneration += 1;
        this.pendingInputDelivery = null;
        this.inputDeliveryActive = false;
        this.cancelPendingOutputRequests("VoiceCore audio graph stopped");
        this.mediaStream?.getTracks().forEach((track) => track.stop());
        this.mediaStream = null;
        this.sourceNode?.disconnect();
        this.sourceNode = null;
        if (this.inputNode)
            this.inputNode.port.onmessage = null;
        this.inputNode?.disconnect();
        this.inputNode = null;
        this.inputSinkNode?.disconnect();
        this.inputSinkNode = null;
        if (this.outputNode) {
            this.outputNode.port.onmessage = null;
            this.outputNode.onprocessorerror = null;
            this.outputNode.disconnect();
        }
        this.outputNode = null;
        if (this.audioContext) {
            await this.audioContext.close();
            this.audioContext = null;
        }
        this.outputResampler.reset();
    }
    getSampleRate() {
        return this.audioContext?.sampleRate ?? null;
    }
    cancelPendingStart() {
        this.startGeneration += 1;
        this.pendingStartCancellation?.();
        this.pendingStartCancellation = null;
    }
    async enqueueOutputFrames(frames, sampleRateHz, channels) {
        if (!this.outputNode) {
            throw new Error("output node is not initialized");
        }
        const normalized = this.normalizeOutputFrames(frames, sampleRateHz, channels);
        const maxSliceSamples = Math.max(128, Math.round((this.audioContext?.sampleRate ?? 48_000) * 0.1));
        for (let offset = 0; offset < normalized.length; offset += maxSliceSamples) {
            await this.postOutputSlice(normalized.slice(offset, offset + maxSliceSamples));
        }
    }
    postOutputSlice(frames) {
        const outputNode = this.outputNode;
        if (!outputNode)
            throw new Error("output node is not initialized");
        const { requestId, promise } = this.outputAdmissions.create();
        outputNode.port.postMessage({
            type: "output",
            requestId,
            frames,
        });
        return promise;
    }
    clearOutputQueue() {
        this.cancelPendingOutputRequests("VoiceCore output queue cleared");
        this.outputResampler.reset();
        this.outputNode?.port.postMessage({ type: "clearOutput" });
    }
    setInputFramesHandler(handler) {
        this.inputFramesHandler = handler;
    }
    setOutputPlaybackHandler(handler) {
        this.outputPlaybackHandler = handler;
    }
    setOutputQueuePressureHandler(handler) {
        this.outputQueuePressureHandler = handler;
    }
    setOutputDebugHandler(handler) {
        this.outputDebugHandler = handler;
    }
    setOutputErrorHandler(handler) {
        this.outputErrorHandler = handler;
    }
    normalizeOutputFrames(frames, sampleRateHz, channels) {
        const outputRate = this.audioContext?.sampleRate;
        if (!outputRate)
            throw new Error("AudioContext is not initialized");
        return this.outputResampler.process(this.downmixToMono(frames, channels), sampleRateHz, outputRate);
    }
    enqueueInputDelivery(frames, sampleRateHz, channels) {
        if (!this.inputFramesHandler)
            return;
        const delivery = { frames, sampleRateHz, channels };
        if (this.inputDeliveryActive) {
            this.pendingInputDelivery = delivery;
            return;
        }
        const generation = this.inputDeliveryGeneration;
        this.inputDeliveryActive = true;
        void (async () => {
            let next = delivery;
            try {
                while (next && generation === this.inputDeliveryGeneration) {
                    const current = next;
                    this.pendingInputDelivery = null;
                    await this.inputFramesHandler?.(current.frames, current.sampleRateHz, current.channels);
                    next = this.pendingInputDelivery;
                }
            }
            catch (error) {
                this.outputDebugHandler?.(`[input] delivery failed: ${error instanceof Error ? error.message : String(error)}`);
            }
            finally {
                if (generation === this.inputDeliveryGeneration)
                    this.inputDeliveryActive = false;
            }
        })();
    }
    downmixToMono(frames, channels) {
        if (!Number.isInteger(channels) || channels < 1 || channels > 8) {
            throw new RangeError("VoiceCore output channels must be an integer from 1 to 8");
        }
        if (frames.length % channels !== 0) {
            throw new RangeError("VoiceCore output frame length must be divisible by channels");
        }
        if (channels <= 1) {
            return frames;
        }
        const frameCount = Math.floor(frames.length / channels);
        const mono = new Float32Array(frameCount);
        for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
            let sum = 0;
            const baseIndex = frameIndex * channels;
            for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
                sum += frames[baseIndex + channelIndex] ?? 0;
            }
            mono[frameIndex] = sum / channels;
        }
        return mono;
    }
    cancelPendingOutputRequests(message) {
        this.outputAdmissions.cancelAll(message);
    }
    withMediaStartTimeout(request, generation) {
        return new Promise((resolve, reject) => {
            let settled = false;
            const cancel = () => {
                if (settled)
                    return;
                settled = true;
                window.clearTimeout(timeoutId);
                reject(new Error("VoiceCore audio startup was cancelled"));
            };
            const timeoutId = window.setTimeout(() => {
                if (settled)
                    return;
                settled = true;
                if (this.pendingStartCancellation === cancel) {
                    this.pendingStartCancellation = null;
                }
                reject(new Error("VoiceCore microphone startup timed out"));
            }, AudioGraph.MEDIA_START_TIMEOUT_MS);
            this.pendingStartCancellation = cancel;
            request.then((stream) => {
                if (settled || generation !== this.startGeneration) {
                    stream.getTracks().forEach((track) => track.stop());
                    return;
                }
                settled = true;
                window.clearTimeout(timeoutId);
                if (this.pendingStartCancellation === cancel) {
                    this.pendingStartCancellation = null;
                }
                resolve(stream);
            }, (error) => {
                if (settled)
                    return;
                settled = true;
                window.clearTimeout(timeoutId);
                if (this.pendingStartCancellation === cancel) {
                    this.pendingStartCancellation = null;
                }
                reject(error);
            });
        });
    }
}
//# sourceMappingURL=AudioGraph.js.map