import { assertSecureHttpSessionTarget, validateVoiceCoreSessionToken, } from "../sessionSecurity.js";
const OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_LLM_MODEL = "gpt-4o-mini";
const DEFAULT_LLM_MAX_OUTPUT_TOKENS = 180;
const DEFAULT_TTS_MODEL = "gpt-4o-mini-tts";
const DEFAULT_TTS_VOICE = "coral";
const DEFAULT_TTS_SAMPLE_RATE_HZ = 24_000;
const MAX_SSE_EVENT_CHARACTERS = 256 * 1024;
export function createOpenAiTransportBundle(config) {
    if (!config.openAiApiKey && !config.getAuthHeaders && !config.baseUrl) {
        throw new Error("OpenAI transport requires openAiApiKey, getAuthHeaders, or baseUrl");
    }
    const baseUrl = (config.baseUrl ?? OPENAI_BASE_URL).trim().replace(/\/+$/, "");
    assertHttpBaseUrl(baseUrl);
    const sessionToken = validateVoiceCoreSessionToken(config.sessionToken);
    if (sessionToken) {
        assertSecureHttpSessionTarget(baseUrl);
    }
    const directOpenAi = isOpenAiProviderUrl(baseUrl);
    if (config.openAiApiKey && !config.allowInsecureBrowserProviderKeys) {
        throw new Error("Direct browser OpenAI keys require allowInsecureBrowserProviderKeys: true; use a trusted proxy in production");
    }
    if (directOpenAi && !config.allowInsecureBrowserProviderKeys) {
        throw new Error("Direct browser OpenAI access is disabled; configure a trusted proxy baseUrl");
    }
    if (directOpenAi && sessionToken) {
        throw new Error("VoiceCore session tokens must never be sent to the OpenAI provider; use a trusted proxy");
    }
    const sharedConfig = {
        apiKey: config.openAiApiKey,
        sessionToken,
        baseUrl,
        getAuthHeaders: config.getAuthHeaders,
        llmModel: config.openAiModel ?? DEFAULT_LLM_MODEL,
        llmMaxOutputTokens: config.openAiMaxOutputTokens ?? DEFAULT_LLM_MAX_OUTPUT_TOKENS,
        systemPrompt: config.systemPrompt?.trim() ?? "",
        ttsModel: config.openAiTtsModel ?? DEFAULT_TTS_MODEL,
        ttsVoice: config.openAiTtsVoice ?? DEFAULT_TTS_VOICE,
    };
    return {
        llm: new OpenAiLlmTransport(sharedConfig),
        tts: new OpenAiTtsTransport(sharedConfig),
    };
}
class OpenAiLlmTransport {
    config;
    constructor(config) {
        this.config = config;
    }
    async generateReply(request) {
        const contextMessages = parseContextMessages(request.contextJson);
        const hasLatestUserTurn = contextMessages.length > 0 &&
            contextMessages[contextMessages.length - 1]?.role === "user" &&
            contextMessages[contextMessages.length - 1]?.content === request.userText;
        const messages = [
            ...(this.config.systemPrompt
                ? [{
                        role: "system",
                        content: this.config.systemPrompt,
                    }]
                : []),
            ...contextMessages.map((message) => ({
                role: normalizeRole(message.role),
                content: message.content,
            })),
            ...(!hasLatestUserTurn
                ? [{
                        role: "user",
                        content: request.userText,
                    }]
                : []),
        ];
        const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
            method: "POST",
            headers: await buildAuthHeaders(this.config),
            body: JSON.stringify({
                model: this.config.llmModel,
                stream: true,
                temperature: 0.7,
                max_tokens: request.maxOutputTokens ?? this.config.llmMaxOutputTokens,
                messages,
            }),
            signal: request.signal,
        });
        if (!response.ok || !response.body) {
            await discardUntrustedErrorBody(response);
            throw new Error(`OpenAI-compatible chat completions request failed: ${response.status} ${response.statusText}`);
        }
        return streamOpenAiResponse(response.body, request.signal);
    }
}
class OpenAiTtsTransport {
    config;
    constructor(config) {
        this.config = config;
    }
    async synthesize(request) {
        const response = await fetch(`${this.config.baseUrl}/audio/speech`, {
            method: "POST",
            headers: await buildAuthHeaders(this.config),
            body: JSON.stringify({
                model: this.config.ttsModel,
                voice: this.config.ttsVoice,
                input: request.text,
                response_format: "pcm",
            }),
            signal: request.signal,
        });
        if (!response.ok || !response.body) {
            await discardUntrustedErrorBody(response);
            throw new Error(`OpenAI speech request failed: ${response.status} ${response.statusText}`);
        }
        return streamPcmAudio(response.body, request.signal);
    }
}
function isOpenAiProviderUrl(value) {
    try {
        const hostname = new URL(value).hostname.toLowerCase().replace(/\.+$/, "");
        return hostname === "api.openai.com";
    }
    catch {
        return false;
    }
}
function assertHttpBaseUrl(value) {
    if (/[\\\u0000-\u001f\u007f]/.test(value)) {
        throw new TypeError("OpenAI baseUrl must not contain backslashes or control characters");
    }
    if (value.startsWith("/") && !value.startsWith("//")) {
        const sentinelOrigin = "https://voicecore.invalid";
        const resolved = new URL(value, sentinelOrigin);
        if (resolved.origin !== sentinelOrigin) {
            throw new TypeError("OpenAI same-origin proxy path escaped its origin");
        }
        return;
    }
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new TypeError("OpenAI baseUrl must be a same-origin path or absolute HTTP(S) URL");
    }
    if ((url.protocol !== "http:" && url.protocol !== "https:") ||
        url.username ||
        url.password ||
        url.search ||
        url.hash) {
        throw new TypeError("OpenAI baseUrl must be a credential-free HTTP(S) base URL without query or fragment");
    }
}
async function* streamOpenAiResponse(body, signal) {
    for await (const event of parseSseEvents(body, signal)) {
        const choice = Array.isArray(event.choices) && isRecord(event.choices[0])
            ? event.choices[0]
            : null;
        const delta = isRecord(choice?.delta) && typeof choice.delta.content === "string"
            ? choice.delta.content
            : "";
        const finishReason = typeof choice?.finish_reason === "string"
            ? choice.finish_reason
            : "";
        if (delta) {
            yield { text: delta, done: false };
            continue;
        }
        if (finishReason) {
            yield { text: "", done: true };
            return;
        }
    }
}
async function* streamPcmAudio(body, signal) {
    const reader = body.getReader();
    let remainder = new Uint8Array(0);
    try {
        while (true) {
            if (signal.aborted) {
                throw new DOMException("The operation was aborted", "AbortError");
            }
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            const chunk = mergeBytes(remainder, value);
            const evenLength = chunk.length - (chunk.length % 2);
            remainder = chunk.subarray(evenLength);
            if (evenLength === 0) {
                continue;
            }
            const frames = new Float32Array(evenLength / 2);
            for (let index = 0; index < evenLength; index += 2) {
                const sample = chunk[index] | (chunk[index + 1] << 8);
                const signed = sample > 0x7fff ? sample - 0x10000 : sample;
                frames[index / 2] = signed / 32768;
            }
            yield {
                frames,
                sampleRate: DEFAULT_TTS_SAMPLE_RATE_HZ,
                channels: 1,
            };
        }
    }
    finally {
        reader.releaseLock();
    }
}
async function* parseSseEvents(body, signal) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
        while (true) {
            if (signal.aborted) {
                throw new DOMException("The operation was aborted", "AbortError");
            }
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            buffer = (buffer + decoder.decode(value, { stream: true }))
                .replace(/\r\n/g, "\n")
                .replace(/\r/g, "\n");
            while (true) {
                const boundaryIndex = buffer.indexOf("\n\n");
                if (boundaryIndex === -1) {
                    break;
                }
                if (boundaryIndex > MAX_SSE_EVENT_CHARACTERS) {
                    throw new Error(`OpenAI-compatible SSE event exceeds ${MAX_SSE_EVENT_CHARACTERS} characters`);
                }
                const rawEvent = buffer.slice(0, boundaryIndex);
                buffer = buffer.slice(boundaryIndex + 2);
                const payload = rawEvent
                    .split("\n")
                    .filter((line) => line.startsWith("data:"))
                    .map((line) => line.slice(5).trim())
                    .join("\n");
                if (!payload || payload === "[DONE]") {
                    continue;
                }
                yield JSON.parse(payload);
            }
            if (buffer.length > MAX_SSE_EVENT_CHARACTERS) {
                throw new Error(`OpenAI-compatible SSE event exceeds ${MAX_SSE_EVENT_CHARACTERS} characters`);
            }
        }
    }
    finally {
        reader.releaseLock();
    }
}
function parseContextMessages(contextJson) {
    try {
        const parsed = JSON.parse(contextJson);
        return parsed.filter((message) => typeof message?.content === "string");
    }
    catch {
        return [];
    }
}
async function buildAuthHeaders(config) {
    if (config.sessionToken) {
        // Recheck at the request boundary so a relative proxy cannot inherit a
        // remote plaintext browser origin after construction.
        assertSecureHttpSessionTarget(config.baseUrl);
    }
    const dynamicHeaders = config.getAuthHeaders
        ? await config.getAuthHeaders()
        : {};
    return {
        ...dynamicHeaders,
        ...(config.sessionToken ? { "X-VoiceCore-Session": config.sessionToken } : {}),
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        "Content-Type": "application/json",
    };
}
async function discardUntrustedErrorBody(response) {
    try {
        await response.body?.cancel();
    }
    catch {
        // The status-only error remains safe even if the body cannot be cancelled.
    }
}
function extractErrorMessage(event, fallback) {
    if (typeof event.message === "string" && event.message.trim()) {
        return event.message;
    }
    const error = isRecord(event.error) ? event.error : null;
    if (typeof error?.message === "string" && error.message.trim()) {
        return error.message;
    }
    return fallback;
}
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function normalizeRole(role) {
    if (role === "assistant" || role === "system") {
        return role;
    }
    return "user";
}
function mergeBytes(left, right) {
    if (left.length === 0) {
        return right;
    }
    const merged = new Uint8Array(left.length + right.length);
    merged.set(left);
    merged.set(right, left.length);
    return merged;
}
//# sourceMappingURL=openai.js.map