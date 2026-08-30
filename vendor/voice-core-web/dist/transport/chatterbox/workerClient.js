import { createChatterboxLoadKey, MAX_CHATTERBOX_OUTPUT_SECONDS, } from "./protocol.js";
export class ChatterboxWorkerClient {
    createWorkerImpl;
    onDiagnostic;
    requestTimeoutMs;
    worker = null;
    nextId = 1;
    pending = new Map();
    loadedKey = null;
    activeSynthesisId = null;
    constructor(options = {}) {
        this.createWorkerImpl = options.createWorker ?? (() => new Worker(new URL("./worker.js", import.meta.url), { type: "module" }));
        this.onDiagnostic = options.onDiagnostic;
        this.requestTimeoutMs = validateTimeout(options.requestTimeoutMs ?? 180_000);
    }
    async load(request) {
        const key = createChatterboxLoadKey(request);
        if (this.loadedKey === key)
            return 0;
        const response = await this.send({
            type: "load",
            modelBaseUrl: request.modelBaseUrl,
            modelId: request.modelId,
            modelRevision: request.modelRevision,
            dtypeMap: request.dtypeMap,
            sessionToken: request.sessionToken,
        });
        if (response.type !== "load_ready")
            throw new Error("Invalid Chatterbox load response");
        this.loadedKey = key;
        return response.loadMs;
    }
    async synthesize(request) {
        if (request.signal.aborted)
            throw createAbortError();
        if (this.activeSynthesisId !== null)
            throw new Error("Chatterbox synthesis is already in progress");
        this.activeSynthesisId = -1;
        const abort = () => this.disposeWorker(createAbortError());
        request.signal.addEventListener("abort", abort, { once: true });
        try {
            await this.load(request);
            if (request.signal.aborted)
                throw createAbortError();
            const id = this.allocateId();
            this.activeSynthesisId = id;
            const referencePcm = cloneArrayBuffer(request.referencePcm.buffer, request.referencePcm.byteOffset, request.referencePcm.byteLength);
            const response = await this.sendWithId(id, {
                id,
                type: "synthesize",
                text: request.text,
                voiceId: request.voiceId,
                referenceSha256: request.referenceSha256,
                referencePcm,
                referenceSampleRate: request.referenceSampleRate,
                maxNewTokens: request.maxNewTokens,
                repetitionPenalty: request.repetitionPenalty,
            }, [referencePcm]);
            if (response.type !== "synthesize_result")
                throw new Error("Invalid Chatterbox synthesis response");
            if (request.signal.aborted)
                throw createAbortError();
            return response;
        }
        catch (error) {
            if (request.signal.aborted)
                throw createAbortError();
            throw error;
        }
        finally {
            this.activeSynthesisId = null;
            request.signal.removeEventListener("abort", abort);
        }
    }
    async invalidateVoice(voiceId) {
        if (!/^[A-Za-z0-9._-]{1,128}$/.test(voiceId))
            throw new Error("Invalid Chatterbox voice ID");
        if (!this.worker)
            return;
        if (this.activeSynthesisId !== null) {
            this.disposeWorker(new Error("Chatterbox voice was invalidated during synthesis"));
            return;
        }
        const id = this.allocateId();
        const response = await this.sendWithId(id, { id, type: "dispose_voice", voiceId });
        if (response.type !== "dispose_voice_complete")
            throw new Error("Invalid Chatterbox voice disposal response");
    }
    async dispose() {
        this.loadedKey = null;
        if (!this.worker)
            return;
        if (this.activeSynthesisId !== null) {
            this.disposeWorker();
            return;
        }
        try {
            const id = this.allocateId();
            const response = await this.sendWithId(id, { id, type: "dispose_model" });
            if (response.type !== "dispose_complete")
                throw new Error("Invalid Chatterbox dispose response");
        }
        finally {
            this.disposeWorker();
        }
    }
    send(request) {
        const id = this.allocateId();
        return this.sendWithId(id, { ...request, id });
    }
    sendWithId(id, request, transfer = []) {
        const worker = this.ensureWorker();
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                const error = new Error("Chatterbox worker request timed out");
                reject(error);
                this.disposeWorker(error);
            }, this.requestTimeoutMs);
            this.pending.set(id, { resolve, reject, timeout });
            try {
                worker.postMessage(request, transfer);
            }
            catch (error) {
                clearTimeout(timeout);
                this.pending.delete(id);
                reject(error instanceof Error ? error : new Error("Chatterbox worker post failed"));
            }
        });
    }
    ensureWorker() {
        if (this.worker)
            return this.worker;
        const worker = this.createWorkerImpl();
        worker.addEventListener("message", (event) => {
            const message = parseResponse(event.data);
            if (!message) {
                this.disposeWorker(new Error("Chatterbox worker protocol violation"));
                return;
            }
            if (message.type === "progress") {
                this.onDiagnostic?.(message.message);
                return;
            }
            const pending = this.pending.get(message.id);
            if (!pending)
                return;
            clearTimeout(pending.timeout);
            this.pending.delete(message.id);
            if (message.type === "error") {
                pending.reject(new Error(message.message));
                this.disposeWorker(new Error("Chatterbox worker quarantined after failure"));
            }
            else {
                pending.resolve(message);
            }
        });
        worker.addEventListener("error", (event) => {
            this.disposeWorker(new Error((event.message || "Chatterbox worker failed").slice(0, 1_000)));
        });
        worker.addEventListener("messageerror", () => {
            this.disposeWorker(new Error("Chatterbox worker message could not be decoded"));
        });
        this.worker = worker;
        return worker;
    }
    disposeWorker(error) {
        const worker = this.worker;
        this.worker = null;
        this.loadedKey = null;
        if (worker)
            worker.terminate();
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timeout);
            pending.reject(error ?? new Error("Chatterbox worker disposed"));
        }
        this.pending.clear();
    }
    allocateId() {
        for (let attempts = 0; attempts < Number.MAX_SAFE_INTEGER; attempts += 1) {
            const id = this.nextId;
            this.nextId = id >= Number.MAX_SAFE_INTEGER ? 1 : id + 1;
            if (!this.pending.has(id))
                return id;
        }
        throw new Error("Chatterbox request ID space exhausted");
    }
}
function parseResponse(value) {
    if (!value || typeof value !== "object")
        return null;
    const message = value;
    if (message.type === "progress") {
        return exactKeys(message, ["type", "message"])
            && typeof message.message === "string"
            && message.message.length <= 200
            ? message : null;
    }
    if (!Number.isSafeInteger(message.id) || Number(message.id) <= 0 || typeof message.type !== "string")
        return null;
    if (message.type === "load_ready") {
        return exactKeys(message, ["id", "type", "loadMs"])
            && finiteNonNegative(message.loadMs) ? message : null;
    }
    if (message.type === "dispose_complete" || message.type === "dispose_voice_complete") {
        return exactKeys(message, ["id", "type"]) ? message : null;
    }
    if (message.type === "error") {
        return exactKeys(message, ["id", "type", "message"])
            && typeof message.message === "string"
            && message.message.length <= 1_000
            ? message : null;
    }
    if (message.type === "synthesize_result") {
        const sampleRate = message.sampleRate;
        const audio = message.audio;
        return exactKeys(message, ["id", "type", "audio", "sampleRate", "synthesisMs", "audioSeconds"])
            && audio instanceof ArrayBuffer
            && audio.byteLength > 0
            && audio.byteLength % Float32Array.BYTES_PER_ELEMENT === 0
            && audio.byteLength <= 24_000 * 4 * MAX_CHATTERBOX_OUTPUT_SECONDS
            && sampleRate === 24_000
            && finiteNonNegative(message.synthesisMs)
            && typeof message.audioSeconds === "number"
            && message.audioSeconds > 0
            && message.audioSeconds <= MAX_CHATTERBOX_OUTPUT_SECONDS
            && Math.abs(message.audioSeconds - audio.byteLength / Float32Array.BYTES_PER_ELEMENT / sampleRate) < 1e-9
            && new Float32Array(audio).every(Number.isFinite)
            ? message : null;
    }
    return null;
}
function exactKeys(value, expected) {
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
function finiteNonNegative(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function createAbortError() {
    if (typeof DOMException === "function")
        return new DOMException("The operation was aborted.", "AbortError");
    const error = new Error("The operation was aborted.");
    error.name = "AbortError";
    return error;
}
function cloneArrayBuffer(buffer, byteOffset, byteLength) {
    return new Uint8Array(buffer, byteOffset, byteLength).slice().buffer;
}
function validateTimeout(value) {
    if (!Number.isSafeInteger(value) || value < 1_000 || value > 600_000) {
        throw new Error("Chatterbox request timeout must be 1-600 seconds");
    }
    return value;
}
//# sourceMappingURL=workerClient.js.map