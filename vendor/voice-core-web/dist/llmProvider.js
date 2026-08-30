import { createOpenAiTransportBundle } from "./transport/openai.js";
import { assertSecureHttpSessionTarget, validateVoiceCoreSessionToken, } from "./sessionSecurity.js";
import { BUILT_IN_LLM_MODEL_CATALOG, getLlmCatalogProvider, } from "./llmModelCatalog.js";
const DEFINITIONS = Object.freeze({
    openai: Object.freeze({
        id: "openai",
        label: getLlmCatalogProvider(BUILT_IN_LLM_MODEL_CATALOG, "openai").label,
        defaultModel: getLlmCatalogProvider(BUILT_IN_LLM_MODEL_CATALOG, "openai").defaultModel,
        defaultProxyBaseUrl: "/api/openai",
    }),
    together_ai: Object.freeze({
        id: "together_ai",
        label: getLlmCatalogProvider(BUILT_IN_LLM_MODEL_CATALOG, "together_ai").label,
        defaultModel: getLlmCatalogProvider(BUILT_IN_LLM_MODEL_CATALOG, "together_ai").defaultModel,
        defaultProxyBaseUrl: "/api/together",
    }),
    groq: Object.freeze({
        id: "groq",
        label: getLlmCatalogProvider(BUILT_IN_LLM_MODEL_CATALOG, "groq").label,
        defaultModel: getLlmCatalogProvider(BUILT_IN_LLM_MODEL_CATALOG, "groq").defaultModel,
        defaultProxyBaseUrl: "/api/groq",
    }),
    openrouter: Object.freeze({
        id: "openrouter",
        label: getLlmCatalogProvider(BUILT_IN_LLM_MODEL_CATALOG, "openrouter").label,
        defaultModel: getLlmCatalogProvider(BUILT_IN_LLM_MODEL_CATALOG, "openrouter").defaultModel,
        defaultProxyBaseUrl: "/api/openrouter",
    }),
    custom: Object.freeze({
        id: "custom",
        label: "Custom / self-hosted",
        defaultModel: null,
        defaultProxyBaseUrl: null,
    }),
});
export const WEB_LLM_PROVIDER_PRESETS = Object.freeze([
    DEFINITIONS.openai,
    DEFINITIONS.together_ai,
    DEFINITIONS.groq,
    DEFINITIONS.openrouter,
    DEFINITIONS.custom,
]);
const PROVIDER_HOSTS = new Set([
    "api.openai.com",
    "api.together.ai",
    "api.groq.com",
    "openrouter.ai",
]);
const MAX_MODEL_ID_LENGTH = 512;
const MAX_PROXY_HEADERS = 32;
const MAX_OUTPUT_TOKENS = 32_768;
function utf8ByteLength(value) {
    return new TextEncoder().encode(value).byteLength;
}
export function resolveWebLlmProviderSelection(selection) {
    if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
        throw new TypeError("LLM provider selection must be an object");
    }
    if (!Object.prototype.hasOwnProperty.call(DEFINITIONS, selection.provider)) {
        throw new TypeError(`Unsupported LLM provider: ${String(selection.provider)}`);
    }
    const definition = DEFINITIONS[selection.provider];
    if (selection.model !== undefined && selection.model !== selection.model.trim()) {
        throw new TypeError("LLM model must be trimmed");
    }
    const model = selection.model || definition.defaultModel;
    if (!model ||
        utf8ByteLength(model) > MAX_MODEL_ID_LENGTH ||
        /[\u0000-\u001f\u007f]/.test(model)) {
        throw new TypeError("LLM model must be a non-empty model ID of at most 512 bytes");
    }
    if (selection.proxyBaseUrl !== undefined &&
        selection.proxyBaseUrl !== selection.proxyBaseUrl.trim()) {
        throw new TypeError("LLM proxyBaseUrl must be trimmed");
    }
    const proxyBaseUrl = selection.proxyBaseUrl || definition.defaultProxyBaseUrl;
    if (!proxyBaseUrl) {
        throw new TypeError("Custom LLM provider requires proxyBaseUrl");
    }
    rejectDirectProviderEndpoint(proxyBaseUrl);
    if (validateVoiceCoreSessionToken(selection.sessionToken)) {
        assertSecureHttpSessionTarget(proxyBaseUrl);
    }
    return Object.freeze({
        provider: definition.id,
        model,
        proxyBaseUrl,
    });
}
export function createLlmProviderTransport(selection) {
    const resolved = resolveWebLlmProviderSelection(selection);
    validateTransportOptions(selection);
    const transport = createOpenAiTransportBundle({
        baseUrl: resolved.proxyBaseUrl,
        openAiModel: resolved.model,
        sessionToken: selection.sessionToken,
        systemPrompt: selection.systemPrompt,
        openAiMaxOutputTokens: selection.maxOutputTokens,
        getAuthHeaders: selection.getProxyHeaders
            ? async () => validateProxyHeaders(await selection.getProxyHeaders())
            : undefined,
    }).llm;
    if (!transport) {
        throw new Error("OpenAI-compatible LLM transport was not created");
    }
    return transport;
}
function validateTransportOptions(selection) {
    if (selection.maxOutputTokens !== undefined &&
        (!Number.isInteger(selection.maxOutputTokens) ||
            selection.maxOutputTokens < 1 ||
            selection.maxOutputTokens > MAX_OUTPUT_TOKENS)) {
        throw new RangeError("maxOutputTokens must be an integer from 1 through 32768");
    }
    validateVoiceCoreSessionToken(selection.sessionToken);
}
function rejectDirectProviderEndpoint(value) {
    if (value.startsWith("/") && !value.startsWith("//"))
        return;
    let parsed;
    try {
        parsed = new URL(value);
    }
    catch {
        return; // The transport performs the canonical URL-shape validation.
    }
    const host = parsed.hostname.toLowerCase().replace(/\.+$/, "");
    if (PROVIDER_HOSTS.has(host)) {
        throw new TypeError("Browser LLM selection requires a trusted proxy; direct cloud-provider endpoints are disabled");
    }
}
function validateProxyHeaders(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new TypeError("getProxyHeaders must return a string header record");
    }
    const entries = Object.entries(input);
    if (entries.length > MAX_PROXY_HEADERS) {
        throw new TypeError("getProxyHeaders returned more than 32 headers");
    }
    const headers = {};
    for (const [name, value] of entries) {
        const normalizedName = name.trim().toLowerCase();
        if (normalizedName === "authorization" || normalizedName === "x-voicecore-session") {
            throw new TypeError(`${name} is controlled by the trusted Voice Core proxy contract`);
        }
        if (!normalizedName ||
            typeof value !== "string" ||
            /[\r\n]/.test(name) ||
            /[\r\n]/.test(value)) {
            throw new TypeError("Proxy headers must use non-empty names and line-break-free strings");
        }
        headers[name] = value;
    }
    return headers;
}
//# sourceMappingURL=llmProvider.js.map