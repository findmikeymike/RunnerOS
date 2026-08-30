export class ChatterboxConditioningCache {
    current = null;
    get(key) {
        return this.current?.key === key ? this.current.outputs : null;
    }
    replace(key, voiceId, outputs) {
        const previous = this.current;
        this.current = { key, voiceId, outputs };
        disposeOutputs(previous?.outputs ?? null);
    }
    invalidate(voiceId) {
        if (this.current?.voiceId !== voiceId)
            return false;
        const previous = this.current;
        this.current = null;
        disposeOutputs(previous.outputs);
        return true;
    }
    clear() {
        const previous = this.current;
        this.current = null;
        disposeOutputs(previous?.outputs ?? null);
    }
}
function disposeOutputs(value) {
    if (!value)
        return;
    for (const tensor of [value.audio_features, value.audio_tokens, value.speaker_embeddings, value.speaker_features]) {
        try {
            tensor.dispose();
        }
        catch {
            // Continue disposing the remaining owned tensors.
        }
    }
}
//# sourceMappingURL=conditioningCache.js.map