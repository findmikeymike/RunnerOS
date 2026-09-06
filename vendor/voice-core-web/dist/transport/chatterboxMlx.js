import { validateVoiceCoreSessionToken } from "../sessionSecurity.js";
const MAX_TEXT_BYTES = 16 * 1024;
const MAX_AUDIO_BYTES = 32 * 1024 * 1024;
export async function checkChatterboxMlxHealth(options) {
    const validated = validateOptions(options);
    const response = await fetch(`${validated.apiBaseUrl}/health`, {
        method: "GET",
        redirect: "error",
        headers: buildHeaders(validated),
    });
    if (!response.ok)
        throw new Error("Chatterbox MLX host is unavailable");
    const payload = await response.json();
    if (payload.ready !== true || payload.backend !== "swift-mlx" || payload.sampleRate !== 24_000) {
        throw new Error("Chatterbox MLX health response is invalid");
    }
}
export function createChatterboxMlxTransport(options) {
    const validated = validateOptions(options);
    return {
        async synthesize(request) {
            const text = request.text.trim();
            if (!text || new TextEncoder().encode(text).byteLength > MAX_TEXT_BYTES) {
                throw new Error("Chatterbox MLX text must be non-empty and at most 16384 bytes");
            }
            const started = performance.now();
            const response = await fetch(`${validated.apiBaseUrl}/tts`, {
                method: "POST",
                redirect: "error",
                headers: { ...buildHeaders(validated), "Content-Type": "application/json" },
                body: JSON.stringify({ text }),
                signal: request.signal,
            });
            if (!response.ok)
                throw new Error(`Chatterbox MLX synthesis failed with HTTP ${response.status}`);
            if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("application/octet-stream")) {
                await response.body?.cancel().catch(() => undefined);
                throw new Error("Chatterbox MLX synthesis returned an invalid content type");
            }
            const contentLength = Number(response.headers.get("content-length") ?? 0);
            if (Number.isFinite(contentLength) && contentLength > MAX_AUDIO_BYTES) {
                await response.body?.cancel().catch(() => undefined);
                throw new Error("Chatterbox MLX synthesis exceeded its audio limit");
            }
            const buffer = await response.arrayBuffer();
            if (buffer.byteLength === 0
                || buffer.byteLength > MAX_AUDIO_BYTES
                || buffer.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
                throw new Error("Chatterbox MLX synthesis returned invalid audio");
            }
            const frames = new Float32Array(buffer);
            if (frames.some((sample) => !Number.isFinite(sample))) {
                throw new Error("Chatterbox MLX synthesis returned non-finite audio");
            }
            options.onDiagnostic?.(`Chatterbox MLX synthesized ${(frames.length / 24_000).toFixed(2)}s in ${(performance.now() - started).toFixed(0)}ms`);
            return (async function* () {
                if (request.signal.aborted)
                    throw createAbortError();
                yield { frames, sampleRate: 24_000, channels: 1 };
            })();
        },
    };
}
function validateOptions(options) {
    const url = new URL(options.apiBaseUrl, typeof window === "undefined" ? "http://127.0.0.1" : window.location.href);
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1" || url.hostname === "[::1]";
    const sameOrigin = typeof window !== "undefined" && url.origin === window.location.origin;
    if ((!sameOrigin && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.search || url.hash) {
        throw new Error("Chatterbox MLX apiBaseUrl must be same-origin or loopback HTTP");
    }
    return {
        apiBaseUrl: url.toString().replace(/\/$/, ""),
        sessionToken: validateVoiceCoreSessionToken(options.sessionToken) ?? null,
        getAuthHeaders: options.getAuthHeaders,
    };
}
function buildHeaders(options) {
    const headers = { ...(options.getAuthHeaders?.() ?? {}) };
    if (options.sessionToken)
        headers["X-VoiceCore-Session"] = options.sessionToken;
    return headers;
}
function createAbortError() {
    return Object.assign(new Error("Chatterbox synthesis aborted"), { name: "AbortError" });
}
//# sourceMappingURL=chatterboxMlx.js.map