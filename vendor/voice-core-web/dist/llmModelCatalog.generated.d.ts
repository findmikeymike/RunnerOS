export declare const GENERATED_LLM_MODEL_CATALOG: {
    readonly schemaVersion: 1;
    readonly catalogVersion: "2026-08-30";
    readonly updatedAt: "2026-08-30T00:00:00Z";
    readonly kind: "recommended_models";
    readonly providers: readonly [{
        readonly id: "openai";
        readonly label: "OpenAI";
        readonly defaultModel: "gpt-4o-mini";
        readonly models: readonly [{
            readonly id: "gpt-4o-mini";
            readonly label: "GPT-4o mini";
            readonly tier: "economy";
        }, {
            readonly id: "gpt-4.1-mini";
            readonly label: "GPT-4.1 mini";
            readonly tier: "balanced";
        }, {
            readonly id: "gpt-4.1";
            readonly label: "GPT-4.1";
            readonly tier: "quality";
        }];
    }, {
        readonly id: "together_ai";
        readonly label: "Together AI";
        readonly defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo";
        readonly models: readonly [{
            readonly id: "Qwen/Qwen3.5-9B";
            readonly label: "Qwen 3.5 9B";
            readonly tier: "economy";
        }, {
            readonly id: "MiniMaxAI/MiniMax-M2.7";
            readonly label: "MiniMax M2.7";
            readonly tier: "balanced";
        }, {
            readonly id: "meta-llama/Llama-3.3-70B-Instruct-Turbo";
            readonly label: "Llama 3.3 70B Instruct Turbo";
            readonly tier: "quality";
        }];
    }, {
        readonly id: "groq";
        readonly label: "Groq";
        readonly defaultModel: "openai/gpt-oss-120b";
        readonly models: readonly [{
            readonly id: "openai/gpt-oss-20b";
            readonly label: "GPT-OSS 20B";
            readonly tier: "economy";
        }, {
            readonly id: "qwen/qwen3.6-27b";
            readonly label: "Qwen 3.6 27B";
            readonly tier: "balanced";
        }, {
            readonly id: "openai/gpt-oss-120b";
            readonly label: "GPT-OSS 120B";
            readonly tier: "quality";
        }];
    }, {
        readonly id: "openrouter";
        readonly label: "OpenRouter";
        readonly defaultModel: "openai/gpt-4o-mini";
        readonly models: readonly [{
            readonly id: "openai/gpt-4o-mini";
            readonly label: "GPT-4o mini";
            readonly tier: "economy";
        }, {
            readonly id: "openrouter/auto";
            readonly label: "Auto Router";
            readonly tier: "balanced";
        }, {
            readonly id: "openai/gpt-4.1";
            readonly label: "GPT-4.1";
            readonly tier: "quality";
        }];
    }];
};
//# sourceMappingURL=llmModelCatalog.generated.d.ts.map