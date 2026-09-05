import { createChatterboxLoadKey, DEFAULT_CHATTERBOX_SAMPLE_RATE, MAX_CHATTERBOX_OUTPUT_SECONDS, MAX_CHATTERBOX_REFERENCE_SECONDS, MAX_CHATTERBOX_TEXT_BYTES, } from "./protocol.js";
import { ChatterboxConditioningCache } from "./conditioningCache.js";
import { createChatterboxSessionFetch } from "./sessionFetch.js";
import { validateVoiceCoreSessionToken } from "../../sessionSecurity.js";
let runtime = null;
let activeSynthesis = null;
const queuedCancellationAcks = new Map();
let commandChain = Promise.resolve();
const nativeFetch = globalThis.fetch.bind(globalThis);
function post(message, transfer = []) {
    self.postMessage(message, { transfer });
}
function safeErrorMessage(error) {
    return (error instanceof Error ? error.message : "Unknown Chatterbox worker failure").slice(0, 1_000);
}
function disposeMaybe(value) {
    if (value && typeof value === "object" && "dispose" in value && typeof value.dispose === "function") {
        try {
            value.dispose();
        }
        catch {
            // The worker is quarantined after an unrecoverable error.
        }
    }
}
async function readJson(url, label, sessionToken) {
    const headers = sessionToken ? { "X-VoiceCore-Session": sessionToken } : undefined;
    const response = await nativeFetch(url, { redirect: "error", headers });
    if (!response.ok)
        throw new Error(`${label} fetch failed with HTTP ${response.status}`);
    return response.json();
}
function progressLogger() {
    const buckets = new Map();
    return (entry) => {
        if (entry.status !== "progress" || typeof entry.progress !== "number")
            return;
        const file = (entry.file ?? "model").replace(/[^A-Za-z0-9._/-]/g, "_").slice(0, 160);
        const bucket = Math.min(10, Math.max(0, Math.floor(entry.progress / 10)));
        if (buckets.get(file) === bucket)
            return;
        buckets.set(file, bucket);
        post({ type: "progress", message: `${file}: ${bucket * 10}%` });
    };
}
async function disposeRuntime() {
    const current = runtime;
    runtime = null;
    current?.conditioning.clear();
    await current?.model.dispose();
}
async function ensureLoaded(request) {
    validateLoadRequest(request);
    const key = createChatterboxLoadKey(request);
    if (runtime?.key === key)
        return 0;
    await disposeRuntime();
    const transformers = await import("@huggingface/transformers");
    transformers.env.allowRemoteModels = false;
    transformers.env.allowLocalModels = true;
    transformers.env.localModelPath = request.modelBaseUrl;
    transformers.env.useBrowserCache = false;
    const loadStarted = performance.now();
    const modelRoot = `${request.modelBaseUrl}${request.modelId}/`;
    const [manifest, tokenizerJson, tokenizerConfig, preprocessorConfig] = await Promise.all([
        readJson(`${modelRoot}voice-core-model-manifest.json`, "Model manifest", request.sessionToken),
        readJson(`${modelRoot}tokenizer.json`, "Tokenizer", request.sessionToken),
        readJson(`${modelRoot}tokenizer_config.json`, "Tokenizer config", request.sessionToken),
        readJson(`${modelRoot}preprocessor_config.json`, "Preprocessor config", request.sessionToken),
    ]);
    assertExactKeys(manifest, ["schema_version", "model_id", "revision"]);
    if (manifest.schema_version !== 1
        || manifest.model_id !== request.modelId
        || manifest.revision !== request.modelRevision)
        throw new Error("Chatterbox model manifest does not match the requested revision");
    let model = null;
    try {
        transformers.env.fetch = createChatterboxSessionFetch(nativeFetch, modelRoot, request.sessionToken, self.location.href);
        model = await transformers.ChatterboxModel.from_pretrained(request.modelId, {
            device: "webgpu",
            dtype: request.dtypeMap,
            local_files_only: true,
            progress_callback: progressLogger(),
        });
        runtime = {
            model,
            tokenizer: new transformers.GPT2Tokenizer(tokenizerJson, tokenizerConfig),
            featureExtractor: new transformers.ChatterboxFeatureExtractor(preprocessorConfig),
            key,
            conditioning: new ChatterboxConditioningCache(),
            createStoppingCriteria: () => new transformers.InterruptableStoppingCriteria(),
        };
        return performance.now() - loadStarted;
    }
    catch (error) {
        await model?.dispose();
        throw error;
    }
}
async function synthesize(request) {
    validateSynthesisRequest(request);
    if (!runtime)
        throw new Error("Chatterbox model is not loaded");
    let inputIds = null;
    let attentionMask = null;
    let inputValues = null;
    let waveform = null;
    const synthesisStarted = performance.now();
    const stoppingCriteria = runtime.createStoppingCriteria();
    const active = {
        requestId: request.id,
        cancelRequestId: null,
        stoppingCriteria,
    };
    activeSynthesis = active;
    const queuedCancelRequestId = queuedCancellationAcks.get(request.id);
    if (queuedCancelRequestId !== undefined) {
        queuedCancellationAcks.delete(request.id);
        active.cancelRequestId = queuedCancelRequestId;
        stoppingCriteria.interrupt();
    }
    try {
        if (stoppingCriteria.interrupted)
            return;
        const textInputs = runtime.tokenizer(request.text);
        const conditioningKey = `${request.voiceId}:${request.referenceSha256}`;
        let conditioning = runtime.conditioning.get(conditioningKey);
        if (!conditioning) {
            const audioInputs = await runtime.featureExtractor(new Float32Array(request.referencePcm), { sampling_rate: request.referenceSampleRate });
            const nextInputValues = audioInputs.input_values;
            inputValues = nextInputValues;
            const outputs = await runtime.model.encode_speech(nextInputValues);
            runtime.conditioning.replace(conditioningKey, request.voiceId, outputs);
            conditioning = outputs;
        }
        if (!conditioning)
            throw new Error("Chatterbox voice conditioning is unavailable");
        if (stoppingCriteria.interrupted)
            return;
        inputIds = textInputs.input_ids;
        attentionMask = textInputs.attention_mask;
        waveform = await runtime.model.generate({
            input_ids: inputIds,
            attention_mask: attentionMask,
            audio_features: conditioning.audio_features,
            audio_tokens: conditioning.audio_tokens,
            speaker_embeddings: conditioning.speaker_embeddings,
            speaker_features: conditioning.speaker_features,
            max_new_tokens: request.maxNewTokens,
            do_sample: false,
            repetition_penalty: request.repetitionPenalty,
            stopping_criteria: stoppingCriteria,
        });
        if (stoppingCriteria.interrupted)
            return;
        const samples = new Float32Array(waveform.data);
        if (samples.length === 0
            || samples.length > DEFAULT_CHATTERBOX_SAMPLE_RATE * MAX_CHATTERBOX_OUTPUT_SECONDS
            || samples.some((sample) => !Number.isFinite(sample)))
            throw new Error("Chatterbox returned malformed PCM");
        const audio = samples.buffer;
        post({
            id: request.id,
            type: "synthesize_result",
            audio,
            sampleRate: DEFAULT_CHATTERBOX_SAMPLE_RATE,
            synthesisMs: performance.now() - synthesisStarted,
            audioSeconds: samples.length / DEFAULT_CHATTERBOX_SAMPLE_RATE,
        }, [audio]);
    }
    finally {
        disposeMaybe(waveform);
        disposeMaybe(inputValues);
        disposeMaybe(attentionMask);
        disposeMaybe(inputIds);
        if (activeSynthesis === active)
            activeSynthesis = null;
        queuedCancellationAcks.delete(request.id);
        if (stoppingCriteria.interrupted) {
            post({
                id: active.cancelRequestId ?? request.id,
                type: "synthesis_cancelled",
                synthesisId: request.id,
            });
        }
    }
}
function handleCancellation(request) {
    assertExactKeys(request, ["id", "type", "synthesisId"]);
    if (!validRequestId(request.id) || !validRequestId(request.synthesisId)) {
        throw new Error("Invalid Chatterbox cancellation request");
    }
    if (activeSynthesis?.requestId === request.synthesisId) {
        activeSynthesis.cancelRequestId = request.id;
        activeSynthesis.stoppingCriteria.interrupt();
        return;
    }
    queuedCancellationAcks.set(request.synthesisId, request.id);
}
async function handleRequest(request) {
    const candidateId = request?.id;
    const id = validRequestId(candidateId) ? candidateId : 0;
    try {
        if (!request || typeof request !== "object" || !validRequestId(id)) {
            throw new Error("Invalid Chatterbox worker request");
        }
        if (request.type === "dispose_model") {
            assertExactKeys(request, ["id", "type"]);
            await disposeRuntime();
            post({ id, type: "dispose_complete" });
            return;
        }
        if (request.type === "dispose_voice") {
            assertExactKeys(request, ["id", "type", "voiceId"]);
            if (!/^[A-Za-z0-9._-]{1,128}$/.test(request.voiceId))
                throw new Error("Invalid Chatterbox voice ID");
            runtime?.conditioning.invalidate(request.voiceId);
            post({ id, type: "dispose_voice_complete" });
            return;
        }
        if (request.type === "load") {
            const loadMs = await ensureLoaded(request);
            post({ id, type: "load_ready", loadMs });
            return;
        }
        if (request.type === "synthesize") {
            await synthesize(request);
            return;
        }
        throw new Error("Unsupported Chatterbox worker request");
    }
    catch (error) {
        post({ id, type: "error", message: safeErrorMessage(error) });
    }
}
self.addEventListener("message", (event) => {
    if (event.data?.type === "cancel_synthesis") {
        try {
            handleCancellation(event.data);
        }
        catch (error) {
            const id = validRequestId(event.data?.id) ? event.data.id : 0;
            post({ id, type: "error", message: safeErrorMessage(error) });
        }
        return;
    }
    commandChain = commandChain.then(() => handleRequest(event.data));
});
function validateLoadRequest(request) {
    assertExactKeys(request, ["id", "type", "modelBaseUrl", "modelId", "modelRevision", "dtypeMap", "sessionToken"]);
    if (!validRequestId(request.id))
        throw new Error("Invalid Chatterbox request ID");
    validateLocalUrl(request.modelBaseUrl);
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(request.modelId))
        throw new Error("Invalid Chatterbox model ID");
    if (!/^[a-f0-9]{40}$/i.test(request.modelRevision))
        throw new Error("Invalid Chatterbox revision");
    try {
        request.sessionToken = validateVoiceCoreSessionToken(request.sessionToken ?? undefined) ?? null;
    }
    catch {
        throw new Error("Invalid Chatterbox session token");
    }
    validateDtypeMap(request.dtypeMap);
}
function validateSynthesisRequest(request) {
    assertExactKeys(request, [
        "id", "type", "text", "voiceId", "referenceSha256", "referencePcm", "referenceSampleRate", "maxNewTokens", "repetitionPenalty",
    ]);
    if (!validRequestId(request.id))
        throw new Error("Invalid Chatterbox request ID");
    if (typeof request.text !== "string"
        || !request.text.trim()
        || new TextEncoder().encode(request.text).byteLength > MAX_CHATTERBOX_TEXT_BYTES)
        throw new Error("Invalid Chatterbox text");
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(request.voiceId))
        throw new Error("Invalid Chatterbox voice ID");
    if (!/^[a-f0-9]{64}$/i.test(request.referenceSha256))
        throw new Error("Invalid Chatterbox reference identity");
    if (!(request.referencePcm instanceof ArrayBuffer)
        || request.referencePcm.byteLength === 0
        || request.referencePcm.byteLength > DEFAULT_CHATTERBOX_SAMPLE_RATE * 4 * MAX_CHATTERBOX_REFERENCE_SECONDS
        || request.referencePcm.byteLength % 4 !== 0)
        throw new Error("Invalid Chatterbox reference PCM");
    if (request.referenceSampleRate !== DEFAULT_CHATTERBOX_SAMPLE_RATE) {
        throw new Error("Unsupported Chatterbox reference sample rate");
    }
    if (!Number.isSafeInteger(request.maxNewTokens) || request.maxNewTokens < 1 || request.maxNewTokens > 1_024) {
        throw new Error("Invalid Chatterbox token limit");
    }
    if (!Number.isFinite(request.repetitionPenalty) || request.repetitionPenalty < 1 || request.repetitionPenalty > 3) {
        throw new Error("Invalid Chatterbox repetition penalty");
    }
}
function validateDtypeMap(value) {
    assertExactKeys(value, ["embed_tokens", "speech_encoder", "language_model", "conditional_decoder"]);
    const allowed = new Set(["fp16", "q4f16"]);
    for (const dtype of Object.values(value))
        if (!allowed.has(dtype))
            throw new Error("Invalid Chatterbox dtype map");
}
function validateLocalUrl(value) {
    if (typeof value !== "string" || value.length > 2_048)
        throw new Error("Invalid Chatterbox model URL");
    const url = new URL(value, self.location.href);
    const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
    if (url.origin !== self.location.origin && !(url.protocol === "http:" && loopback)) {
        throw new Error("Chatterbox model URL must be same-origin or loopback");
    }
    if (url.username || url.password || url.search || url.hash)
        throw new Error("Unsafe Chatterbox model URL");
}
function assertExactKeys(value, expected) {
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
        throw new Error("Chatterbox protocol contains unknown or missing fields");
    }
}
function validRequestId(value) {
    return Number.isSafeInteger(value) && Number(value) > 0;
}
//# sourceMappingURL=worker.js.map