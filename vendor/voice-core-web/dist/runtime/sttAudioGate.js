export function shouldSendSttAudio(runtimeRunning, transportRunning, transportPaused) {
    return runtimeRunning && transportRunning && !transportPaused;
}
//# sourceMappingURL=sttAudioGate.js.map