const DEFAULT_PHRASES = Object.freeze({
    checking: Object.freeze([
        "Okay. Let me check that.",
        "All right. I'll look into that.",
    ]),
    acting: Object.freeze([
        "Okay. I'll take care of that.",
        "Got it. Let me handle that.",
    ]),
    working: Object.freeze([
        "Okay. Give me a moment while I work on that.",
        "All right. I'm working on that now.",
    ]),
    approval: Object.freeze([
        "I need your approval in the app before I continue.",
    ]),
    credential: Object.freeze([
        "I need the requested account information in the app before I continue.",
    ]),
    long_wait: Object.freeze([
        "I'm still working on it.",
        "This is taking a little longer, but I'm still on it.",
    ]),
});
/**
 * Converts trusted host lifecycle events into sparse, deterministic activity
 * speech. It never accepts tool input or model-authored status text.
 */
export class AgentActivitySpeechController {
    emitToken;
    acknowledgementDelayMs;
    longWaitDelayMs;
    phrases;
    setTimer;
    clearTimer;
    acknowledgementTimer = null;
    longWaitTimer = null;
    generation = 0;
    phraseIndex = 0;
    open = true;
    answerStarted = false;
    acknowledgementSpoken = false;
    longWaitSpoken = false;
    attentionSpoken = false;
    constructor(options) {
        this.emitToken = options.emit;
        this.acknowledgementDelayMs = boundedDelay(options.acknowledgementDelayMs ?? 900, "acknowledgementDelayMs");
        this.longWaitDelayMs = boundedDelay(options.longWaitDelayMs ?? 8_000, "longWaitDelayMs");
        if (this.longWaitDelayMs <= this.acknowledgementDelayMs) {
            throw new RangeError("longWaitDelayMs must be greater than acknowledgementDelayMs");
        }
        this.phrases = mergePhrases(options.phrases);
        this.setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
        this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
    }
    toolStarted(kind = "working") {
        if (!this.open || this.answerStarted || this.attentionSpoken)
            return;
        const generation = this.generation;
        if (!this.acknowledgementSpoken && this.acknowledgementTimer === null) {
            this.acknowledgementTimer = this.setTimer(() => {
                this.acknowledgementTimer = null;
                if (!this.isCurrent(generation) || this.acknowledgementSpoken)
                    return;
                this.acknowledgementSpoken = true;
                this.speak(kind);
            }, this.acknowledgementDelayMs);
        }
        if (!this.longWaitSpoken && this.longWaitTimer === null) {
            this.longWaitTimer = this.setTimer(() => {
                this.longWaitTimer = null;
                if (!this.isCurrent(generation) || this.longWaitSpoken)
                    return;
                this.longWaitSpoken = true;
                this.speak("long_wait");
            }, this.longWaitDelayMs);
        }
    }
    attentionRequired(kind) {
        if (!this.open || this.answerStarted || this.attentionSpoken)
            return;
        this.cancelTimers();
        this.attentionSpoken = true;
        this.speak(kind);
    }
    answerBeginning() {
        if (!this.open)
            return;
        this.answerStarted = true;
        this.cancelTimers();
    }
    finish() {
        if (!this.open)
            return;
        this.open = false;
        this.generation += 1;
        this.cancelTimers();
    }
    isCurrent(generation) {
        return this.open && !this.answerStarted && !this.attentionSpoken && generation === this.generation;
    }
    speak(kind) {
        const options = this.phrases[kind];
        const text = options[this.phraseIndex++ % options.length];
        this.emitToken({ kind: "activity", text });
    }
    cancelTimers() {
        if (this.acknowledgementTimer !== null)
            this.clearTimer(this.acknowledgementTimer);
        if (this.longWaitTimer !== null)
            this.clearTimer(this.longWaitTimer);
        this.acknowledgementTimer = null;
        this.longWaitTimer = null;
    }
}
function boundedDelay(value, name) {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0 || value > 120_000) {
        throw new RangeError(`${name} must be an integer from 0 to 120000 milliseconds`);
    }
    return value;
}
function mergePhrases(overrides) {
    const merged = { ...DEFAULT_PHRASES };
    if (!overrides)
        return merged;
    for (const kind of Object.keys(overrides)) {
        const candidates = overrides[kind];
        if (!candidates?.length)
            throw new RangeError(`Activity phrase list ${kind} cannot be empty`);
        const normalized = candidates.map((phrase) => validatePhrase(phrase));
        merged[kind] = Object.freeze(normalized);
    }
    return merged;
}
function validatePhrase(phrase) {
    const normalized = phrase.trim().replace(/\s+/g, " ");
    if (!normalized || [...normalized].length > 160) {
        throw new RangeError("Activity phrases must contain 1 to 160 characters");
    }
    return normalized;
}
//# sourceMappingURL=agentActivitySpeech.js.map