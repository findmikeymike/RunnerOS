const DEFAULT_API_BASE = "/api/pocket";
const DEFAULT_VOICE_ID = "alba";
const MAX_WAV_BYTES = 64 * 1024 * 1024;
export function createPocketTtsTransport(options = {}) {
    return new PocketTtsTransport(validateOptions(options));
}
export async function checkPocketTtsHealth(options = {}) {
    const validated = validateOptions(options);
    const response = await fetch(buildEndpoint(validated.apiBaseUrl, "health"), {
        method: "GET",
        redirect: "error",
        headers: buildHeaders(validated, false),
    });
    if (!response.ok) {
        throw new Error(`Pocket TTS health check failed with HTTP status ${response.status}`);
    }
}
class PocketTtsTransport {
    options;
    constructor(options) {
        this.options = options;
    }
    async synthesize(request) {
        const text = request.text.trim();
        if (!text)
            throw new Error("Pocket TTS text cannot be empty");
        const response = await fetch(buildEndpoint(this.options.apiBaseUrl, "tts"), {
            method: "POST",
            redirect: "error",
            signal: request.signal,
            headers: buildHeaders(this.options, true),
            body: JSON.stringify({ text, voiceId: this.options.voiceId }),
        });
        if (!response.ok) {
            const detail = await response.json().catch(() => null);
            const suffix = typeof detail?.error === "string" ? `: ${detail.error}` : "";
            throw new Error(`Pocket TTS synthesis failed with HTTP status ${response.status}${suffix}`);
        }
        const length = Number(response.headers.get("content-length") ?? 0);
        if (Number.isFinite(length) && length > MAX_WAV_BYTES) {
            await response.body?.cancel().catch(() => undefined);
            throw new Error("Pocket TTS WAV response exceeds 64 MiB");
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > MAX_WAV_BYTES)
            throw new Error("Pocket TTS WAV response exceeds 64 MiB");
        const chunk = decodePcm16Wav(bytes);
        let peak = 0;
        for (const frame of chunk.frames)
            peak = Math.max(peak, Math.abs(frame));
        this.options.onDiagnostic?.(`Pocket decoded frames=${chunk.frames.length} rate=${chunk.sampleRate} channels=${chunk.channels} peak=${peak.toFixed(3)}`);
        return (async function* () { yield chunk; })();
    }
}
function validateOptions(options) {
    const apiBaseUrl = options.apiBaseUrl?.trim() || DEFAULT_API_BASE;
    const voiceId = options.voiceId?.trim() || DEFAULT_VOICE_ID;
    if (!voiceId || new TextEncoder().encode(voiceId).byteLength > 128 || !/^[A-Za-z0-9._-]+$/.test(voiceId)) {
        throw new Error("Pocket TTS voice ID must be a simple built-in voice name of at most 128 bytes");
    }
    buildEndpoint(apiBaseUrl, "health");
    return { ...options, apiBaseUrl: apiBaseUrl.replace(/\/$/, ""), voiceId };
}
function buildEndpoint(apiBaseUrl, path) {
    const base = typeof window === "undefined" ? "http://127.0.0.1" : window.location.href;
    const url = new URL(`${apiBaseUrl.replace(/\/$/, "")}/${path}`, base);
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "::1" || url.hostname === "localhost";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
        throw new Error("Pocket TTS transport requires HTTPS or a loopback HTTP proxy");
    }
    if (url.username || url.password || url.search || url.hash) {
        throw new Error("Pocket TTS transport URL cannot contain credentials, query parameters, or fragments");
    }
    return url.toString();
}
function buildHeaders(options, json) {
    return {
        ...(json ? { "Content-Type": "application/json" } : {}),
        ...(options.sessionToken ? { "X-VoiceCore-Session": options.sessionToken } : {}),
        ...options.getAuthHeaders?.(),
    };
}
export function decodePcm16Wav(bytes) {
    if (bytes.byteLength < 44 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") {
        throw new Error("Pocket TTS returned an invalid WAV file");
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let format = null;
    let data = null;
    let offset = 12;
    while (offset + 8 <= bytes.byteLength) {
        const id = ascii(bytes, offset, 4);
        const size = view.getUint32(offset + 4, true);
        const start = offset + 8;
        if (id === "data") {
            // Pocket v3.0.2 streams a RIFF header with a deliberately oversized
            // placeholder length. The HTTP response ending is authoritative.
            data = bytes.subarray(start);
            break;
        }
        const end = start + size;
        if (end > bytes.byteLength)
            throw new Error("Pocket TTS returned a truncated WAV file");
        if (id === "fmt ") {
            if (size < 16 || view.getUint16(start, true) !== 1 || view.getUint16(start + 14, true) !== 16) {
                throw new Error("Pocket TTS WAV must use PCM16 audio");
            }
            format = {
                channels: view.getUint16(start + 2, true),
                sampleRate: view.getUint32(start + 4, true),
                blockAlign: view.getUint16(start + 12, true),
            };
        }
        offset = end + (size % 2);
    }
    if (!format || !data || !format.channels || !format.sampleRate || format.blockAlign !== format.channels * 2) {
        throw new Error("Pocket TTS WAV is missing a valid PCM16 format or data chunk");
    }
    const sampleCount = Math.floor(data.byteLength / 2);
    if (!sampleCount || sampleCount % format.channels !== 0) {
        throw new Error("Pocket TTS WAV contains invalid sample data");
    }
    const samples = new Float32Array(sampleCount);
    const sampleView = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let index = 0; index < sampleCount; index += 1) {
        const sample = sampleView.getInt16(index * 2, true);
        samples[index] = sample < 0 ? sample / 32768 : sample / 32767;
    }
    return { frames: samples, sampleRate: format.sampleRate, channels: format.channels };
}
function ascii(bytes, offset, length) {
    return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
//# sourceMappingURL=pocket.js.map