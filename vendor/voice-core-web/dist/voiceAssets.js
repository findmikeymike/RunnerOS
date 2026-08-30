const INSTALL_STATES = new Set([
    "unavailable", "not_installed", "checking", "downloading", "verifying",
    "installing", "ready", "update_available", "failed",
]);
const PROVIDERS = new Set(["inworld", "pocket_tts", "chatterbox_turbo_webgpu"]);
const KINDS = new Set(["builtin", "uploaded_sample", "exported_embedding"]);
const CONSENT_SOURCES = new Set(["user_upload", "developer_seed", "licensed_catalog", "evaluation_fixture"]);
export function parsePocketInstallStatus(value) {
    const input = record(value, "PocketInstallStatus");
    exactKeys(input, ["state", "modelVersion", "bytesDownloaded", "bytesTotal", "error"]);
    const state = string(input.state, "state");
    if (!INSTALL_STATES.has(state))
        throw new Error(`Unsupported Pocket install state: ${state}`);
    return {
        state,
        ...optionalString(input, "modelVersion"),
        ...optionalInteger(input, "bytesDownloaded"),
        ...optionalInteger(input, "bytesTotal"),
        ...optionalString(input, "error"),
    };
}
export function encodePocketInstallStatus(value) {
    return parsePocketInstallStatus(value);
}
export function parseVoiceRecord(value) {
    const input = record(value, "VoiceRecord");
    exactKeys(input, [
        "id", "provider", "displayName", "language", "kind", "createdAt", "artifactUri", "consent",
        "sourceSha256", "modelRevision", "normalization", "evaluationOnly",
    ]);
    const provider = string(input.provider, "provider");
    const kind = string(input.kind, "kind");
    const createdAt = string(input.createdAt, "createdAt");
    const id = string(input.id, "id");
    const artifactUri = string(input.artifactUri, "artifactUri");
    if (!PROVIDERS.has(provider))
        throw new Error(`Unsupported voice provider: ${provider}`);
    if (!KINDS.has(kind))
        throw new Error(`Unsupported voice asset kind: ${kind}`);
    if (!Number.isFinite(Date.parse(createdAt)))
        throw new Error("createdAt must be ISO-8601");
    if (!artifactUri.startsWith("voicecore://"))
        throw new Error("artifactUri must be app-scoped");
    const consent = record(input.consent, "consent");
    exactKeys(consent, ["granted", "source"]);
    const source = string(consent.source, "consent.source");
    if (!CONSENT_SOURCES.has(source))
        throw new Error(`Unsupported consent source: ${source}`);
    if (typeof consent.granted !== "boolean")
        throw new Error("consent.granted must be boolean");
    let chatterboxFields = {};
    if (provider === "chatterbox_turbo_webgpu") {
        if (input.language !== "en-US")
            throw new Error("Chatterbox voice language is invalid");
        if (artifactUri !== `voicecore://voices/chatterbox_turbo_webgpu/${id}/source.wav`) {
            throw new Error("Chatterbox voice artifactUri is invalid");
        }
        const sourceSha256 = string(input.sourceSha256, "sourceSha256");
        const modelRevision = string(input.modelRevision, "modelRevision");
        if (!/^[a-f0-9]{64}$/i.test(sourceSha256) || !/^[a-f0-9]{40}$/i.test(modelRevision)) {
            throw new Error("Chatterbox voice identity is invalid");
        }
        const normalization = record(input.normalization, "normalization");
        exactKeys(normalization, ["format", "sampleRateHz", "channels"]);
        if (normalization.format !== "pcm_s16le_wav" || normalization.sampleRateHz !== 24_000 || normalization.channels !== 1) {
            throw new Error("Chatterbox voice normalization is invalid");
        }
        if (typeof input.evaluationOnly !== "boolean")
            throw new Error("evaluationOnly must be boolean");
        const validEvaluation = input.evaluationOnly && kind === "builtin" && !consent.granted && source === "evaluation_fixture";
        const validConsented = !input.evaluationOnly && kind === "uploaded_sample" && consent.granted
            && (source === "user_upload" || source === "licensed_catalog");
        if (!validEvaluation && !validConsented)
            throw new Error("Chatterbox voice consent is invalid");
        chatterboxFields = {
            sourceSha256,
            modelRevision,
            normalization: { format: "pcm_s16le_wav", sampleRateHz: 24_000, channels: 1 },
            evaluationOnly: input.evaluationOnly,
        };
    }
    else if (input.sourceSha256 !== undefined || input.modelRevision !== undefined
        || input.normalization !== undefined || input.evaluationOnly !== undefined) {
        throw new Error("Chatterbox voice fields require the Chatterbox provider");
    }
    return {
        id,
        provider: provider,
        displayName: string(input.displayName, "displayName"),
        ...(input.language === undefined ? {} : { language: string(input.language, "language") }),
        kind: kind,
        createdAt,
        artifactUri,
        ...chatterboxFields,
        consent: { granted: consent.granted, source: source },
    };
}
export function assertVoiceIdSupported(voiceId) {
    if (voiceId != null) {
        throw new Error("VoiceCoreWeb: voiceId resolution is not available in this browser build.");
    }
}
export function encodeVoiceRecord(value) {
    return parseVoiceRecord(value);
}
function record(value, name) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(`${name} must be an object`);
    return value;
}
function string(value, name) {
    if (typeof value !== "string" || !value.trim())
        throw new Error(`${name} must be a non-empty string`);
    return value;
}
function exactKeys(value, allowed) {
    const extras = Object.keys(value).filter((key) => !allowed.includes(key));
    if (extras.length)
        throw new Error(`Unsupported fields: ${extras.join(", ")}`);
}
function optionalString(input, key) {
    return input[key] === undefined ? {} : { [key]: string(input[key], key) };
}
function optionalInteger(input, key) {
    const value = input[key];
    if (value === undefined)
        return {};
    if (!Number.isSafeInteger(value) || value < 0)
        throw new Error(`${key} must be a non-negative integer`);
    return { [key]: value };
}
//# sourceMappingURL=voiceAssets.js.map