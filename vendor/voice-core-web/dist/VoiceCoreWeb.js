import { AudioGraph } from "./audio/AudioGraph";
import { assertBrowserSupport, probeBrowserCapabilities } from "./runtime/featureProbe";
import { RuntimeWorkerClient } from "./runtime/worker";
import { SerialTaskQueue } from "./runtime/SerialTaskQueue";
import { validateVoiceRuntimeConfig } from "./runtime/config";
import { assertVoiceIdSupported } from "./voiceAssets";
export class VoiceCoreWeb {
    static OUTPUT_POLL_IDLE_MS = 25;
    static OUTPUT_POLL_ACTIVE_MS = 10;
    static STREAM_TEXT_FLUSH_INTERVAL_MS = 120;
    static MAX_OUTPUT_SECONDS_PER_DRAIN = 0.5;
    static MAX_OUTPUT_CHUNKS_PER_DRAIN = 3;
    static POST_SPEECH_STT_COOLDOWN_MS = 3000;
    static AEC_POST_SPEECH_STT_COOLDOWN_MS = 500;
    static BARGE_IN_COOLDOWN_MS = 500;
    static BARGE_IN_ECHO_CLEAN_THRESHOLD = 0.012;
    static BARGE_IN_NO_AEC_THRESHOLD = 0.03;
    static EMPTY_LLM_RETRY_MAX_OUTPUT_TOKENS = 320;
    audioGraph = new AudioGraph();
    runtimeWorker = new RuntimeWorkerClient();
    handlers = new Set();
    config;
    capabilities = null;
    state = "idle";
    runtimeStatus = "uninitialized";
    legacyState = "idle";
    running = false;
    drainingAudio = false;
    outputDrainGeneration = 0;
    outputPlaybackActive = false;
    outputBackpressured = false;
    drainTimerId = null;
    transports = {};
    sttUnsubscribe = null;
    sttErrorUnsubscribe = null;
    sttSendChain = Promise.resolve();
    sttLifecycleChain = Promise.resolve();
    sttLifecycleGeneration = 0;
    sttSendGeneration = 0;
    sttTransportRunning = false;
    sttTransportOwned = false;
    sttPausedForAssistant = false;
    sttRestartTimerId = null;
    responseAbortController = null;
    responseGeneration = 0;
    lastAssistantPreviewText = "";
    activeTurnStartedAtMs = null;
    userSpeechActive = false;
    bargeInFrameCount = 0;
    bargeInTriggered = false;
    bargeInGraceUntilMs = 0;
    bargeInLastTimeMs = 0;
    runtimeFailureActive = false;
    lifecycleQueue = new SerialTaskQueue();
    destroyed = false;
    cleanupRequired = false;
    constructor(config = {}) {
        const validatedConfig = validateVoiceRuntimeConfig(config);
        assertVoiceIdSupported(validatedConfig.voiceId);
        this.config = validatedConfig;
        this.audioGraph.setInputFramesHandler((frames, sampleRateHz, channels) => this.handleInputFrames(frames, sampleRateHz, channels));
        this.audioGraph.setOutputPlaybackHandler((active) => {
            void this.handleOutputPlaybackState(active).catch((error) => {
                void this.failRuntime(error instanceof Error ? error : new Error(String(error)));
            });
        });
        this.audioGraph.setOutputQueuePressureHandler((active, queuedSamples) => {
            this.handleOutputQueuePressure(active, queuedSamples);
        });
        this.audioGraph.setOutputDebugHandler((message) => {
            this.emit({ type: "debug", message });
        });
        this.audioGraph.setOutputErrorHandler((error) => {
            void this.failRuntime(error);
        });
        this.runtimeWorker.setMessageHandler((message) => {
            if (message.type === "events") {
                for (const event of message.events) {
                    if (event.type === "bargeIn") {
                        this.audioGraph.clearOutputQueue();
                        this.outputPlaybackActive = false;
                        this.outputBackpressured = false;
                        this.resetBargeInDetector();
                    }
                    if (event.type === "stateChanged") {
                        this.state = event.state;
                        this.legacyState = event.state;
                        this.syncBargeInWindowForState(event.state);
                        this.syncSttTransportForState(event.state);
                    }
                    this.emitNormalizedEvent(event);
                }
            }
            else if (message.type === "error") {
                void this.failRuntime(new Error(message.message));
            }
        });
    }
    async start() {
        return this.enqueueLifecycle(() => this.startInternal());
    }
    async startInternal() {
        if (this.destroyed) {
            throw new Error("VoiceCore has been destroyed");
        }
        if (this.running) {
            return;
        }
        if (this.cleanupRequired) {
            await this.stopInternal();
        }
        try {
            this.cleanupRequired = true;
            this.setRuntimeStatus("starting");
            this.assertCommercialAccess();
            this.outputBackpressured = false;
            this.sttPausedForAssistant = false;
            this.userSpeechActive = false;
            this.resetBargeInDetector();
            this.capabilities = probeBrowserCapabilities();
            this.emit({ type: "capabilities", capabilities: this.capabilities });
            assertBrowserSupport(this.config, this.capabilities);
            await this.runtimeWorker.init(this.config);
            await this.audioGraph.start(this.config);
            await this.runtimeWorker.setConfig({
                ...this.config,
                outputSampleRateHz: this.audioGraph.getSampleRate() ?? undefined,
            });
            await this.runtimeWorker.start();
            await this.startTransports();
            this.setRuntimeStatus("running");
            this.cleanupRequired = false;
            this.scheduleDrainOutputAudio(0);
        }
        catch (error) {
            const rollback = await Promise.allSettled([
                this.audioGraph.stop(),
                this.stopTransports(),
                this.runtimeWorker.stop(),
            ]);
            this.runtimeWorker.destroy();
            this.cleanupRequired = rollback.some((result) => result.status === "rejected");
            this.setRuntimeStatus("error");
            this.emit({
                type: "error",
                message: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
    async stop() {
        this.audioGraph.cancelPendingStart();
        this.transports.stt?.cancelStart?.();
        return this.enqueueLifecycle(() => this.stopInternal());
    }
    async stopInternal() {
        if (!this.running && !this.cleanupRequired) {
            return;
        }
        this.setRuntimeStatus("stopping");
        this.running = false;
        const cleanupErrors = [];
        try {
            this.abortResponsePipeline();
            const results = await Promise.allSettled([
                this.stopTransports(),
                this.runtimeWorker.stop(),
            ]);
            for (const result of results) {
                if (result.status === "rejected")
                    cleanupErrors.push(result.reason);
            }
        }
        finally {
            this.clearDrainTimer();
            this.clearSttRestartTimer();
            this.outputPlaybackActive = false;
            this.outputBackpressured = false;
            this.sttPausedForAssistant = false;
            this.userSpeechActive = false;
            this.resetBargeInDetector();
            try {
                await this.audioGraph.stop();
            }
            catch (error) {
                cleanupErrors.push(error);
            }
            if (cleanupErrors.length === 0) {
                this.cleanupRequired = false;
                this.setRuntimeStatus("stopped");
            }
            else {
                this.cleanupRequired = true;
                this.setRuntimeStatus("error");
            }
        }
        if (cleanupErrors.length > 0) {
            throw new AggregateError(cleanupErrors, "VoiceCore stop cleanup failed");
        }
    }
    async destroy() {
        this.audioGraph.cancelPendingStart();
        this.transports.stt?.cancelStart?.();
        return this.enqueueLifecycle(async () => {
            if (this.destroyed)
                return;
            let stopError;
            try {
                await this.stopInternal();
            }
            catch (error) {
                stopError = error;
            }
            finally {
                this.runtimeWorker.destroy();
                this.handlers.clear();
                this.destroyed = true;
            }
            if (stopError !== undefined)
                throw stopError;
        });
    }
    isRunning() {
        return this.running;
    }
    async setConfig(config) {
        const nextConfig = validateVoiceRuntimeConfig({ ...this.config, ...config });
        assertVoiceIdSupported(nextConfig.voiceId);
        if (this.destroyed)
            throw new Error("VoiceCore has been destroyed");
        if (this.running) {
            throw new Error("VoiceCore configuration can only change while stopped");
        }
        this.config = nextConfig;
    }
    assertCommercialAccess() {
        if (!this.config.requireCommercialAccess) {
            return;
        }
        const sessionToken = this.config.sessionToken?.trim();
        if (!sessionToken) {
            throw new Error("Commercial web access requires a short-lived session token from your backend.");
        }
    }
    async setTransports(transports) {
        return this.enqueueLifecycle(() => this.setTransportsInternal(transports));
    }
    async setTransportsInternal(transports) {
        if (this.destroyed)
            throw new Error("VoiceCore has been destroyed");
        if (!this.running) {
            this.transports = transports;
            return;
        }
        const previous = this.transports;
        await this.stopTransports();
        this.transports = transports;
        try {
            await this.startTransports();
        }
        catch (replacementError) {
            try {
                await this.stopTransports();
            }
            catch (replacementCleanupError) {
                this.cleanupRequired = true;
                await this.stopInternal().catch(() => undefined);
                throw new AggregateError([replacementError, replacementCleanupError], "VoiceCore replacement transport start and cleanup failed");
            }
            this.transports = previous;
            try {
                await this.startTransports();
            }
            catch (rollbackError) {
                this.cleanupRequired = true;
                await this.stopInternal().catch(() => undefined);
                throw new AggregateError([replacementError, rollbackError], "VoiceCore transport replacement and rollback failed");
            }
            throw replacementError;
        }
    }
    async pushPartialTranscript(text) {
        await this.runtimeWorker.pushPartialTranscript(text);
    }
    async completeUserTranscript(text) {
        this.abortResponsePipeline();
        this.activeTurnStartedAtMs = Date.now();
        await this.runtimeWorker.completeUserTranscript(text);
        this.emitLatencyDebug("stt-final");
        this.scheduleDrainOutputAudio(0);
        await this.generateAssistantResponse(text);
    }
    async pushAssistantText(text, isFinal = true) {
        await this.runtimeWorker.pushAssistantText(text, isFinal);
        this.scheduleDrainOutputAudio(0);
    }
    async pushTtsAudio(samples, sampleRateHz, channels, timestampMs = 0) {
        if (!this.running) {
            throw new Error("VoiceCore must be running before pushing TTS audio");
        }
        const payload = Array.isArray(samples) ? Int16Array.from(samples) : samples;
        await this.pushTtsAudioSlices(payload, sampleRateHz, channels, timestampMs, () => this.running);
    }
    async pushTtsAudioSlices(payload, sampleRateHz, channels, timestampMs, shouldContinue) {
        if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
            throw new RangeError("VoiceCore TTS sample rate must be positive");
        }
        if (!Number.isInteger(channels) || channels < 1 || channels > 8) {
            throw new RangeError("VoiceCore TTS channels must be an integer from 1 to 8");
        }
        if (payload.length % channels !== 0) {
            throw new RangeError("VoiceCore TTS samples must be divisible by channels");
        }
        if (!payload.length)
            return;
        const samplesPerSlice = Math.max(channels, Math.floor(sampleRateHz * 0.1) * channels);
        for (let offset = 0; offset < payload.length; offset += samplesPerSlice) {
            const slice = payload.slice(offset, offset + samplesPerSlice);
            while (shouldContinue()) {
                if (await this.runtimeWorker.pushTtsAudio(slice, sampleRateHz, channels, timestampMs)) {
                    break;
                }
                if (!shouldContinue())
                    return;
                this.scheduleDrainOutputAudio(0);
                await new Promise((resolve) => window.setTimeout(resolve, VoiceCoreWeb.OUTPUT_POLL_ACTIVE_MS));
            }
            if (!shouldContinue())
                return;
        }
        this.scheduleDrainOutputAudio(0);
    }
    async getContextJson() {
        return this.runtimeWorker.getContextJson();
    }
    async getInputStats() {
        const statsJson = await this.runtimeWorker.getInputStatsJson();
        return JSON.parse(statsJson);
    }
    getCapabilities() {
        return this.capabilities;
    }
    getSdkCapabilities() {
        return {
            runtimeSetters: false,
            toolCalling: false,
            diagnostics: true,
            conversationItems: false,
            sessionUpdate: false,
            commercialWebGate: true,
            platformAudio: true,
            voiceAssets: false,
            pocketModelInstall: false,
            pocketLocalInference: false,
            pocketVoiceExport: false,
            pocketRuntimeMode: "unavailable",
            localStt: false,
            moonshineCompiled: false,
            moonshineRuntimeAvailable: false,
            moonshineModelReady: false,
            moonshineModelInstall: false,
            moonshineRuntimeMode: "unavailable",
            moonshineInstallState: "unavailable",
            moonshinePreparationState: "idle",
            moonshineSupportStatus: "unavailable",
        };
    }
    async getPocketInstallStatus() {
        return { state: "unavailable" };
    }
    async installPocketModel() {
        throw new Error("Pocket model installation is unavailable in this Web build.");
    }
    async cancelPocketModelInstall() {
        return { state: "unavailable" };
    }
    async removePocketModel() {
        throw new Error("Pocket model installation is unavailable in this Web build.");
    }
    async listVoices() {
        throw new Error("Host-managed voice assets are unavailable in this Web build.");
    }
    async activateVoice(_voiceId) {
        throw new Error("Host-managed voice assets are unavailable in this Web build.");
    }
    onEvent(handler) {
        this.handlers.add(handler);
        return () => {
            this.handlers.delete(handler);
        };
    }
    emit(event) {
        for (const handler of this.handlers) {
            handler(event);
        }
    }
    emitNormalizedEvent(event) {
        this.emit(event);
        if (event.type === "assistantAudioStart") {
            this.emit({ type: "agentSpeechStarted" });
        }
        else if (event.type === "assistantAudioStop") {
            this.emit({ type: "agentSpeechComplete" });
        }
        else if (event.type === "bargeIn") {
            this.emit({ type: "bargeInDetected" });
        }
    }
    setRuntimeStatus(status) {
        const from = this.runtimeStatus;
        this.runtimeStatus = status;
        this.running = status === "starting" || status === "running";
        this.emit({ type: "runtimeStatusChanged", status, from, to: status });
        // Preserve legacy mixed-state notifications for existing callers.
        const legacyFrom = this.legacyState;
        const legacyState = status === "running"
            ? this.state
            : status === "uninitialized" || status === "stopped"
                ? "idle"
                : status;
        this.legacyState = legacyState;
        this.emit({ type: "legacyStateChanged", state: legacyState, from: legacyFrom, to: legacyState });
    }
    async drainOutputAudio() {
        if (this.drainingAudio || !this.running) {
            return;
        }
        this.drainingAudio = true;
        const generation = this.outputDrainGeneration;
        try {
            let emittedAudio = false;
            let emittedChunks = 0;
            let emittedSeconds = 0;
            while (this.running && !this.outputBackpressured) {
                const chunkJson = await this.runtimeWorker.popAudioChunk();
                if (!this.running || generation !== this.outputDrainGeneration)
                    break;
                if (!chunkJson || chunkJson === "null") {
                    break;
                }
                const chunk = JSON.parse(chunkJson);
                if (!chunk.samples.length) {
                    continue;
                }
                const frames = new Float32Array(chunk.samples.length);
                for (let i = 0; i < chunk.samples.length; i += 1) {
                    frames[i] = chunk.samples[i] / 32768;
                }
                try {
                    await this.audioGraph.enqueueOutputFrames(frames, chunk.sample_rate_hz, chunk.channels);
                }
                catch (error) {
                    if (!this.running || generation !== this.outputDrainGeneration)
                        break;
                    throw error;
                }
                if (!this.running || generation !== this.outputDrainGeneration)
                    break;
                emittedAudio = true;
                emittedChunks += 1;
                emittedSeconds +=
                    chunk.sample_rate_hz > 0
                        ? chunk.samples.length / chunk.sample_rate_hz / Math.max(1, chunk.channels)
                        : 0;
                if (emittedChunks >= VoiceCoreWeb.MAX_OUTPUT_CHUNKS_PER_DRAIN ||
                    emittedSeconds >= VoiceCoreWeb.MAX_OUTPUT_SECONDS_PER_DRAIN) {
                    break;
                }
            }
            if (this.running &&
                (this.state === "speaking" ||
                    this.state === "thinking" ||
                    this.outputPlaybackActive ||
                    this.responseAbortController !== null)) {
                this.scheduleDrainOutputAudio(this.outputBackpressured
                    ? VoiceCoreWeb.OUTPUT_POLL_IDLE_MS
                    : emittedAudio
                        ? VoiceCoreWeb.OUTPUT_POLL_ACTIVE_MS
                        : VoiceCoreWeb.OUTPUT_POLL_IDLE_MS);
            }
        }
        finally {
            this.drainingAudio = false;
        }
    }
    async handleInputFrames(frames, sampleRateHz, channels) {
        if (!this.running || !frames.length) {
            return;
        }
        this.detectLocalBargeIn(frames);
        const pcm16 = new Int16Array(frames.length);
        for (let i = 0; i < frames.length; i += 1) {
            const clamped = Math.max(-1, Math.min(1, frames[i]));
            pcm16[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
        }
        await this.runtimeWorker.feedInputAudio(pcm16, sampleRateHz, channels);
        if (this.transports.stt) {
            this.enqueueSttSend(new Int16Array(pcm16), sampleRateHz, channels);
        }
    }
    scheduleDrainOutputAudio(delayMs) {
        if (!this.running || this.drainTimerId !== null) {
            return;
        }
        this.drainTimerId = window.setTimeout(() => {
            this.drainTimerId = null;
            void this.drainOutputAudio().catch((error) => {
                void this.failRuntime(error instanceof Error ? error : new Error(String(error)));
            });
        }, delayMs);
    }
    clearDrainTimer() {
        if (this.drainTimerId === null) {
            return;
        }
        window.clearTimeout(this.drainTimerId);
        this.drainTimerId = null;
    }
    async failRuntime(error) {
        if (this.runtimeFailureActive || !this.running)
            return;
        this.runtimeFailureActive = true;
        this.emit({ type: "error", message: error.message });
        try {
            await this.stop();
        }
        catch (cleanupError) {
            this.emit({
                type: "error",
                message: cleanupError instanceof Error
                    ? cleanupError.message
                    : String(cleanupError),
            });
        }
        finally {
            this.setRuntimeStatus("error");
            this.runtimeFailureActive = false;
        }
    }
    enqueueLifecycle(operation) {
        return this.lifecycleQueue.run(operation);
    }
    async handleOutputPlaybackState(active) {
        this.outputPlaybackActive = active;
        if (active) {
            this.emitLatencyDebug("audio-playback-start");
            this.scheduleDrainOutputAudio(0);
            return;
        }
        await this.runtimeWorker.notifyOutputPlaybackFinished();
    }
    handleOutputQueuePressure(active, queuedSamples) {
        if (this.outputBackpressured === active) {
            return;
        }
        this.outputBackpressured = active;
        this.emit({
            type: "debug",
            message: active
                ? `[output] backpressure on queuedSamples=${queuedSamples}`
                : `[output] backpressure off queuedSamples=${queuedSamples}`,
        });
        if (!active) {
            this.scheduleDrainOutputAudio(0);
        }
    }
    async startTransports() {
        this.sttLifecycleGeneration += 1;
        this.sttSendGeneration += 1;
        this.sttSendChain = Promise.resolve();
        await this.sttLifecycleChain.catch(() => undefined);
        this.sttTransportRunning = false;
        this.sttPausedForAssistant = false;
        this.clearSttRestartTimer();
        if (!this.transports.stt) {
            return;
        }
        this.sttUnsubscribe?.();
        this.sttErrorUnsubscribe?.();
        this.sttUnsubscribe = this.transports.stt.onTranscript((event) => {
            void this.handleSttTranscript(event).catch((error) => {
                this.emit({
                    type: "error",
                    message: error instanceof Error ? error.message : String(error),
                });
            });
        });
        this.sttErrorUnsubscribe = this.transports.stt.onError?.((error) => {
            this.emit({
                type: "error",
                message: error.message,
            });
        }) ?? null;
        if (this.state === "thinking" || this.state === "speaking") {
            this.sttPausedForAssistant = true;
            return;
        }
        const transport = this.transports.stt;
        this.sttTransportOwned = true;
        try {
            await transport.start();
            this.sttTransportRunning = true;
        }
        catch (startError) {
            this.sttUnsubscribe?.();
            this.sttErrorUnsubscribe?.();
            this.sttUnsubscribe = null;
            this.sttErrorUnsubscribe = null;
            const cleanupResult = await Promise.allSettled([transport.stop()]);
            const cleanupError = cleanupResult[0].status === "rejected"
                ? cleanupResult[0].reason
                : undefined;
            if (cleanupError === undefined)
                this.sttTransportOwned = false;
            if (cleanupError !== undefined) {
                throw new AggregateError([startError, cleanupError], "VoiceCore STT start and rollback failed");
            }
            throw startError;
        }
    }
    async stopTransports() {
        const cleanupErrors = [];
        this.sttLifecycleGeneration += 1;
        this.sttSendGeneration += 1;
        this.sttUnsubscribe?.();
        this.sttErrorUnsubscribe?.();
        this.sttUnsubscribe = null;
        this.sttErrorUnsubscribe = null;
        this.clearSttRestartTimer();
        this.sttPausedForAssistant = false;
        await this.sttLifecycleChain.catch(() => undefined);
        if (this.transports.stt && this.sttTransportOwned) {
            try {
                await this.transports.stt.stop();
                this.sttTransportRunning = false;
                this.sttTransportOwned = false;
            }
            catch (error) {
                cleanupErrors.push(error);
            }
        }
        if (this.transports.tts?.stop) {
            try {
                await this.transports.tts.stop();
            }
            catch (error) {
                cleanupErrors.push(error);
            }
        }
        if (cleanupErrors.length > 0) {
            throw new AggregateError(cleanupErrors, "VoiceCore transport cleanup failed");
        }
    }
    async handleSttTranscript(event) {
        if (!this.running ||
            this.sttPausedForAssistant ||
            this.state === "thinking" ||
            this.state === "speaking") {
            return;
        }
        if (event.type === "partial") {
            this.markUserSpeechStarted();
            await this.pushPartialTranscript(event.text);
            return;
        }
        this.markUserSpeechStarted();
        await this.completeUserTranscript(event.text);
        this.userSpeechActive = false;
    }
    abortResponsePipeline() {
        this.responseGeneration += 1;
        this.outputDrainGeneration += 1;
        this.responseAbortController?.abort();
        this.responseAbortController = null;
        this.lastAssistantPreviewText = "";
        this.outputBackpressured = false;
        this.audioGraph.clearOutputQueue();
        this.outputPlaybackActive = false;
        this.resetBargeInDetector();
    }
    syncSttTransportForState(state) {
        if (!this.transports.stt || !this.running) {
            return;
        }
        if (state === "thinking" || state === "speaking") {
            this.clearSttRestartTimer();
            this.sttPausedForAssistant = true;
            this.sttSendGeneration += 1;
            this.sttSendChain = Promise.resolve();
            const generation = this.sttLifecycleGeneration;
            const transport = this.transports.stt;
            this.queueSttLifecycle(async () => {
                if (generation !== this.sttLifecycleGeneration ||
                    !transport ||
                    !this.sttTransportOwned) {
                    return;
                }
                await transport.stop();
                if (generation === this.sttLifecycleGeneration) {
                    this.sttTransportRunning = false;
                    this.sttTransportOwned = false;
                }
            });
            return;
        }
        if (state !== "listening" || !this.sttPausedForAssistant) {
            return;
        }
        this.clearSttRestartTimer();
        this.sttRestartTimerId = window.setTimeout(() => {
            this.sttRestartTimerId = null;
            const generation = this.sttLifecycleGeneration;
            const transport = this.transports.stt;
            this.queueSttLifecycle(async () => {
                if (generation !== this.sttLifecycleGeneration ||
                    !this.running ||
                    !transport ||
                    this.state !== "listening" ||
                    !this.sttPausedForAssistant ||
                    this.sttTransportRunning) {
                    return;
                }
                this.sttTransportOwned = true;
                await transport.start();
                if (generation !== this.sttLifecycleGeneration || !this.running) {
                    try {
                        await transport.stop();
                        this.sttTransportOwned = false;
                    }
                    catch {
                        // stopTransports observes ownership and retries after this chain.
                    }
                    return;
                }
                this.sttTransportRunning = true;
                this.sttPausedForAssistant = false;
            });
        }, this.getPostSpeechSttCooldownMs());
    }
    queueSttLifecycle(task) {
        this.sttLifecycleChain = this.sttLifecycleChain
            .catch(() => undefined)
            .then(task)
            .catch((error) => {
            this.emit({
                type: "error",
                message: error instanceof Error ? error.message : String(error),
            });
        });
    }
    clearSttRestartTimer() {
        if (this.sttRestartTimerId === null) {
            return;
        }
        window.clearTimeout(this.sttRestartTimerId);
        this.sttRestartTimerId = null;
    }
    getPostSpeechSttCooldownMs() {
        return this.config.echoCancellation === false
            ? VoiceCoreWeb.POST_SPEECH_STT_COOLDOWN_MS
            : VoiceCoreWeb.AEC_POST_SPEECH_STT_COOLDOWN_MS;
    }
    syncBargeInWindowForState(state) {
        const now = Date.now();
        if (state === "speaking") {
            this.resetBargeInDetector();
            this.bargeInGraceUntilMs =
                now + (this.config.echoCancellation === false ? 1500 : 300);
            return;
        }
        if (state === "thinking") {
            this.resetBargeInDetector();
            this.bargeInGraceUntilMs =
                now + (this.config.echoCancellation === false ? 750 : 150);
            return;
        }
        this.bargeInGraceUntilMs = 0;
        if (state === "listening" || state === "idle") {
            this.resetBargeInDetector();
        }
    }
    markUserSpeechStarted() {
        if (this.userSpeechActive) {
            return;
        }
        this.userSpeechActive = true;
        this.emit({ type: "userSpeechStarted" });
    }
    detectLocalBargeIn(frames) {
        if (this.state !== "speaking" && this.state !== "thinking") {
            this.resetBargeInDetector();
            return;
        }
        const now = Date.now();
        if (now < this.bargeInGraceUntilMs) {
            return;
        }
        if (this.bargeInLastTimeMs > 0 && now - this.bargeInLastTimeMs < VoiceCoreWeb.BARGE_IN_COOLDOWN_MS) {
            return;
        }
        let sumSq = 0;
        for (let i = 0; i < frames.length; i += 1) {
            sumSq += frames[i] * frames[i];
        }
        const rms = Math.sqrt(sumSq / Math.max(1, frames.length));
        const threshold = this.config.echoCancellation === false
            ? VoiceCoreWeb.BARGE_IN_NO_AEC_THRESHOLD
            : VoiceCoreWeb.BARGE_IN_ECHO_CLEAN_THRESHOLD;
        if (rms < threshold) {
            this.bargeInFrameCount = 0;
            this.bargeInTriggered = false;
            return;
        }
        this.bargeInFrameCount += 1;
        const minFrames = this.config.echoCancellation === false ? 7 : 3;
        const confirmationFrames = this.config.echoCancellation === false ? 5 : 2;
        const triggerThreshold = minFrames;
        const confirmThreshold = minFrames + confirmationFrames;
        if (this.bargeInFrameCount < triggerThreshold) {
            return;
        }
        if (!this.bargeInTriggered) {
            this.bargeInTriggered = true;
            return;
        }
        if (this.bargeInFrameCount >= confirmThreshold) {
            this.executeLocalBargeIn();
        }
    }
    executeLocalBargeIn() {
        this.bargeInLastTimeMs = Date.now();
        this.markUserSpeechStarted();
        this.abortResponsePipeline();
        void this.runtimeWorker.triggerBargeIn().catch((error) => {
            void this.failRuntime(error instanceof Error ? error : new Error(String(error)));
        });
    }
    resetBargeInDetector() {
        this.bargeInFrameCount = 0;
        this.bargeInTriggered = false;
    }
    async generateAssistantResponse(userText) {
        if (!this.transports.llm) {
            return;
        }
        const generation = this.responseGeneration + 1;
        this.responseGeneration = generation;
        const controller = new AbortController();
        this.responseAbortController = controller;
        let synthesisChain = Promise.resolve();
        let assistantText = "";
        let speakableBuffer = "";
        try {
            const contextJson = await this.getContextJson();
            this.emitLatencyDebug("llm-request-start");
            ({
                assistantText,
                speakableBuffer,
                synthesisChain,
            } = await this.streamAssistantReply(userText, contextJson, controller, generation, synthesisChain));
            if (!assistantText.trim()) {
                ({
                    assistantText,
                    speakableBuffer,
                    synthesisChain,
                } = await this.streamAssistantReply(`${userText}\n\nRespond in one short sentence only.`, contextJson, controller, generation, synthesisChain, VoiceCoreWeb.EMPTY_LLM_RETRY_MAX_OUTPUT_TOKENS));
            }
            if (controller.signal.aborted || generation !== this.responseGeneration) {
                return;
            }
            if (!assistantText.trim() || !this.transports.tts) {
                await this.pushAssistantText(assistantText, true);
                this.lastAssistantPreviewText = "";
                return;
            }
            const finalTail = speakableBuffer.trim();
            if (finalTail) {
                const speakableTail = this.prepareTextForTts(finalTail);
                if (speakableTail) {
                    synthesisChain = synthesisChain.then(async () => {
                        if (controller.signal.aborted || generation !== this.responseGeneration) {
                            return;
                        }
                        await this.synthesizeAssistantChunk(speakableTail, controller, generation);
                    });
                }
            }
            await synthesisChain;
            await this.runtimeWorker.flushOutputAudio();
            this.scheduleDrainOutputAudio(0);
            if (controller.signal.aborted || generation !== this.responseGeneration) {
                return;
            }
            await this.pushAssistantText(assistantText, true);
            this.lastAssistantPreviewText = "";
        }
        catch (error) {
            if (controller.signal.aborted || generation !== this.responseGeneration) {
                return;
            }
            controller.abort();
            await synthesisChain.catch(() => undefined);
            this.emit({
                type: "error",
                message: error instanceof Error ? error.message : String(error),
            });
            this.lastAssistantPreviewText = "";
            this.activeTurnStartedAtMs = null;
            await this.runtimeWorker.startListening();
        }
        finally {
            if (this.responseAbortController === controller) {
                this.responseAbortController = null;
            }
        }
    }
    float32ToPcm16(frames) {
        const pcm16 = new Int16Array(frames.length);
        for (let i = 0; i < frames.length; i += 1) {
            const clamped = Math.max(-1, Math.min(1, frames[i]));
            pcm16[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
        }
        return pcm16;
    }
    async streamAssistantReply(userText, contextJson, controller, generation, synthesisChain, maxOutputTokens) {
        if (!this.transports.llm) {
            return {
                assistantText: "",
                speakableBuffer: "",
                synthesisChain,
            };
        }
        const tokenStream = await this.transports.llm.generateReply({
            userText,
            contextJson,
            signal: controller.signal,
            maxOutputTokens,
        });
        let assistantText = "";
        let speakableBuffer = "";
        let lastPreviewFlushAt = 0;
        let sawFirstToken = false;
        for await (const token of tokenStream) {
            if (controller.signal.aborted || generation !== this.responseGeneration) {
                return {
                    assistantText,
                    speakableBuffer,
                    synthesisChain,
                };
            }
            assistantText += token.text;
            speakableBuffer += token.text;
            if (!sawFirstToken && token.text) {
                sawFirstToken = true;
                this.emitLatencyDebug("llm-first-token");
            }
            const previewShouldFlush = token.done === true ||
                Date.now() - lastPreviewFlushAt >= VoiceCoreWeb.STREAM_TEXT_FLUSH_INTERVAL_MS;
            if (previewShouldFlush && assistantText !== this.lastAssistantPreviewText) {
                this.lastAssistantPreviewText = assistantText;
                await this.pushAssistantText(assistantText, false);
                lastPreviewFlushAt = Date.now();
            }
            const extraction = this.extractSpeakableText(speakableBuffer, token.done === true);
            speakableBuffer = extraction.remainder;
            if (extraction.readyText && this.transports.tts) {
                this.emitLatencyDebug("tts-chunk-ready");
                const speakableText = this.prepareTextForTts(extraction.readyText);
                if (!speakableText) {
                    continue;
                }
                synthesisChain = synthesisChain.then(async () => {
                    if (controller.signal.aborted || generation !== this.responseGeneration) {
                        return;
                    }
                    await this.synthesizeAssistantChunk(speakableText, controller, generation);
                });
            }
            if (token.done) {
                break;
            }
        }
        return {
            assistantText,
            speakableBuffer,
            synthesisChain,
        };
    }
    // Native conversational runtime starts incremental TTS once a punctuation
    // boundary yields at least 24 chars. It only falls back to a comma split
    // once the buffer gets quite long.
    static MIN_INCREMENTAL_TTS_CHUNK_CHARS = 24;
    static CLAUSE_FALLBACK_CHARS = 120;
    extractSpeakableText(text, allowIncompleteTail) {
        const trimmed = text.trimStart();
        if (!trimmed) {
            return { readyText: "", remainder: "" };
        }
        const boundaryIndex = this.findFirstSpeakableBoundary(trimmed);
        if (boundaryIndex > 0) {
            const readyText = trimmed.slice(0, boundaryIndex).trim();
            const remainder = trimmed.slice(boundaryIndex).trimStart();
            return { readyText, remainder };
        }
        // Native fallback: once the buffer is long, split on a comma boundary.
        if (!allowIncompleteTail && trimmed.length >= VoiceCoreWeb.CLAUSE_FALLBACK_CHARS) {
            const clauseIndex = this.findLastClauseBoundary(trimmed);
            if (clauseIndex > 0) {
                const readyText = trimmed.slice(0, clauseIndex).trim();
                const remainder = trimmed.slice(clauseIndex).trimStart();
                return { readyText, remainder };
            }
        }
        // If the stream ended, flush whatever remains.
        if (allowIncompleteTail) {
            return { readyText: trimmed, remainder: "" };
        }
        return { readyText: "", remainder: trimmed };
    }
    findLastClauseBoundary(text) {
        let lastIndex = -1;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (ch === ",") {
                const next = text[i + 1];
                if (next === " ") {
                    lastIndex = i + 1;
                }
            }
        }
        return lastIndex;
    }
    findFirstSpeakableBoundary(text) {
        for (let index = 0; index < text.length; index += 1) {
            const char = text[index];
            if (!".!?;:\n".includes(char)) {
                continue;
            }
            const candidate = text.slice(0, index + 1).trim();
            if ([...candidate].length < VoiceCoreWeb.MIN_INCREMENTAL_TTS_CHUNK_CHARS) {
                continue;
            }
            const nextChar = text[index + 1];
            if (nextChar !== undefined &&
                nextChar !== " " &&
                nextChar !== "\n" &&
                nextChar !== "\"" &&
                nextChar !== "'" &&
                nextChar !== ")" &&
                nextChar !== "]") {
                continue;
            }
            return index + 1;
        }
        return -1;
    }
    async synthesizeAssistantChunk(text, controller, generation) {
        if (!this.transports.tts || !text.trim()) {
            return;
        }
        this.emitLatencyDebug(`tts-request-start chars=${text.length}`);
        const audioStream = await this.transports.tts.synthesize({
            text,
            signal: controller.signal,
        });
        let sawFirstChunk = false;
        for await (const chunk of audioStream) {
            if (controller.signal.aborted || generation !== this.responseGeneration) {
                return;
            }
            if (!sawFirstChunk) {
                sawFirstChunk = true;
                this.emitLatencyDebug("tts-first-audio-chunk");
            }
            await this.pushTtsAudioSlices(this.float32ToPcm16(chunk.frames), chunk.sampleRate, chunk.channels, 0, () => this.running &&
                !controller.signal.aborted &&
                generation === this.responseGeneration);
        }
    }
    emitLatencyDebug(label) {
        if (this.activeTurnStartedAtMs === null) {
            return;
        }
        const elapsedMs = Date.now() - this.activeTurnStartedAtMs;
        this.emit({
            type: "debug",
            message: `[latency] ${label} +${elapsedMs}ms`,
        });
    }
    prepareTextForTts(text) {
        return text
            .replace(/\r\n/g, "\n")
            .replace(/\n\s*[-*•]\s+/g, ". ")
            .replace(/\n\s*\d+\.\s+/g, ". ")
            .replace(/:\s*\n+/g, ". ")
            .replace(/\n+/g, ". ")
            .replace(/\s+/g, " ")
            .trim();
    }
    enqueueSttSend(samples, sampleRateHz, channels) {
        if (!this.transports.stt) {
            return;
        }
        const generation = this.sttSendGeneration;
        this.sttSendChain = this.sttSendChain
            .catch(() => undefined)
            .then(async () => {
            if (generation !== this.sttSendGeneration ||
                !this.running ||
                !this.transports.stt) {
                return;
            }
            await this.transports.stt.sendAudio(samples, sampleRateHz, channels);
        })
            .catch((error) => {
            if (generation !== this.sttSendGeneration) {
                return;
            }
            this.emit({
                type: "error",
                message: error instanceof Error ? error.message : String(error),
            });
        });
    }
}
//# sourceMappingURL=VoiceCoreWeb.js.map