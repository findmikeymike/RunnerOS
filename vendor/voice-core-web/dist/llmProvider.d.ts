import type { WebLlmTransport } from "./transport/types";
export type WebLlmProvider = "openai" | "together_ai" | "groq" | "openrouter" | "custom";
export type WebLlmProviderPreset = Readonly<{
    id: WebLlmProvider;
    label: string;
    defaultModel: string | null;
    defaultProxyBaseUrl: string | null;
}>;
export type WebLlmProviderSelection = {
    provider: WebLlmProvider;
    /** Any model ID accepted by the selected provider. Required for custom. */
    model?: string;
    /** Exact trusted proxy base before `/chat/completions`. Required for custom. */
    proxyBaseUrl?: string;
    sessionToken?: string;
    systemPrompt?: string;
    maxOutputTokens?: number;
    /** Proxy-only headers. Authorization and VoiceCore session overrides are rejected. */
    getProxyHeaders?: () => Promise<Record<string, string>> | Record<string, string>;
};
export type ResolvedWebLlmProviderSelection = Readonly<{
    provider: WebLlmProvider;
    model: string;
    proxyBaseUrl: string;
}>;
export declare const WEB_LLM_PROVIDER_PRESETS: readonly WebLlmProviderPreset[];
export declare function resolveWebLlmProviderSelection(selection: WebLlmProviderSelection): ResolvedWebLlmProviderSelection;
export declare function createLlmProviderTransport(selection: WebLlmProviderSelection): WebLlmTransport;
//# sourceMappingURL=llmProvider.d.ts.map