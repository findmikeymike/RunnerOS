import { validateVoiceCoreSessionToken } from "../sessionSecurity.js";
const CONFIG_KEYS = new Set([
    "sttProvider", "moonshineModelId", "sttComputePolicy",
    "assemblyAiApiKey", "openAiApiKey", "inworldApiKey", "inworldRuntimeKey",
    "sessionToken", "requireCommercialAccess", "allowInsecureBrowserProviderKeys",
    "inworldVoiceId", "voiceId", "inworldModelId", "openAiModel",
    "openAiMaxOutputTokens", "openAiTtsModel", "openAiTtsVoice", "systemPrompt",
    "sampleRateHint", "outputSampleRateHz", "requireCrossOriginIsolation",
    "preferSharedArrayBuffer", "echoCancellation", "noiseSuppression",
    "autoGainControl", "inputDeviceId", "outputDeviceId", "inputBatchFrames",
    "endpointing",
]);
const STRING_LIMITS = {
    moonshineModelId: 128,
    assemblyAiApiKey: 8_192,
    openAiApiKey: 8_192,
    inworldApiKey: 8_192,
    inworldRuntimeKey: 8_192,
    sessionToken: 8_192,
    inworldVoiceId: 512,
    voiceId: 512,
    inworldModelId: 512,
    openAiModel: 512,
    openAiTtsModel: 512,
    openAiTtsVoice: 512,
    systemPrompt: 100_000,
    inputDeviceId: 2_048,
    outputDeviceId: 2_048,
};
const BOOLEAN_KEYS = [
    "requireCommercialAccess", "allowInsecureBrowserProviderKeys",
    "requireCrossOriginIsolation", "preferSharedArrayBuffer", "echoCancellation",
    "noiseSuppression", "autoGainControl",
];
export function validateVoiceRuntimeConfig(value) {
    if (!isRecord(value))
        throw new TypeError("VoiceCore config must be an object");
    for (const key of Object.keys(value)) {
        if (!CONFIG_KEYS.has(key)) {
            throw new TypeError(`VoiceCore config contains unknown field: ${key}`);
        }
    }
    const config = { ...value };
    for (const [key, limit] of Object.entries(STRING_LIMITS)) {
        const field = config[key];
        if (field === undefined)
            continue;
        if (typeof field !== "string")
            throw new TypeError(`VoiceCore ${key} must be a string`);
        if (!field.trim())
            throw new RangeError(`VoiceCore ${key} must not be empty`);
        if (new TextEncoder().encode(field).byteLength > limit) {
            throw new RangeError(`VoiceCore ${key} exceeds ${limit} UTF-8 bytes`);
        }
    }
    for (const key of BOOLEAN_KEYS) {
        if (config[key] !== undefined && typeof config[key] !== "boolean") {
            throw new TypeError(`VoiceCore ${key} must be a boolean`);
        }
    }
    if (config.sttProvider !== undefined &&
        config.sttProvider !== "assembly_ai" && config.sttProvider !== "moonshine") {
        throw new RangeError("VoiceCore sttProvider is not supported");
    }
    if (config.sttComputePolicy !== undefined &&
        !["auto", "cpu", "accelerator_preferred"].includes(config.sttComputePolicy)) {
        throw new RangeError("VoiceCore sttComputePolicy is not supported");
    }
    if (config.sttProvider === "moonshine") {
        throw new Error("Moonshine STT is unavailable in the Web build");
    }
    assertIntegerRange(config.openAiMaxOutputTokens, "openAiMaxOutputTokens", 1, 32_768);
    assertIntegerRange(config.sampleRateHint, "sampleRateHint", 8_000, 192_000);
    assertIntegerRange(config.outputSampleRateHz, "outputSampleRateHz", 8_000, 192_000);
    assertIntegerRange(config.inputBatchFrames, "inputBatchFrames", 128, 131_072);
    if (config.endpointing !== undefined) {
        if (!isRecord(config.endpointing))
            throw new TypeError("VoiceCore endpointing must be an object");
        for (const key of Object.keys(config.endpointing)) {
            if (key !== "minEndpointingDelayMs" && key !== "requiredSilenceMs") {
                throw new TypeError(`VoiceCore endpointing contains unknown field: ${key}`);
            }
        }
        assertIntegerRange(config.endpointing.minEndpointingDelayMs, "endpointing.minEndpointingDelayMs", 0, 60_000);
        assertIntegerRange(config.endpointing.requiredSilenceMs, "endpointing.requiredSilenceMs", 0, 60_000);
    }
    if (config.assemblyAiApiKey || config.inworldApiKey || config.inworldRuntimeKey) {
        throw new Error("AssemblyAI and Inworld secrets are not supported in browser config; use temporary tokens or a trusted proxy");
    }
    const hasDirectProviderKey = Boolean(config.openAiApiKey);
    if (hasDirectProviderKey && !config.allowInsecureBrowserProviderKeys) {
        throw new Error("Browser provider keys require allowInsecureBrowserProviderKeys: true; production apps must use a trusted proxy");
    }
    if (hasDirectProviderKey && config.requireCommercialAccess) {
        throw new Error("Commercial browser mode forbids direct provider keys; use a trusted proxy");
    }
    const sessionToken = validateVoiceCoreSessionToken(config.sessionToken);
    return {
        ...config,
        ...(sessionToken ? { sessionToken } : {}),
        ...(config.endpointing ? { endpointing: { ...config.endpointing } } : {}),
    };
}
function assertIntegerRange(value, name, minimum, maximum) {
    if (value === undefined)
        return;
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
        throw new RangeError(`VoiceCore ${name} must be an integer from ${minimum} to ${maximum}`);
    }
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=config.js.map