export async function resumeTranscriptionOnlyIfNeeded(hasLlmTransport, startListening) {
    if (hasLlmTransport)
        return false;
    await startListening();
    return true;
}
//# sourceMappingURL=transcriptionOnly.js.map