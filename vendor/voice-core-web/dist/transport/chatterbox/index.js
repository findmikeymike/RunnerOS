import { ChatterboxWorkerClient } from "./workerClient.js";
import { DEFAULT_CHATTERBOX_DTYPE_MAP, DEFAULT_CHATTERBOX_MODEL_ID, DEFAULT_CHATTERBOX_SAMPLE_RATE, MAX_CHATTERBOX_REFERENCE_SECONDS, MAX_CHATTERBOX_TEXT_BYTES, } from "./protocol.js";
import { validateVoiceCoreSessionToken } from "../../sessionSecurity.js";
const DEFAULT_CHATTERBOX_MODEL_BASE_URL = "/api/chatterbox/models/";
const MAX_REFERENCE_AUDIO_BYTES = 32 * 1024 * 1024;
export function createChatterboxTtsTransport(options) {
    return new ChatterboxTtsTransport(validateOptions(options));
}
export const createChatterboxTurboWebGpuTransport = createChatterboxTtsTransport;
class ChatterboxTtsTransport {
    client;
    referenceLoad = null;
    referenceLoadController = null;
    options;
    constructor(options) {
        this.options = options;
        this.client = new ChatterboxWorkerClient({ onDiagnostic: options.onDiagnostic });
    }
    async synthesize(request) {
        const text = request.text.trim();
        if (!text)
            throw new Error("Chatterbox text cannot be empty");
        if (new TextEncoder().encode(text).byteLength > MAX_CHATTERBOX_TEXT_BYTES) {
            throw new Error(`Chatterbox text cannot exceed ${MAX_CHATTERBOX_TEXT_BYTES} bytes`);
        }
        const reference = await this.loadReference(request.signal);
        const pcm = reference.pcm.slice();
        const result = await this.client.synthesize({
            modelBaseUrl: this.options.modelBaseUrl,
            modelId: this.options.modelId,
            modelRevision: this.options.modelRevision,
            dtypeMap: this.options.dtypeMap,
            sessionToken: this.options.sessionToken,
            text,
            voiceId: this.options.voiceId,
            referenceSha256: this.options.referenceSha256,
            referencePcm: pcm,
            referenceSampleRate: reference.sampleRate,
            maxNewTokens: this.options.maxNewTokens,
            repetitionPenalty: this.options.repetitionPenalty,
            signal: request.signal,
        });
        this.options.onDiagnostic?.(`Chatterbox synthesized ${(result.audioSeconds).toFixed(2)}s in ${result.synthesisMs.toFixed(0)}ms`);
        const chunk = {
            frames: new Float32Array(result.audio),
            sampleRate: result.sampleRate,
            channels: 1,
        };
        const signal = request.signal;
        return (async function* () {
            if (signal.aborted)
                throw createAbortError();
            yield chunk;
        })();
    }
    async dispose() {
        this.referenceLoadController?.abort();
        this.referenceLoadController = null;
        this.referenceLoad = null;
        await this.client.dispose();
    }
    async stop() {
        await this.dispose();
    }
    async invalidateVoice(voiceId) {
        const normalized = validateIdentifier(voiceId, "Chatterbox voiceId");
        if (normalized === this.options.voiceId) {
            this.referenceLoadController?.abort();
            this.referenceLoadController = null;
            this.referenceLoad = null;
        }
        await this.client.invalidateVoice(normalized);
    }
    async loadReference(signal) {
        if (!this.referenceLoad) {
            this.referenceLoadController = new AbortController();
            this.referenceLoad = decodeReferenceAudio(this.options.referenceAudioUrl, this.options.referenceSha256, this.options.referenceSampleRate, this.referenceLoadController.signal, this.options.sessionToken)
                .catch((error) => {
                this.referenceLoad = null;
                this.referenceLoadController = null;
                throw error;
            });
        }
        return abortable(this.referenceLoad, signal);
    }
}
function validateOptions(options) {
    if (!options || typeof options !== "object") {
        throw new Error("Chatterbox transport options are required");
    }
    const modelBaseUrl = validateUrl(options.modelBaseUrl?.trim() || DEFAULT_CHATTERBOX_MODEL_BASE_URL, "Chatterbox modelBaseUrl");
    const referenceAudioUrl = validateUrl(options.referenceAudioUrl, "Chatterbox referenceAudioUrl");
    const modelId = validateIdentifier(options.modelId?.trim() || DEFAULT_CHATTERBOX_MODEL_ID, "Chatterbox modelId");
    const modelRevision = validateRevision(options.modelRevision);
    const voiceId = validateIdentifier(options.voiceId, "Chatterbox voiceId");
    const referenceSha256 = validateSha256(options.referenceSha256);
    const sessionToken = validateSessionToken(options.sessionToken);
    const referenceSampleRate = validateSampleRate(options.referenceSampleRate ?? DEFAULT_CHATTERBOX_SAMPLE_RATE);
    const maxNewTokens = validateBoundedInteger(options.maxNewTokens ?? 256, "Chatterbox maxNewTokens", 1, 1024);
    const repetitionPenalty = validateRepetitionPenalty(options.repetitionPenalty ?? 1.2);
    const dtypeMap = validateDtypeMap(options.dtypeMap ?? DEFAULT_CHATTERBOX_DTYPE_MAP);
    return {
        modelBaseUrl,
        modelId,
        modelRevision,
        voiceId,
        referenceSha256,
        sessionToken,
        referenceAudioUrl,
        dtypeMap,
        referenceSampleRate,
        maxNewTokens,
        repetitionPenalty,
        onDiagnostic: options.onDiagnostic,
    };
}
function validateSessionToken(value) {
    if (value === undefined)
        return null;
    try {
        return validateVoiceCoreSessionToken(value) ?? null;
    }
    catch {
        throw new Error("Chatterbox sessionToken is invalid");
    }
}
function validateSha256(value) {
    if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) {
        throw new Error("Chatterbox referenceSha256 must be a SHA-256 digest");
    }
    return value.toLowerCase();
}
function validateUrl(value, label) {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`${label} must be a non-empty URL or absolute path segment`);
    }
    const base = typeof window === "undefined" ? "http://127.0.0.1/" : window.location.href;
    let url;
    try {
        url = new URL(value, base);
    }
    catch {
        throw new Error(`${label} must be a valid URL`);
    }
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1" || url.hostname === "[::1]";
    const sameOrigin = typeof window !== "undefined" && url.origin === window.location.origin;
    if (!sameOrigin && !(url.protocol === "http:" && loopback)) {
        throw new Error(`${label} must be same-origin or loopback HTTP`);
    }
    if (url.username || url.password || url.search || url.hash) {
        throw new Error(`${label} cannot include credentials, query parameters, or fragments`);
    }
    return url.toString();
}
function validateIdentifier(value, label) {
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(value)) {
        throw new Error(`${label} must be a simple identifier`);
    }
    return value;
}
function validateRevision(value) {
    if (typeof value !== "string" || !/^[a-f0-9]{40}$/i.test(value)) {
        throw new Error("Chatterbox modelRevision must be a 40-character git revision");
    }
    return value;
}
function validateSampleRate(value) {
    return validateBoundedInteger(value, "Chatterbox referenceSampleRate", 8_000, 48_000);
}
function validateBoundedInteger(value, label, minimum, maximum) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new Error(`${label} must be an integer from ${minimum} through ${maximum}`);
    }
    return value;
}
function validateRepetitionPenalty(value) {
    if (!Number.isFinite(value) || value < 1 || value > 3) {
        throw new Error("Chatterbox repetitionPenalty must be a finite number from 1 through 3");
    }
    return value;
}
function validateDtypeMap(value) {
    const allowed = new Set(["fp16", "q4f16"]);
    const entries = Object.entries(value);
    if (entries.length !== 4) {
        throw new Error("Chatterbox dtypeMap must include exactly four network entries");
    }
    for (const key of ["embed_tokens", "speech_encoder", "language_model", "conditional_decoder"]) {
        if (!allowed.has(value[key])) {
            throw new Error(`Unsupported Chatterbox dtype for ${key}`);
        }
    }
    return {
        embed_tokens: value.embed_tokens,
        speech_encoder: value.speech_encoder,
        language_model: value.language_model,
        conditional_decoder: value.conditional_decoder,
    };
}
async function decodeReferenceAudio(url, expectedSha256, expectedSampleRate, signal, sessionToken) {
    const headers = sessionToken ? { "X-VoiceCore-Session": sessionToken } : undefined;
    const response = await fetch(url, { redirect: "error", signal, headers });
    if (!response.ok) {
        throw new Error(`Chatterbox reference audio fetch failed with HTTP ${response.status}`);
    }
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_REFERENCE_AUDIO_BYTES) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error("Chatterbox reference audio exceeds 32 MiB");
    }
    const encoded = await response.arrayBuffer();
    if (encoded.byteLength === 0 || encoded.byteLength > MAX_REFERENCE_AUDIO_BYTES) {
        throw new Error("Chatterbox reference audio is empty or exceeds 32 MiB");
    }
    if (await sha256Hex(encoded) !== expectedSha256) {
        throw new Error("Chatterbox reference audio failed integrity verification");
    }
    const context = new AudioContext({ sampleRate: expectedSampleRate });
    try {
        const decoded = await context.decodeAudioData(encoded.slice(0));
        const seconds = decoded.length / Math.max(1, decoded.sampleRate);
        if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_CHATTERBOX_REFERENCE_SECONDS) {
            throw new Error(`Chatterbox reference audio must be 0-${MAX_CHATTERBOX_REFERENCE_SECONDS} seconds`);
        }
        const pcm = mixToMono(decoded);
        if (pcm.some((sample) => !Number.isFinite(sample))) {
            throw new Error("Chatterbox reference audio contains invalid PCM");
        }
        return {
            pcm,
            sampleRate: decoded.sampleRate,
        };
    }
    finally {
        await context.close();
    }
}
async function sha256Hex(bytes) {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle)
        throw new Error("Chatterbox reference audio hashing is unavailable");
    const digest = await subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}
function mixToMono(audio) {
    const mono = new Float32Array(audio.length);
    if (audio.numberOfChannels === 1) {
        mono.set(audio.getChannelData(0));
        return mono;
    }
    const scale = Math.SQRT2 / audio.numberOfChannels;
    for (let channel = 0; channel < audio.numberOfChannels; channel += 1) {
        const data = audio.getChannelData(channel);
        for (let index = 0; index < data.length; index += 1) {
            mono[index] += data[index] * scale;
        }
    }
    return mono;
}
async function abortable(promise, signal) {
    if (signal.aborted) {
        throw createAbortError();
    }
    return new Promise((resolve, reject) => {
        const abort = () => reject(createAbortError());
        signal.addEventListener("abort", abort, { once: true });
        promise.then((value) => {
            signal.removeEventListener("abort", abort);
            resolve(value);
        }, (error) => {
            signal.removeEventListener("abort", abort);
            reject(error);
        });
    });
}
function createAbortError() {
    if (typeof DOMException === "function") {
        return new DOMException("The operation was aborted.", "AbortError");
    }
    const error = new Error("The operation was aborted.");
    error.name = "AbortError";
    return error;
}
//# sourceMappingURL=index.js.map