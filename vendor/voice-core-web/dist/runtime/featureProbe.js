export function probeBrowserCapabilities() {
    const AudioContextCtor = window.AudioContext ||
        window
            .webkitAudioContext;
    const audioContext = Boolean(AudioContextCtor);
    const audioWorklet = audioContext
        ? "audioWorklet" in AudioContextCtor.prototype
        : false;
    return {
        getUserMedia: Boolean(navigator.mediaDevices?.getUserMedia),
        audioContext,
        audioWorklet,
        worker: typeof Worker !== "undefined",
        sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
        crossOriginIsolated: window.crossOriginIsolated,
    };
}
export function assertBrowserSupport(config, capabilities) {
    if (config.sttProvider === "moonshine") {
        throw new Error("Moonshine STT is unavailable in the Web build");
    }
    if (!capabilities.getUserMedia) {
        throw new Error("getUserMedia is not available in this browser");
    }
    if (!capabilities.audioContext) {
        throw new Error("AudioContext is not available in this browser");
    }
    if (!capabilities.audioWorklet) {
        throw new Error("AudioWorklet is not available in this browser");
    }
    if (!capabilities.worker) {
        throw new Error("Web Workers are not available in this browser");
    }
    if ((config.requireCrossOriginIsolation || config.preferSharedArrayBuffer) &&
        !capabilities.crossOriginIsolated) {
        throw new Error("crossOriginIsolated is required for the requested shared-memory mode");
    }
    if (config.preferSharedArrayBuffer && !capabilities.sharedArrayBuffer) {
        throw new Error("SharedArrayBuffer is not available in this browser");
    }
}
//# sourceMappingURL=featureProbe.js.map