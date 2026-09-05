import { OutputAdmissionTracker } from "./OutputAdmissionTracker";
import { StreamingResampler } from "./StreamingResampler";
import { BoundedAudioDispatcher } from "./BoundedAudioDispatcher";
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
    inputErrorHandler = null;
    captureFailure = null;
    captureMonitoring = false;
    detachCaptureListeners = null;
    outputFlushedHandler = null;
    outputFlushSequence = 0;
    pendingOutputFlush = null;
    outputResampler = new StreamingResampler();
    inputResampler = new StreamingResampler();
    inputDelivery = new BoundedAudioDispatcher(async (audio) => { await this.inputFramesHandler?.(audio.frames, audio.sampleRateHz, audio.channels); }, (error) => this.reportInputFailure(error), "Microphone capture");
    inputDeliveryGeneration = 0;
    startGeneration = 0;
    pendingStartCancellation = null;
    outputAdmissions = new OutputAdmissionTracker(AudioGraph.OUTPUT_ACK_TIMEOUT_MS);
    async start(config) {
        this.cancelPendingStart();
        if (this.audioContext || this.mediaStream) {
            const stopping = this.stop();
            const cleanupGeneration = this.startGeneration;
            await stopping;
            if (cleanupGeneration !== this.startGeneration)
                throw new Error("VoiceCore audio startup was cancelled");
        }
        const AudioContextCtor = window.AudioContext ||
            window
                .webkitAudioContext;
        if (!AudioContextCtor) {
            throw new Error("AudioContext is not available in this browser");
        }
        const startGeneration = ++this.startGeneration;
        this.captureFailure = null;
        this.captureMonitoring = false;
        this.inputResampler.reset();
        this.inputDelivery.reset();
        let ownedContext = null;
        let ownedStream = null;
        try {
            const mediaRequest = navigator.mediaDevices.getUserMedia({
                audio: {
                    ...(config.inputDeviceId ? { deviceId: { exact: config.inputDeviceId } } : {}),
                    echoCancellation: config.echoCancellation ?? true,
                    noiseSuppression: config.noiseSuppression ?? true,
                    autoGainControl: config.autoGainControl ?? true,
                },
            });
            ownedStream = await this.withMediaStartTimeout(mediaRequest, startGeneration);
            if (startGeneration !== this.startGeneration) {
                ownedStream.getTracks().forEach((track) => track.stop());
                throw new Error("VoiceCore audio startup was cancelled");
            }
            this.mediaStream = ownedStream;
            ownedContext = new AudioContextCtor({ sampleRate: config.sampleRateHint ?? 48_000 });
            this.audioContext = ownedContext;
            if (config.outputDeviceId) {
                const audioContextWithSink = this.audioContext;
                if (typeof audioContextWithSink.setSinkId === "function") {
                    try {
                        await this.awaitStartupStep(audioContextWithSink.setSinkId(config.outputDeviceId), startGeneration);
                    }
                    catch (error) {
                        if (startGeneration !== this.startGeneration)
                            throw error;
                        throw new Error("The selected speaker could not be connected. Reconnect it or choose another output, then press Start.");
                    }
                }
                else if (config.outputDeviceId !== "default") {
                    throw new Error("This browser cannot select the requested speaker. Choose the system default output or use the desktop app.");
                }
            }
            await this.awaitStartupStep(ownedContext.audioWorklet.addModule(new URL("./input-worklet.js", import.meta.url)), startGeneration);
            await this.awaitStartupStep(ownedContext.audioWorklet.addModule(new URL("./output-worklet.js", import.meta.url)), startGeneration);
            this.sourceNode = new MediaStreamAudioSourceNode(this.audioContext, {
                mediaStream: this.mediaStream,
            });
            const minimumInputBatchFrames = Math.ceil((this.audioContext.sampleRate * 0.05) / 128) * 128;
            this.inputNode = new AudioWorkletNode(this.audioContext, "voice-core-input", {
                processorOptions: {
                    chunkSize: Math.max(config.inputBatchFrames ?? 2048, minimumInputBatchFrames),
                },
            });
            this.inputNode.onprocessorerror = () => {
                if (startGeneration === this.startGeneration)
                    this.reportInputFailure(new Error("Microphone processing stopped. Press Start to reconnect."));
            };
            const inputGeneration = this.inputDeliveryGeneration;
            this.inputNode.port.onmessage = (event) => {
                if (inputGeneration !== this.inputDeliveryGeneration || startGeneration !== this.startGeneration)
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
                if (startGeneration !== this.startGeneration)
                    return;
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
                if (event.data?.type === "outputFlushed") {
                    if (this.pendingOutputFlush === event.data.requestId) {
                        this.pendingOutputFlush = null;
                        this.outputFlushedHandler?.();
                    }
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
                if (startGeneration !== this.startGeneration)
                    return;
                const error = new Error("VoiceCore output worklet processor failed");
                this.cancelPendingOutputRequests(error.message);
                this.outputErrorHandler?.(error);
            };
            this.outputNode.connect(this.audioContext.destination);
            await this.awaitStartupStep(ownedContext.resume(), startGeneration);
            const context = this.audioContext;
            const tracks = this.mediaStream.getAudioTracks();
            if (context.state !== "running" || tracks.some((track) => track.readyState === "ended")) {
                throw new Error("Microphone or audio device is unavailable. Reconnect it and press Start.");
            }
            const onEnded = () => {
                if (startGeneration === this.startGeneration)
                    this.reportInputFailure(new Error("Microphone disconnected or permission was revoked. Reconnect the microphone and press Start."));
            };
            const onStateChange = () => {
                if (startGeneration === this.startGeneration && this.captureMonitoring && context.state !== "running") {
                    this.reportInputFailure(new Error("Audio paused or the computer went to sleep. Check your audio devices and press Start to reconnect."));
                }
            };
            tracks.forEach((track) => track.addEventListener("ended", onEnded));
            context.addEventListener("statechange", onStateChange);
            this.detachCaptureListeners = () => {
                tracks.forEach((track) => track.removeEventListener("ended", onEnded));
                context.removeEventListener("statechange", onStateChange);
            };
            this.captureMonitoring = true;
        }
        catch (error) {
            // A cancelled start must not tear down a replacement graph.
            if ((ownedContext !== null && this.audioContext === ownedContext)
                || (ownedStream !== null && this.mediaStream === ownedStream)) {
                await this.stop();
            }
            else {
                ownedStream?.getTracks().forEach((track) => track.stop());
                if (ownedContext && ownedContext.state !== "closed")
                    await ownedContext.close().catch(() => undefined);
            }
            throw error;
        }
    }
    async stop() {
        this.captureMonitoring = false;
        this.detachCaptureListeners?.();
        this.detachCaptureListeners = null;
        this.pendingOutputFlush = null;
        this.cancelPendingStart();
        this.inputDeliveryGeneration += 1;
        this.inputDelivery.reset();
        this.inputResampler.reset();
        this.cancelPendingOutputRequests("VoiceCore audio graph stopped");
        this.mediaStream?.getTracks().forEach((track) => track.stop());
        this.mediaStream = null;
        this.sourceNode?.disconnect();
        this.sourceNode = null;
        if (this.inputNode) {
            this.inputNode.port.onmessage = null;
            this.inputNode.onprocessorerror = null;
        }
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
        const context = this.audioContext;
        this.audioContext = null;
        this.outputResampler.reset();
        if (context)
            await context.close();
    }
    getSampleRate() {
        return this.audioContext?.sampleRate ?? null;
    }
    assertCaptureHealthy() {
        if (this.captureFailure)
            throw this.captureFailure;
        if (!this.audioContext || this.audioContext.state !== "running") {
            throw new Error("Audio is not running. Check your devices and press Start to reconnect.");
        }
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
        this.pendingOutputFlush = null;
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
        this.pendingOutputFlush = null;
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
    setOutputFlushedHandler(handler) {
        this.outputFlushedHandler = handler;
    }
    flushOutputQueue() {
        if (!this.outputNode || this.pendingOutputFlush !== null)
            return;
        const requestId = ++this.outputFlushSequence;
        this.pendingOutputFlush = requestId;
        this.outputNode.port.postMessage({ type: "flushOutput", requestId });
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
    setInputErrorHandler(handler) {
        this.inputErrorHandler = handler;
    }
    normalizeOutputFrames(frames, sampleRateHz, channels) {
        const outputRate = this.audioContext?.sampleRate;
        if (!outputRate)
            throw new Error("AudioContext is not initialized");
        return this.outputResampler.process(this.downmixToMono(frames, channels), sampleRateHz, outputRate);
    }
    enqueueInputDelivery(frames, sampleRateHz, channels) {
        if (!this.inputFramesHandler || this.captureFailure)
            return;
        try {
            // Interfaces can expose 96/192kHz contexts; native desktop STT accepts <=48kHz.
            const targetRate = Math.min(sampleRateHz, 48_000);
            const normalized = this.inputResampler.process(this.downmixToMono(frames, channels), sampleRateHz, targetRate);
            if (normalized.length === 0)
                return;
            this.inputDelivery.submit({ frames: normalized, sampleRateHz: targetRate, channels: 1 }, normalized.length / targetRate * 1_000);
        }
        catch (error) {
            this.reportInputFailure(error instanceof Error ? error : new Error(String(error)));
        }
    }
    reportInputFailure(error) {
        if (this.captureFailure)
            return;
        this.captureFailure = error;
        // Release the microphone immediately. Recovery requires a deliberate Start.
        void this.stop().catch(() => undefined);
        this.inputErrorHandler?.(error);
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
    async awaitStartupStep(operation, generation) {
        if (generation !== this.startGeneration)
            throw new Error("VoiceCore audio startup was cancelled");
        await new Promise((resolve, reject) => {
            let settled = false;
            const finish = (error) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                if (this.pendingStartCancellation === cancel)
                    this.pendingStartCancellation = null;
                if (error)
                    reject(error);
                else
                    resolve();
            };
            const cancel = () => finish(new Error("VoiceCore audio startup was cancelled"));
            const timer = setTimeout(() => finish(new Error("Audio device startup timed out. Reconnect your devices and press Start.")), AudioGraph.MEDIA_START_TIMEOUT_MS);
            this.pendingStartCancellation = cancel;
            operation.then(() => finish(), (error) => finish(error instanceof Error ? error : new Error(String(error))));
        });
        if (generation !== this.startGeneration)
            throw new Error("VoiceCore audio startup was cancelled");
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