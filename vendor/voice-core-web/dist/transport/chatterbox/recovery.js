export function createRecoveringChatterboxTransport(options) {
    return new RecoveringChatterboxTransport(options);
}
class RecoveringChatterboxTransport {
    options;
    primary;
    fallbackActive = false;
    restartUsed = false;
    disposed = false;
    synthesisChain = Promise.resolve();
    disposePromise = null;
    constructor(options) {
        this.options = options;
        this.primary = options.createPrimary();
    }
    usingFallback() {
        return this.fallbackActive;
    }
    async synthesize(request) {
        const result = this.synthesisChain.then(() => this.synthesizeExclusive(request));
        this.synthesisChain = result.then(() => undefined, () => undefined);
        return result;
    }
    async synthesizeExclusive(request) {
        if (this.disposed)
            throw new Error("Chatterbox recovery transport is disposed");
        if (this.fallbackActive && this.options.fallback)
            return this.options.fallback.synthesize(request);
        try {
            return await this.primary.synthesize(request);
        }
        catch (firstError) {
            if (isAbort(firstError, request.signal))
                throw firstError;
            if (!this.restartUsed) {
                this.restartUsed = true;
                this.options.onDiagnostic?.("Chatterbox worker failed; restarting once");
                try {
                    await this.primary.dispose?.();
                }
                catch (cleanupError) {
                    throw new AggregateError([firstError, cleanupError], "Chatterbox worker cleanup failed before restart");
                }
                if (this.disposed)
                    throw new Error("Chatterbox recovery transport was stopped during recovery");
                this.primary = this.options.createPrimary();
                try {
                    return await this.primary.synthesize(request);
                }
                catch (retryError) {
                    if (isAbort(retryError, request.signal))
                        throw retryError;
                    return this.activateFallback(request, retryError);
                }
            }
            return this.activateFallback(request, firstError);
        }
    }
    async invalidateVoice(voiceId) {
        await this.primary.invalidateVoice(voiceId);
    }
    async stop() {
        await this.dispose();
    }
    async dispose() {
        if (this.disposePromise)
            return this.disposePromise;
        this.disposed = true;
        this.disposePromise = this.cleanup().catch((error) => {
            this.disposePromise = null;
            throw error;
        });
        return this.disposePromise;
    }
    async cleanup() {
        const cleanup = await Promise.allSettled([
            this.primary.dispose?.(),
            this.options.fallback?.dispose?.() ?? this.options.fallback?.stop?.(),
        ]);
        const failures = cleanup
            .filter((result) => result.status === "rejected")
            .map((result) => result.reason);
        if (failures.length)
            throw new AggregateError(failures, "Chatterbox recovery transport cleanup failed");
    }
    async activateFallback(request, error) {
        const reason = safeReason(error);
        try {
            await this.primary.dispose?.();
        }
        catch (cleanupError) {
            throw new AggregateError([error, cleanupError], "Chatterbox recovery cleanup failed");
        }
        if (request.signal.aborted || this.disposed)
            throw createAbortError();
        if (!this.options.fallback) {
            throw new Error(`Chatterbox recovery failed and Pocket fallback is unavailable (${reason})`);
        }
        const stream = await this.options.fallback.synthesize(request);
        this.fallbackActive = true;
        this.options.onFallback?.(reason);
        this.options.onDiagnostic?.(`Chatterbox recovery failed; using Pocket TTS (${reason})`);
        return stream;
    }
}
function isAbort(error, signal) {
    return signal.aborted || (error instanceof Error && error.name === "AbortError");
}
function safeReason(error) {
    if (!(error instanceof Error))
        return "local worker failure";
    return /device|gpu/i.test(error.message) ? "WebGPU device failure" : "local worker failure";
}
function createAbortError() {
    return Object.assign(new Error("Chatterbox synthesis aborted"), { name: "AbortError" });
}
//# sourceMappingURL=recovery.js.map