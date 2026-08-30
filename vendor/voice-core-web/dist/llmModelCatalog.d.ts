export type LlmCatalogProvider = "openai" | "together_ai" | "groq" | "openrouter";
export type LlmModelTier = "economy" | "balanced" | "quality";
export type LlmModelRecommendation = Readonly<{
    id: string;
    label: string;
    tier: LlmModelTier;
}>;
export type LlmModelCatalogProvider = Readonly<{
    id: LlmCatalogProvider;
    label: string;
    defaultModel: string;
    models: readonly LlmModelRecommendation[];
}>;
export type LlmModelCatalog = Readonly<{
    schemaVersion: 1;
    catalogVersion: string;
    updatedAt: string;
    kind: "recommended_models";
    providers: readonly LlmModelCatalogProvider[];
}>;
export declare const BUILT_IN_LLM_MODEL_CATALOG: LlmModelCatalog;
/** Provenance for the compiled Voice Core artifact only; remote JSON cannot supply this. */
export declare const BUILT_IN_LLM_MODEL_CATALOG_PROVENANCE: Readonly<{
    source: "voice_core_builtin";
    reviewStatus: "official_provider_catalogs_reviewed";
    reviewedAt: string;
}>;
/**
 * Parses an operator-delivered recommendation catalog. Catalog data can only
 * supply labels and model IDs; provider routes and credentials remain compiled
 * SDK policy. Keep a custom-model text field beside any UI using this catalog.
 */
export declare function parseLlmModelCatalogJson(json: string): LlmModelCatalog;
export declare function getLlmCatalogProvider(catalog: LlmModelCatalog, provider: LlmCatalogProvider): LlmModelCatalogProvider;
//# sourceMappingURL=llmModelCatalog.d.ts.map