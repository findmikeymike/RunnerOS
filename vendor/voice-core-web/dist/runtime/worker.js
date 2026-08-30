export class RuntimeWorkerClient {
    static REQUEST_TIMEOUT_MS = 10_000;
    worker = null;
    ready = false;
    messageHandler = null;
    nextRequestId = 1;
    pendingRequests = new Map();
    async init(config) {
        if (this.worker && this.ready) {
            return;
        }
        if (this.worker) {
            this.destroy();
        }
        this.worker = new Worker(new URL("./runtime.worker.js", import.meta.url), {
            type: "module",
        });
        this.worker.addEventListener("message", this.handleRuntimeMessage);
        this.worker.addEventListener("error", this.handleWorkerError);
        this.worker.addEventListener("messageerror", this.handleWorkerMessageError);
        await this.sendCommand("init", { config });
        this.ready = true;
    }
    async start() {
        this.ensureReady();
        await this.sendCommand("start");
    }
    async stop() {
        if (!this.worker) {
            return;
        }
        await this.sendCommand("stop");
    }
    async startListening() {
        this.ensureReady();
        await this.sendCommand("startListening");
    }
    async pushPartialTranscript(text) {
        this.ensureReady();
        await this.sendCommand("pushPartialTranscript", { text });
    }
    async completeUserTranscript(text) {
        this.ensureReady();
        await this.sendCommand("completeUserTranscript", { text });
    }
    async pushAssistantText(text, isFinal) {
        this.ensureReady();
        await this.sendCommand("pushAssistantText", { text, isFinal });
    }
    async setConfig(config) {
        this.ensureReady();
        await this.sendCommand("setConfig", { config });
    }
    async notifyOutputPlaybackFinished() {
        this.ensureReady();
        await this.sendCommand("notifyOutputPlaybackFinished");
    }
    async triggerBargeIn() {
        this.ensureReady();
        await this.sendCommand("triggerBargeIn");
    }
    async flushOutputAudio(timestampMs = Date.now()) {
        this.ensureReady();
        await this.sendCommand("flushOutputAudio", { timestampMs });
    }
    async feedInputAudio(samples, sampleRateHz, channels) {
        this.ensureReady();
        await this.sendCommand("feedInputAudio", {
            samples,
            sampleRateHz,
            channels,
        });
    }
    async pushTtsAudio(samples, sampleRateHz, channels, timestampMs) {
        this.ensureReady();
        const result = await this.sendCommand("pushTtsAudio", {
            samples,
            sampleRateHz,
            channels,
            timestampMs,
        });
        return result === true;
    }
    async popAudioChunk() {
        this.ensureReady();
        const result = await this.sendCommand("popAudio");
        return typeof result === "string" ? result : null;
    }
    async getContextJson() {
        this.ensureReady();
        const result = await this.sendCommand("getContext");
        return typeof result === "string" ? result : "[]";
    }
    async getInputStatsJson() {
        this.ensureReady();
        const result = await this.sendCommand("getInputStats");
        return typeof result === "string" ? result : "{}";
    }
    destroy() {
        this.quarantineWorker((requestId) => new Error(`worker destroyed before request ${requestId} completed`));
    }
    setMessageHandler(handler) {
        this.messageHandler = handler;
    }
    ensureReady() {
        if (!this.worker || !this.ready) {
            throw new Error("worker runtime is not ready");
        }
    }
    async sendCommand(type, extra = {}) {
        if (!this.worker) {
            throw new Error("worker is not available");
        }
        const requestId = this.nextRequestId++;
        const promise = new Promise((resolve, reject) => {
            const timeoutId = window.setTimeout(() => {
                if (!this.pendingRequests.has(requestId))
                    return;
                const error = new Error(`worker request ${requestId} timed out`);
                this.quarantineWorker(() => error);
                this.messageHandler?.({ type: "error", message: error.message });
            }, RuntimeWorkerClient.REQUEST_TIMEOUT_MS);
            this.pendingRequests.set(requestId, {
                resolve: (value) => {
                    window.clearTimeout(timeoutId);
                    resolve(value);
                },
                reject: (error) => {
                    window.clearTimeout(timeoutId);
                    reject(error);
                },
            });
        });
        try {
            this.worker.postMessage({ type, requestId, ...extra });
        }
        catch (error) {
            const pending = this.pendingRequests.get(requestId);
            this.pendingRequests.delete(requestId);
            pending?.reject(error instanceof Error ? error : new Error(String(error)));
        }
        return await promise;
    }
    handleRuntimeMessage = (event) => {
        if (event.data.type === "ack") {
            const pending = this.pendingRequests.get(event.data.requestId);
            if (pending) {
                this.pendingRequests.delete(event.data.requestId);
                pending.resolve();
            }
            return;
        }
        if (event.data.type === "audio") {
            const pending = this.pendingRequests.get(event.data.requestId);
            if (pending) {
                this.pendingRequests.delete(event.data.requestId);
                pending.resolve(event.data.chunk);
            }
            return;
        }
        if (event.data.type === "ttsAudio") {
            const pending = this.pendingRequests.get(event.data.requestId);
            if (pending) {
                this.pendingRequests.delete(event.data.requestId);
                pending.resolve(event.data.accepted);
            }
            return;
        }
        if (event.data.type === "context") {
            const pending = this.pendingRequests.get(event.data.requestId);
            if (pending) {
                this.pendingRequests.delete(event.data.requestId);
                pending.resolve(event.data.context);
            }
            return;
        }
        if (event.data.type === "inputStats") {
            const pending = this.pendingRequests.get(event.data.requestId);
            if (pending) {
                this.pendingRequests.delete(event.data.requestId);
                pending.resolve(event.data.stats);
            }
            return;
        }
        if (event.data.type === "error" && typeof event.data.requestId === "number") {
            const pending = this.pendingRequests.get(event.data.requestId);
            if (pending) {
                this.pendingRequests.delete(event.data.requestId);
                pending.reject(new Error(event.data.message));
                return;
            }
        }
        this.messageHandler?.(event.data);
    };
    handleWorkerError = (event) => {
        const error = event.error instanceof Error
            ? event.error
            : new Error(event.message || String(event.error ?? "worker failed"));
        this.quarantineWorker(() => error);
        this.messageHandler?.({ type: "error", message: error.message });
    };
    handleWorkerMessageError = () => {
        const error = new Error("worker message could not be decoded");
        this.quarantineWorker(() => error);
        this.messageHandler?.({ type: "error", message: error.message });
    };
    quarantineWorker(errorForRequest) {
        const worker = this.worker;
        this.worker = null;
        this.ready = false;
        if (worker) {
            worker.removeEventListener("message", this.handleRuntimeMessage);
            worker.removeEventListener("error", this.handleWorkerError);
            worker.removeEventListener("messageerror", this.handleWorkerMessageError);
            worker.terminate();
        }
        for (const [requestId, pending] of this.pendingRequests) {
            pending.reject(errorForRequest(requestId));
        }
        this.pendingRequests.clear();
    }
}
//# sourceMappingURL=worker.js.map