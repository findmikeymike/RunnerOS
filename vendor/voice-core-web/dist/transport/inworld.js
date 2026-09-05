import { assertSecureWebSocketSessionTarget, validateVoiceCoreSessionToken, } from "../sessionSecurity.js";
const INWORLD_DEFAULT_WS_URL = "/api/inworld/tts/ws";
const DEFAULT_INWORLD_MODEL_ID = "inworld-tts-1.5-max";
const DEFAULT_INWORLD_VOICE_ID = "default-js62x_e5fayjvp0pdpipxa__daddy";
const DEFAULT_SAMPLE_RATE_HZ = 16_000;
const DEFAULT_BUFFER_THRESHOLD = 100;
const CONTEXT_ID = "ctx-1";
const CROSSFADE_SAMPLES = 480;
const MAX_QUEUED_AUDIO_MS = 60_000;
const CONTEXT_READY_TIMEOUT_MS = 15_000;
const AUDIO_IDLE_TIMEOUT_MS = 30_000;
const SESSION_TIMEOUT_MS = 120_000;
export function createInworldTtsTransport(options = {}) {
    if (options.inworldRuntimeKey?.trim()) {
        throw new Error("Inworld runtime keys are not supported in browser memory; configure a trusted WebSocket proxy");
    }
    return new InworldTtsTransport(validateInworldOptions(options));
}
class InworldTtsTransport {
    options;
    constructor(options) {
        this.options = options;
    }
    async createStreamingSession(signal) {
        return createInworldStreamingSession({
            webSocketUrl: this.options.webSocketUrl ?? INWORLD_DEFAULT_WS_URL,
            voiceId: this.options.inworldVoiceId ?? DEFAULT_INWORLD_VOICE_ID,
            modelId: this.options.inworldModelId ?? DEFAULT_INWORLD_MODEL_ID,
            sampleRateHz: this.options.sampleRateHz ?? DEFAULT_SAMPLE_RATE_HZ,
            bufferCharThreshold: this.options.bufferCharThreshold ?? DEFAULT_BUFFER_THRESHOLD,
            sessionToken: this.options.sessionToken,
        }, signal);
    }
    async synthesize(request) {
        const session = await this.createStreamingSession(request.signal);
        await session.pushText(request.text, true);
        await session.finish();
        return session;
    }
}
async function createInworldStreamingSession(options, signal) {
    if (signal.aborted) {
        throw new DOMException("Inworld TTS cancelled", "AbortError");
    }
    const socketUrl = buildWebSocketUrl(options.webSocketUrl, options.sessionToken);
    const socket = new WebSocket(socketUrl);
    socket.binaryType = "arraybuffer";
    const queue = createAsyncQueue(options.sampleRateHz * (MAX_QUEUED_AUDIO_MS / 1_000), (chunk) => chunk.frames.length / Math.max(1, chunk.channels), `Inworld TTS audio queue exceeded ${MAX_QUEUED_AUDIO_MS}ms`);
    let prevChunkTail = null;
    let finished = false;
    let contextReady = false;
    let flushed = false;
    let terminalError = null;
    let readyTimer;
    let idleTimer;
    let sessionTimer;
    let readyResolve = null;
    let readyReject = null;
    const ready = new Promise((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
    });
    // A session can fail before its caller starts sending text.
    void ready.catch(() => undefined);
    const cleanup = () => {
        clearTimeout(readyTimer);
        clearTimeout(idleTimer);
        clearTimeout(sessionTimer);
        socket.removeEventListener("open", handleOpen);
        socket.removeEventListener("message", handleMessage);
        socket.removeEventListener("error", handleError);
        socket.removeEventListener("close", handleClose);
        signal.removeEventListener("abort", handleAbort);
    };
    const closeSocket = () => {
        try {
            if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
                socket.close();
            }
        }
        catch {
            // A connecting socket may reject close; deadlines and listeners are still cleared.
        }
    };
    const finish = () => {
        if (finished) {
            return;
        }
        finished = true;
        cleanup();
        readyResolve?.();
        flushTail(queue, prevChunkTail, options.sampleRateHz);
        prevChunkTail = null;
        queue.end();
        closeSocket();
    };
    const fail = (error) => {
        if (finished) {
            return;
        }
        finished = true;
        terminalError = error;
        cleanup();
        prevChunkTail = null;
        readyReject?.(error);
        queue.throw(error);
        closeSocket();
    };
    const resetAudioDeadline = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => fail(new Error("Inworld TTS audio timed out")), AUDIO_IDLE_TIMEOUT_MS);
    };
    const handleOpen = () => {
        try {
            socket.send(JSON.stringify({
                create: {
                    voiceId: options.voiceId,
                    modelId: options.modelId,
                    audioConfig: {
                        audioEncoding: "LINEAR16",
                        sampleRateHertz: options.sampleRateHz,
                    },
                    bufferCharThreshold: options.bufferCharThreshold,
                },
                contextId: CONTEXT_ID,
            }));
        }
        catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)));
        }
    };
    const handleMessage = (event) => {
        let payload;
        try {
            payload = JSON.parse(event.data);
        }
        catch {
            return;
        }
        const result = payload.result;
        if (!result) {
            return;
        }
        const status = result.status;
        if (status && (status.code ?? 0) !== 0) {
            fail(new Error(status.message || `Inworld TTS error (${status.code})`));
            return;
        }
        if (result.contextCreated) {
            contextReady = true;
            clearTimeout(readyTimer);
            readyResolve?.();
            return;
        }
        const audioContent = result.audioChunk?.audioContent;
        if (audioContent) {
            resetAudioDeadline();
            try {
                const pcm16 = decodeAudioChunk(audioContent);
                if (pcm16.length > 0) {
                    const blended = blendChunkBoundary(prevChunkTail, pcm16);
                    if (blended.length > CROSSFADE_SAMPLES) {
                        const splitIndex = blended.length - CROSSFADE_SAMPLES;
                        const body = blended.subarray(0, splitIndex);
                        prevChunkTail = blended.slice(splitIndex);
                        queue.push({
                            frames: pcm16ToFloat32(body),
                            sampleRate: options.sampleRateHz,
                            channels: 1,
                        });
                    }
                    else {
                        prevChunkTail = blended;
                    }
                }
            }
            catch (error) {
                fail(error instanceof Error ? error : new Error(String(error)));
            }
            return;
        }
        if (result.flushCompleted || result.contextClosed) {
            finish();
        }
    };
    const handleError = () => {
        fail(new Error("Inworld TTS WebSocket error"));
    };
    const handleClose = (event) => {
        if (finished) {
            return;
        }
        fail(new Error(`Inworld TTS socket closed before ${contextReady ? "audio completed" : "context was ready"} (${event.code}) ${event.reason ?? ""}`.trim()));
    };
    const handleAbort = () => {
        fail(new DOMException("Inworld TTS cancelled", "AbortError"));
    };
    socket.addEventListener("open", handleOpen);
    socket.addEventListener("message", handleMessage);
    socket.addEventListener("error", handleError);
    socket.addEventListener("close", handleClose);
    signal.addEventListener("abort", handleAbort, { once: true });
    readyTimer = setTimeout(() => fail(new Error("Inworld TTS context readiness timed out")), CONTEXT_READY_TIMEOUT_MS);
    sessionTimer = setTimeout(() => fail(new Error("Inworld TTS session timed out")), SESSION_TIMEOUT_MS);
    const sendText = async (text, flush) => {
        if (terminalError)
            throw terminalError;
        const trimmed = text.trim();
        if (!trimmed || finished) {
            return;
        }
        if (trimmed.length > 1000) {
            const error = new Error(`Text too long: ${trimmed.length} chars (max 1000 per send_text)`);
            fail(error);
            throw error;
        }
        await ready;
        if (finished || socket.readyState !== WebSocket.OPEN) {
            throw terminalError ?? new Error("Inworld TTS socket is not open");
        }
        if (flush) {
            flushed = true;
        }
        try {
            socket.send(JSON.stringify({
                send_text: {
                    text: trimmed,
                    ...(flush ? { flush_context: {} } : {}),
                },
                contextId: CONTEXT_ID,
            }));
            resetAudioDeadline();
        }
        catch (error) {
            const failure = error instanceof Error ? error : new Error(String(error));
            fail(failure);
            throw failure;
        }
    };
    const finishSession = async () => {
        if (terminalError)
            throw terminalError;
        if (finished) {
            return;
        }
        if (!flushed) {
            finish();
            return;
        }
        await ready;
    };
    return {
        pushText: sendText,
        finish: finishSession,
        async *[Symbol.asyncIterator]() {
            try {
                for await (const chunk of queue) {
                    if (signal.aborted)
                        throw new DOMException("Inworld TTS cancelled", "AbortError");
                    yield chunk;
                }
            }
            finally {
                handleAbort();
            }
        },
    };
}
function buildWebSocketUrl(baseUrl, sessionToken) {
    const url = new URL(baseUrl, window.location.href);
    if (url.protocol === "http:") {
        url.protocol = "ws:";
    }
    else if (url.protocol === "https:") {
        url.protocol = "wss:";
    }
    const hostname = url.hostname.toLowerCase().replace(/\.+$/, "");
    if (sessionToken?.trim() && hostname === "api.inworld.ai") {
        throw new Error("VoiceCore session tokens must use a trusted Inworld proxy");
    }
    if (sessionToken?.trim()) {
        assertSecureWebSocketSessionTarget(url.toString());
        url.searchParams.set("voice_core_session_token", sessionToken.trim());
    }
    return url.toString();
}
function validateInworldOptions(options) {
    assertInworldInteger(options.sampleRateHz, "sampleRateHz", 8_000, 192_000);
    assertInworldInteger(options.bufferCharThreshold, "bufferCharThreshold", 1, 1_000);
    if (options.inworldVoiceId !== undefined)
        assertInworldString(options.inworldVoiceId, "inworldVoiceId", 512);
    if (options.inworldModelId !== undefined)
        assertInworldString(options.inworldModelId, "inworldModelId", 512);
    const sessionToken = validateVoiceCoreSessionToken(options.sessionToken);
    if (options.webSocketUrl !== undefined) {
        if (typeof options.webSocketUrl !== "string" ||
            !options.webSocketUrl.trim() ||
            /[\\\u0000-\u001f\u007f]/.test(options.webSocketUrl)) {
            throw new TypeError("Inworld webSocketUrl must be a non-empty safe URL");
        }
        const url = new URL(options.webSocketUrl, window.location.href);
        if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol) || url.username || url.password || url.hash) {
            throw new TypeError("Inworld webSocketUrl must be credential-free HTTP(S) or WS(S)");
        }
        if (sessionToken) {
            assertSecureWebSocketSessionTarget(options.webSocketUrl);
        }
    }
    return { ...options, sessionToken };
}
function assertInworldInteger(value, name, min, max) {
    if (value === undefined)
        return;
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new RangeError(`Inworld ${name} must be an integer from ${min} to ${max}`);
    }
}
function assertInworldString(value, name, max) {
    if (typeof value !== "string" || !value.trim() || value.length > max) {
        throw new RangeError(`Inworld ${name} must be non-empty and at most ${max} characters`);
    }
}
function decodeAudioChunk(audioContent) {
    const binary = atob(audioContent);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    let pcmBytes = bytes;
    if (bytes.length > 44 && readAscii(bytes, 0, 4) === "RIFF") {
        const dataOffset = findWavDataOffset(bytes);
        pcmBytes = bytes.subarray(dataOffset ?? 44);
    }
    const evenLength = pcmBytes.length - (pcmBytes.length % 2);
    const pcm16 = new Int16Array(evenLength / 2);
    for (let index = 0; index < evenLength; index += 2) {
        pcm16[index / 2] = (pcmBytes[index] | (pcmBytes[index + 1] << 8)) << 16 >> 16;
    }
    return pcm16;
}
function findWavDataOffset(bytes) {
    for (let index = 12; index <= bytes.length - 8; index += 1) {
        if (readAscii(bytes, index, 4) === "data") {
            return index + 8;
        }
    }
    return null;
}
function readAscii(bytes, offset, length) {
    return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
function pcm16ToFloat32(pcm16) {
    const frames = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i += 1) {
        frames[i] = pcm16[i] / 32768;
    }
    return frames;
}
function flushTail(queue, tail, sampleRate) {
    if (!tail || tail.length === 0) {
        return;
    }
    applyEdgeFade(tail, sampleRate);
    queue.push({
        frames: pcm16ToFloat32(tail),
        sampleRate,
        channels: 1,
    });
}
function blendChunkBoundary(prevTail, current) {
    if (!prevTail || prevTail.length === 0 || current.length === 0) {
        return current;
    }
    const crossfadeLength = Math.min(prevTail.length, CROSSFADE_SAMPLES, current.length);
    const blended = new Int16Array(current.length);
    for (let index = 0; index < crossfadeLength; index += 1) {
        const t = 0.5 * (1 - Math.cos((Math.PI * index) / crossfadeLength));
        const prevValue = prevTail[prevTail.length - crossfadeLength + index] ?? 0;
        const currentValue = current[index] ?? 0;
        blended[index] = Math.round(prevValue * (1 - t) + currentValue * t);
    }
    blended.set(current.subarray(crossfadeLength), crossfadeLength);
    return blended;
}
function applyEdgeFade(samples, sampleRate) {
    if (samples.length === 0 || sampleRate <= 0) {
        return;
    }
    const fadeSamples = Math.min(samples.length >> 1, Math.max(32, Math.round(sampleRate * 0.005)));
    if (fadeSamples <= 1) {
        return;
    }
    for (let index = 0; index < fadeSamples; index += 1) {
        const gain = index / (fadeSamples - 1);
        const tailIndex = samples.length - fadeSamples + index;
        samples[index] = Math.round(samples[index] * gain);
        samples[tailIndex] = Math.round(samples[tailIndex] * (1 - gain));
    }
}
export function createAsyncQueue(maxQueuedWeight = Number.POSITIVE_INFINITY, weightOf = () => 1, overflowMessage = "Inworld TTS audio queue capacity exceeded") {
    const values = [];
    const waiters = [];
    let done = false;
    let error = null;
    let queuedWeight = 0;
    return {
        push(value) {
            if (done || error) {
                return;
            }
            const waiter = waiters.shift();
            if (waiter) {
                waiter({ value, done: false });
                return;
            }
            const weight = Math.max(0, weightOf(value));
            if (!Number.isFinite(weight) || queuedWeight + weight > maxQueuedWeight) {
                error = new Error(overflowMessage);
                while (waiters.length)
                    waiters.shift()?.({ value: undefined, done: true });
                return;
            }
            values.push(value);
            queuedWeight += weight;
        },
        end() {
            done = true;
            while (waiters.length) {
                waiters.shift()?.({ value: undefined, done: true });
            }
        },
        throw(nextError) {
            error = nextError;
            values.length = 0;
            queuedWeight = 0;
            while (waiters.length) {
                const waiter = waiters.shift();
                if (waiter) {
                    // Resolve; the generator checks `error` on next().
                    waiter({ value: undefined, done: true });
                }
            }
        },
        [Symbol.asyncIterator]() {
            return {
                next: () => {
                    if (error) {
                        return Promise.reject(error);
                    }
                    const value = values.shift();
                    if (value !== undefined) {
                        queuedWeight = Math.max(0, queuedWeight - Math.max(0, weightOf(value)));
                        return Promise.resolve({ value, done: false });
                    }
                    if (done) {
                        return Promise.resolve({ value: undefined, done: true });
                    }
                    return new Promise((resolve, reject) => {
                        waiters.push((result) => {
                            if (error) {
                                reject(error);
                                return;
                            }
                            resolve(result);
                        });
                    });
                },
            };
        },
    };
}
//# sourceMappingURL=inworld.js.map