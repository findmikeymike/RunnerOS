export type DisposableConditioning = {
    audio_features: {
        dispose(): void;
    };
    audio_tokens: {
        dispose(): void;
    };
    speaker_embeddings: {
        dispose(): void;
    };
    speaker_features: {
        dispose(): void;
    };
};
export declare class ChatterboxConditioningCache<T extends DisposableConditioning> {
    private current;
    get(key: string): T | null;
    replace(key: string, voiceId: string, outputs: T): void;
    invalidate(voiceId: string): boolean;
    clear(): void;
}
//# sourceMappingURL=conditioningCache.d.ts.map