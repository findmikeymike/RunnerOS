import { GENERATED_LLM_MODEL_CATALOG } from "./llmModelCatalog.generated.js";
const PROVIDER_IDS = ["openai", "together_ai", "groq", "openrouter"];
const PROVIDER_ID_SET = new Set(PROVIDER_IDS);
const TIERS = new Set(["economy", "balanced", "quality"]);
const MAX_JSON_BYTES = 64 * 1024;
const MAX_TEXT_LENGTH = 512;
export const BUILT_IN_LLM_MODEL_CATALOG = validateAndFreeze(GENERATED_LLM_MODEL_CATALOG);
/** Provenance for the compiled Voice Core artifact only; remote JSON cannot supply this. */
export const BUILT_IN_LLM_MODEL_CATALOG_PROVENANCE = Object.freeze({
    source: "voice_core_builtin",
    reviewStatus: "official_provider_catalogs_reviewed",
    reviewedAt: BUILT_IN_LLM_MODEL_CATALOG.updatedAt,
});
/**
 * Parses an operator-delivered recommendation catalog. Catalog data can only
 * supply labels and model IDs; provider routes and credentials remain compiled
 * SDK policy. Keep a custom-model text field beside any UI using this catalog.
 */
export function parseLlmModelCatalogJson(json) {
    if (typeof json !== "string")
        throw new TypeError("LLM model catalog must be a JSON string");
    if (json.length > MAX_JSON_BYTES || new TextEncoder().encode(json).byteLength > MAX_JSON_BYTES) {
        throw new RangeError(`LLM model catalog exceeds ${MAX_JSON_BYTES} bytes`);
    }
    let value;
    try {
        value = JSON.parse(json);
    }
    catch {
        throw new TypeError("LLM model catalog is not valid JSON");
    }
    return validateAndFreeze(value);
}
export function getLlmCatalogProvider(catalog, provider) {
    const match = catalog.providers.find((candidate) => candidate.id === provider);
    if (!match)
        throw new TypeError(`LLM model catalog is missing ${provider}`);
    return match;
}
function validateAndFreeze(input) {
    exactObject(input, ["schemaVersion", "catalogVersion", "updatedAt", "kind", "providers"], "catalog");
    if (input.schemaVersion !== 1)
        fail("catalog.schemaVersion must be 1");
    const catalogVersion = safeText(input.catalogVersion, "catalog.catalogVersion", 64);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(catalogVersion)) {
        fail("catalog.catalogVersion must use YYYY-MM-DD");
    }
    const updatedAt = safeText(input.updatedAt, "catalog.updatedAt", 64);
    if (!isExactUtcDateTime(updatedAt))
        fail("catalog.updatedAt must use YYYY-MM-DDTHH:mm:ssZ");
    if (!updatedAt.startsWith(`${catalogVersion}T`)) {
        fail("catalog.updatedAt date must match catalog.catalogVersion");
    }
    if (input.kind !== "recommended_models") {
        fail("catalog.kind must be recommended_models");
    }
    if (!Array.isArray(input.providers) || input.providers.length !== PROVIDER_IDS.length) {
        fail(`catalog.providers must contain exactly ${PROVIDER_IDS.length} providers`);
    }
    const seenProviders = new Set();
    const providers = input.providers.map((rawProvider, providerIndex) => {
        const path = `catalog.providers[${providerIndex}]`;
        exactObject(rawProvider, ["id", "label", "defaultModel", "models"], path);
        if (typeof rawProvider.id !== "string" || !PROVIDER_ID_SET.has(rawProvider.id)) {
            fail(`${path}.id is unsupported`);
        }
        if (seenProviders.has(rawProvider.id))
            fail(`${path}.id is duplicated`);
        seenProviders.add(rawProvider.id);
        const id = rawProvider.id;
        const label = safeText(rawProvider.label, `${path}.label`, 64);
        const defaultModel = safeModelId(rawProvider.defaultModel, `${path}.defaultModel`);
        if (!Array.isArray(rawProvider.models) || rawProvider.models.length < 1 || rawProvider.models.length > 3) {
            fail(`${path}.models must contain 1 through 3 recommendations`);
        }
        const modelIds = new Set();
        const modelTiers = new Set();
        const models = rawProvider.models.map((rawModel, modelIndex) => {
            const modelPath = `${path}.models[${modelIndex}]`;
            exactObject(rawModel, ["id", "label", "tier"], modelPath);
            const modelId = safeModelId(rawModel.id, `${modelPath}.id`);
            if (modelIds.has(modelId))
                fail(`${modelPath}.id is duplicated`);
            modelIds.add(modelId);
            const modelLabel = safeText(rawModel.label, `${modelPath}.label`, 96);
            if (typeof rawModel.tier !== "string" || !TIERS.has(rawModel.tier)) {
                fail(`${modelPath}.tier is unsupported`);
            }
            if (modelTiers.has(rawModel.tier))
                fail(`${modelPath}.tier is duplicated`);
            modelTiers.add(rawModel.tier);
            return Object.freeze({ id: modelId, label: modelLabel, tier: rawModel.tier });
        });
        if (!modelIds.has(defaultModel))
            fail(`${path}.defaultModel must identify one of its recommendations`);
        return Object.freeze({ id, label, defaultModel, models: Object.freeze(models) });
    });
    for (const id of PROVIDER_IDS) {
        if (!seenProviders.has(id))
            fail(`catalog.providers is missing ${id}`);
    }
    return Object.freeze({
        schemaVersion: 1,
        catalogVersion,
        updatedAt,
        kind: "recommended_models",
        providers: Object.freeze(providers),
    });
}
function exactObject(value, keys, path) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        fail(`${path} must be an object`);
    const expected = new Set(keys);
    for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(value, key))
            fail(`${path} is missing ${key}`);
    }
    for (const key of Object.keys(value)) {
        if (!expected.has(key))
            fail(`${path} contains unsupported field ${key}`);
    }
}
function safeText(value, path, maxLength = MAX_TEXT_LENGTH) {
    if (typeof value !== "string" ||
        value.length < 1 ||
        value.length > maxLength ||
        value !== value.trim() ||
        /\p{C}/u.test(value)) {
        fail(`${path} must be a non-empty trimmed control-free string of at most ${maxLength} characters`);
    }
    return value;
}
function safeModelId(value, path) {
    const modelId = safeText(value, path);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/+-]*$/.test(modelId)) {
        fail(`${path} must use unambiguous ASCII model-ID characters`);
    }
    return modelId;
}
function isExactUtcDateTime(value) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value))
        return false;
    const parsed = new Date(value);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value.replace("Z", ".000Z");
}
function fail(message) {
    throw new TypeError(message);
}
//# sourceMappingURL=llmModelCatalog.js.map