export const DEFAULT_CHATTERBOX_DTYPE_MAP = {
    embed_tokens: "fp16",
    speech_encoder: "q4f16",
    language_model: "q4f16",
    conditional_decoder: "q4f16",
};
export const DEFAULT_CHATTERBOX_SAMPLE_RATE = 24_000;
export const DEFAULT_CHATTERBOX_MODEL_ID = "chatterbox-turbo-webgpu";
export const MAX_CHATTERBOX_TEXT_BYTES = 16_384;
export const MAX_CHATTERBOX_REFERENCE_SECONDS = 30;
export const MAX_CHATTERBOX_OUTPUT_SECONDS = 120;
export function createChatterboxLoadKey(request) {
    return JSON.stringify({
        modelBaseUrl: request.modelBaseUrl,
        modelId: request.modelId,
        modelRevision: request.modelRevision,
        dtypeMap: request.dtypeMap,
        sessionToken: request.sessionToken,
    });
}
//# sourceMappingURL=protocol.js.map