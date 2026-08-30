import { assertSecureWebSocketSessionTarget, validateVoiceCoreSessionToken, } from "../sessionSecurity.js";
const ASSEMBLYAI_STREAMING_URL = "wss://streaming.assemblyai.com/v3/ws";
const DEFAULT_SAMPLE_RATE_HZ = 16_000;
const CONNECT_TIMEOUT_MS = 10_000;
const CLOSE_TIMEOUT_MS = 2_000;
export function createAssemblyAiSttTransport(options) {
    return new AssemblyAiSttTransport(validateAssemblyOptions(options));
}
export function createAssemblyAiTemporaryTokenFetcher(endpoint, init) {
    return async (signal) => {
        const response = await fetch(endpoint, {
            ...init,
            method: init?.method ?? "POST",
            signal: combineAbortSignals(init?.signal, signal),
        });
        if (!response.ok) {
            throw new Error(`AssemblyAI token request failed: ${response.status} ${response.statusText}`);
        }
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
            const payload = await response.json();
            if ("token" in payload && typeof payload.token === "string") {
                return payload.token;
            }
            if ("temporary_token" in payload && typeof payload.temporary_token === "string") {
                return payload.temporary_token;
            }
            throw new Error("AssemblyAI token response JSON did not contain a token");
        }
        const token = (await response.text()).trim();
        if (!token) {
            throw new Error("AssemblyAI token response was empty");
        }
        return token;
    };
}
class AssemblyAiSttTransport {
    options;
    handlers = new Set();
    errorHandlers = new Set();
    socket = null;
    startPromise = null;
    manualStop = false;
    cancelConnection = null;
    startAbortController = null;
    constructor(options) {
        this.options = options;
    }
    async start() {
        if (this.socket?.readyState === WebSocket.OPEN) {
            return;
        }
        if (this.startPromise) {
            return this.startPromise;
        }
        this.manualStop = false;
        const controller = new AbortController();
        this.startAbortController = controller;
        const timeoutId = window.setTimeout(() => controller.abort(new Error("AssemblyAI streaming startup timed out")), CONNECT_TIMEOUT_MS);
        this.startPromise = this.openSocket(controller.signal);
        try {
            await this.startPromise;
        }
        finally {
            window.clearTimeout(timeoutId);
            if (this.startAbortController === controller)
                this.startAbortController = null;
            this.startPromise = null;
        }
    }
    async stop() {
        this.cancelStart();
        if (!this.socket) {
            this.manualStop = true;
            return;
        }
        this.manualStop = true;
        const socket = this.socket;
        this.socket = null;
        socket.removeEventListener("message", this.handleMessage);
        socket.removeEventListener("close", this.handleClose);
        socket.removeEventListener("error", this.handleSocketError);
        if (socket.readyState === WebSocket.CLOSED)
            return;
        await new Promise((resolve) => {
            let timeoutId;
            const cleanup = () => {
                window.clearTimeout(timeoutId);
                socket.removeEventListener("close", cleanup);
                socket.removeEventListener("error", cleanup);
                resolve();
            };
            timeoutId = window.setTimeout(cleanup, CLOSE_TIMEOUT_MS);
            socket.addEventListener("close", cleanup, { once: true });
            socket.addEventListener("error", cleanup, { once: true });
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: "Terminate" }));
            }
            try {
                socket.close();
            }
            catch {
                cleanup();
            }
        });
    }
    cancelStart() {
        this.manualStop = true;
        this.startAbortController?.abort(new Error("AssemblyAI streaming startup cancelled"));
        this.startAbortController = null;
        this.cancelConnection?.();
        this.cancelConnection = null;
    }
    async sendAudio(pcm16, sampleRate, channels) {
        await this.start();
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            throw new Error("AssemblyAI streaming socket is not connected");
        }
        const mono = downmixPcm16(pcm16, channels);
        const targetSampleRate = this.options.sampleRateHz ?? DEFAULT_SAMPLE_RATE_HZ;
        const resampled = resamplePcm16(mono, sampleRate, targetSampleRate);
        this.socket.send(resampled.buffer.slice(resampled.byteOffset, resampled.byteOffset + resampled.byteLength));
    }
    onTranscript(handler) {
        this.handlers.add(handler);
        return () => {
            this.handlers.delete(handler);
        };
    }
    onError(handler) {
        this.errorHandlers.add(handler);
        return () => {
            this.errorHandlers.delete(handler);
        };
    }
    async openSocket(signal) {
        const params = new URLSearchParams({
            sample_rate: String(this.options.sampleRateHz ?? DEFAULT_SAMPLE_RATE_HZ),
            encoding: this.options.encoding ?? "pcm_s16le",
            end_of_turn_confidence_threshold: String(clamp01(this.options.endOfTurnConfidenceThreshold ?? 0.4)),
            format_turns: String(this.options.formatTurns ?? false),
            min_end_of_turn_silence_when_confident: String(this.options.minEndOfTurnSilenceMs ?? 400),
            max_turn_silence: String(this.options.maxTurnSilenceMs ?? 1280),
            vad_threshold: String(clamp01(this.options.vadThreshold ?? 0.4)),
        });
        if (this.options.inactivityTimeoutSecs !== undefined) {
            params.set("inactivity_timeout", String(Math.max(5, Math.min(3600, this.options.inactivityTimeoutSecs))));
        }
        if (this.options.wordBoost?.length) {
            for (const term of this.options.wordBoost) {
                params.append("keyterms_prompt", term);
            }
        }
        if (this.options.languageDetection) {
            params.set("language_detection", "true");
        }
        if (this.options.speechModel) {
            params.set("speech_model", this.options.speechModel);
        }
        let socketUrl = "";
        if (this.options.webSocketUrl) {
            socketUrl = buildWebSocketUrl(this.options.webSocketUrl, params, this.options.sessionToken);
        }
        else {
            if (!this.options.getToken) {
                throw new Error("AssemblyAI STT transport requires getToken or webSocketUrl");
            }
            const token = await raceWithAbort(this.options.getToken(signal), signal);
            assertString(token, "temporary token", 8_192);
            params.set("token", token);
            socketUrl = `${ASSEMBLYAI_STREAMING_URL}?${params.toString()}`;
        }
        const socket = new WebSocket(socketUrl);
        socket.binaryType = "arraybuffer";
        this.socket = socket;
        try {
            await new Promise((resolve, reject) => {
                let settled = false;
                const settle = (error) => {
                    if (settled)
                        return;
                    settled = true;
                    window.clearTimeout(timeoutId);
                    cleanup();
                    this.cancelConnection = null;
                    if (error)
                        reject(error);
                    else
                        resolve();
                };
                const cleanup = () => {
                    socket.removeEventListener("open", handleOpen);
                    socket.removeEventListener("error", handleError);
                    socket.removeEventListener("close", handleCloseBeforeOpen);
                    signal.removeEventListener("abort", handleAbort);
                };
                const handleOpen = () => settle();
                const handleError = () => settle(new Error("AssemblyAI streaming socket failed to connect"));
                const handleCloseBeforeOpen = () => settle(new Error("AssemblyAI streaming socket closed before opening"));
                const handleAbort = () => settle(abortReason(signal));
                const timeoutId = window.setTimeout(handleAbort, CONNECT_TIMEOUT_MS);
                this.cancelConnection = () => settle(new Error("AssemblyAI streaming socket connection cancelled"));
                socket.addEventListener("open", handleOpen, { once: true });
                socket.addEventListener("error", handleError, { once: true });
                socket.addEventListener("close", handleCloseBeforeOpen, { once: true });
                signal.addEventListener("abort", handleAbort, { once: true });
                if (signal.aborted)
                    handleAbort();
            });
        }
        catch (error) {
            if (this.socket === socket) {
                this.socket = null;
                try {
                    socket.close();
                }
                catch { /* Best effort after failed connect. */ }
            }
            throw error;
        }
        socket.addEventListener("message", this.handleMessage);
        socket.addEventListener("close", this.handleClose);
        socket.addEventListener("error", this.handleSocketError);
    }
    handleMessage = (event) => {
        let payload;
        try {
            payload = JSON.parse(event.data);
        }
        catch {
            return;
        }
        const messageType = typeof payload.type === "string" ? payload.type : "";
        if (messageType !== "Turn") {
            if (messageType === "Error") {
                const errorMessage = typeof payload.error === "string"
                    ? payload.error
                    : "AssemblyAI streaming error";
                this.emitError(new Error(errorMessage));
                void this.stop().catch((error) => {
                    this.emitError(error instanceof Error ? error : new Error(String(error)));
                });
            }
            return;
        }
        const turn = payload;
        const transcript = turn.transcript?.trim();
        if (!transcript) {
            return;
        }
        if (turn.end_of_turn) {
            this.emit({ type: "final", text: transcript });
            return;
        }
        this.emit({ type: "partial", text: transcript });
    };
    handleClose = (event) => {
        if (this.socket !== event.currentTarget)
            return;
        this.socket = null;
        if (!this.manualStop) {
            const reason = event.reason ? `: ${event.reason}` : "";
            this.emitError(new Error(`AssemblyAI streaming socket closed (${event.code})${reason}`));
        }
    };
    handleSocketError = () => {
        // The connection error itself is surfaced by send/start failures.
    };
    emit(event) {
        for (const handler of this.handlers) {
            handler(event);
        }
    }
    emitError(error) {
        for (const handler of this.errorHandlers) {
            handler(error);
        }
    }
}
function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}
function validateAssemblyOptions(options) {
    if (!options || typeof options !== "object")
        throw new TypeError("AssemblyAI options must be an object");
    assertInteger(options.sampleRateHz, "sampleRateHz", 8_000, 192_000);
    assertNumber(options.endOfTurnConfidenceThreshold, "endOfTurnConfidenceThreshold", 0, 1);
    assertInteger(options.minEndOfTurnSilenceMs, "minEndOfTurnSilenceMs", 0, 60_000);
    assertInteger(options.maxTurnSilenceMs, "maxTurnSilenceMs", 0, 60_000);
    assertNumber(options.vadThreshold, "vadThreshold", 0, 1);
    assertInteger(options.inactivityTimeoutSecs, "inactivityTimeoutSecs", 5, 3_600);
    if (options.wordBoost) {
        if (!Array.isArray(options.wordBoost) || options.wordBoost.length > 100) {
            throw new RangeError("AssemblyAI wordBoost supports at most 100 terms");
        }
        for (const term of options.wordBoost)
            assertString(term, "wordBoost term", 100);
    }
    if (options.speechModel !== undefined)
        assertString(options.speechModel, "speechModel", 256);
    const sessionToken = validateVoiceCoreSessionToken(options.sessionToken);
    if (options.webSocketUrl !== undefined)
        assertWebSocketUrl(options.webSocketUrl, "AssemblyAI");
    if (sessionToken && options.webSocketUrl) {
        assertSecureWebSocketSessionTarget(options.webSocketUrl);
    }
    if (options.getToken !== undefined && typeof options.getToken !== "function") {
        throw new TypeError("AssemblyAI getToken must be a function");
    }
    return {
        ...options,
        sessionToken,
        wordBoost: options.wordBoost ? [...options.wordBoost] : undefined,
    };
}
function buildWebSocketUrl(baseUrl, params, sessionToken) {
    const url = new URL(baseUrl, window.location.origin);
    if (url.protocol === "http:") {
        url.protocol = "ws:";
    }
    else if (url.protocol === "https:") {
        url.protocol = "wss:";
    }
    const hostname = url.hostname.toLowerCase().replace(/\.+$/, "");
    if (sessionToken?.trim() && hostname === "streaming.assemblyai.com") {
        throw new Error("VoiceCore session tokens must use a trusted AssemblyAI proxy");
    }
    if (sessionToken?.trim()) {
        assertSecureWebSocketSessionTarget(url.toString());
        url.searchParams.set("voice_core_session_token", sessionToken.trim());
    }
    params.forEach((value, key) => {
        url.searchParams.append(key, value);
    });
    return url.toString();
}
function assertInteger(value, name, min, max) {
    if (value === undefined)
        return;
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new RangeError(`AssemblyAI ${name} must be an integer from ${min} to ${max}`);
    }
}
function assertNumber(value, name, min, max) {
    if (value === undefined)
        return;
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
        throw new RangeError(`AssemblyAI ${name} must be finite from ${min} to ${max}`);
    }
}
function assertString(value, name, max) {
    if (typeof value !== "string" || !value.trim() || value.length > max) {
        throw new RangeError(`AssemblyAI ${name} must be non-empty and at most ${max} characters`);
    }
}
function assertWebSocketUrl(value, provider) {
    if (typeof value !== "string" || !value.trim() || /[\\\u0000-\u001f\u007f]/.test(value)) {
        throw new TypeError(`${provider} webSocketUrl must be a non-empty safe URL`);
    }
    const url = new URL(value, window.location.origin);
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol) || url.username || url.password || url.hash) {
        throw new TypeError(`${provider} webSocketUrl must be credential-free HTTP(S) or WS(S)`);
    }
}
function raceWithAbort(promise, signal) {
    if (signal.aborted)
        return Promise.reject(abortReason(signal));
    return new Promise((resolve, reject) => {
        const handleAbort = () => reject(abortReason(signal));
        signal.addEventListener("abort", handleAbort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", handleAbort));
    });
}
function abortReason(signal) {
    return signal.reason instanceof Error
        ? signal.reason
        : new Error("AssemblyAI streaming startup aborted");
}
function combineAbortSignals(first, second) {
    const signals = [first, second].filter((signal) => Boolean(signal));
    if (signals.length === 0)
        return undefined;
    if (signals.length === 1)
        return signals[0];
    return AbortSignal.any(signals);
}
function downmixPcm16(samples, channels) {
    if (channels <= 1) {
        return samples;
    }
    const frameCount = Math.floor(samples.length / channels);
    const mono = new Int16Array(frameCount);
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        let sum = 0;
        const baseIndex = frameIndex * channels;
        for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
            sum += samples[baseIndex + channelIndex] ?? 0;
        }
        mono[frameIndex] = sum / channels;
    }
    return mono;
}
function resamplePcm16(samples, inputSampleRateHz, outputSampleRateHz) {
    if (samples.length === 0 ||
        inputSampleRateHz <= 0 ||
        outputSampleRateHz <= 0 ||
        inputSampleRateHz === outputSampleRateHz) {
        return samples;
    }
    const outputLength = Math.max(1, Math.round(samples.length * outputSampleRateHz / inputSampleRateHz));
    const output = new Int16Array(outputLength);
    const ratio = inputSampleRateHz / outputSampleRateHz;
    for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
        const sourceIndex = outputIndex * ratio;
        const lowerIndex = Math.floor(sourceIndex);
        const upperIndex = Math.min(lowerIndex + 1, samples.length - 1);
        const fraction = sourceIndex - lowerIndex;
        const lower = samples[lowerIndex] ?? 0;
        const upper = samples[upperIndex] ?? lower;
        output[outputIndex] = lower + (upper - lower) * fraction;
    }
    return output;
}
//# sourceMappingURL=assemblyai.js.map