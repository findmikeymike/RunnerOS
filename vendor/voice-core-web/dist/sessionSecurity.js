const MAX_SESSION_TOKEN_BYTES = 8_192;
export function validateVoiceCoreSessionToken(value) {
    if (value === undefined)
        return undefined;
    if (typeof value !== "string") {
        throw new TypeError("VoiceCore session token must be a string");
    }
    const rawByteLength = new TextEncoder().encode(value).byteLength;
    const token = value.trim();
    if (!token ||
        /[\u0000\r\n]/.test(value) ||
        rawByteLength > MAX_SESSION_TOKEN_BYTES) {
        throw new TypeError("VoiceCore session token must be non-empty, line-break-free, and at most 8192 UTF-8 bytes");
    }
    return token;
}
export function assertSecureHttpSessionTarget(value) {
    const url = resolveRuntimeUrl(value);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLiteralLoopback(url))) {
        throw new TypeError("VoiceCore session tokens require HTTPS or an exact literal-loopback HTTP proxy");
    }
}
export function assertSecureWebSocketSessionTarget(value) {
    const url = resolveRuntimeUrl(value);
    if (url.protocol === "http:")
        url.protocol = "ws:";
    if (url.protocol === "https:")
        url.protocol = "wss:";
    if (url.protocol !== "wss:" && !(url.protocol === "ws:" && isLiteralLoopback(url))) {
        throw new TypeError("VoiceCore session tokens require WSS or an exact literal-loopback WS proxy");
    }
}
function resolveRuntimeUrl(value) {
    const runtimeHref = globalThis.location?.href ?? globalThis.window?.location?.href ?? "https://voicecore.invalid/";
    return new URL(value, runtimeHref);
}
function isLiteralLoopback(url) {
    const hostname = url.hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
//# sourceMappingURL=sessionSecurity.js.map