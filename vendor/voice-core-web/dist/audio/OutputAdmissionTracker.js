export class OutputAdmissionTracker {
    timeoutMs;
    nextRequestId = 1;
    pending = new Map();
    constructor(timeoutMs) {
        this.timeoutMs = timeoutMs;
    }
    create() {
        const requestId = this.nextRequestId++;
        const promise = new Promise((resolve, reject) => {
            const timeoutId = window.setTimeout(() => {
                if (!this.pending.delete(requestId))
                    return;
                reject(new Error("VoiceCore output worklet admission timed out"));
            }, this.timeoutMs);
            this.pending.set(requestId, { timeoutId, resolve, reject });
        });
        return { requestId, promise };
    }
    settle(requestId, accepted) {
        const pending = this.pending.get(requestId);
        if (!pending)
            return false;
        this.pending.delete(requestId);
        window.clearTimeout(pending.timeoutId);
        if (accepted)
            pending.resolve();
        else
            pending.reject(new Error("VoiceCore output worklet queue is full"));
        return true;
    }
    cancelAll(message) {
        for (const pending of this.pending.values()) {
            window.clearTimeout(pending.timeoutId);
            pending.reject(new Error(message));
        }
        this.pending.clear();
    }
}
//# sourceMappingURL=OutputAdmissionTracker.js.map