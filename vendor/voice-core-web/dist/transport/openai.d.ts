import type { VoiceRuntimeConfig } from "../types";
import type { WebTransportBundle } from "./types";
export type OpenAiTransportBundleOptions = Pick<VoiceRuntimeConfig, "openAiApiKey" | "sessionToken" | "openAiModel" | "openAiMaxOutputTokens" | "openAiTtsModel" | "openAiTtsVoice" | "systemPrompt"> & {
    baseUrl?: string;
    allowInsecureBrowserProviderKeys?: boolean;
    getAuthHeaders?: () => Promise<Record<string, string>> | Record<string, string>;
};
export declare function createOpenAiTransportBundle(config: OpenAiTransportBundleOptions): WebTransportBundle;
//# sourceMappingURL=openai.d.ts.map