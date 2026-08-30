const DEFAULT_SAMPLE_RATE_HZ = 24_000;
const CHUNK_MS = 120;
export function createMockTransportBundle() {
    const stt = new MockSttTransport();
    return {
        stt,
        llm: new MockLlmTransport(),
        tts: new MockTtsTransport(),
    };
}
export class MockSttTransport {
    handlers = new Set();
    errorHandlers = new Set();
    started = false;
    async start() {
        this.started = true;
    }
    async stop() {
        this.started = false;
    }
    async sendAudio(_pcm16, _sampleRate, _channels) {
        return;
    }
    onTranscript(handler) {
        this.handlers.add(handler);
        return () => {
            this.handlers.delete(handler);
        };
    }
    onError(handler) {
        this.errorHandlers.add(handler);
        return () => {
            this.errorHandlers.delete(handler);
        };
    }
    emitPartial(text) {
        this.emit({ type: "partial", text });
    }
    emitFinal(text) {
        this.emit({ type: "final", text });
    }
    async emitScriptedTurn(text, delayMs = 140) {
        const words = text.match(/\S+\s*/g) ?? [text];
        let partial = "";
        for (const word of words) {
            partial += word;
            this.emit({ type: "partial", text: partial.trimEnd() });
            await delay(delayMs, new AbortController().signal);
        }
        this.emit({ type: "final", text: text.trim() });
    }
    emit(event) {
        if (!this.started) {
            return;
        }
        for (const handler of this.handlers) {
            handler(event);
        }
    }
}
class MockLlmTransport {
    async generateReply(request) {
        const reply = buildMockReply(request.userText, request.contextJson);
        return streamReply(reply, request.signal);
    }
}
class MockTtsTransport {
    async synthesize(request) {
        return synthesizeMockTone(request.text, request.signal);
    }
}
async function* streamReply(text, signal) {
    const parts = text.match(/\S+\s*/g) ?? [text];
    for (let index = 0; index < parts.length; index += 1) {
        throwIfAborted(signal);
        await delay(55 + Math.min(parts[index].length * 6, 90), signal);
        yield {
            text: parts[index],
            done: index === parts.length - 1,
        };
    }
}
async function* synthesizeMockTone(text, signal) {
    const sanitized = text.trim();
    if (!sanitized) {
        return;
    }
    const totalDurationMs = Math.max(420, Math.min(4_800, sanitized.length * 48));
    const totalSamples = Math.round(DEFAULT_SAMPLE_RATE_HZ * totalDurationMs / 1_000);
    const chunkSamples = Math.round(DEFAULT_SAMPLE_RATE_HZ * CHUNK_MS / 1_000);
    const baseFrequencyHz = chooseBaseFrequency(sanitized);
    let sampleOffset = 0;
    while (sampleOffset < totalSamples) {
        throwIfAborted(signal);
        const currentChunkSamples = Math.min(chunkSamples, totalSamples - sampleOffset);
        const frames = new Float32Array(currentChunkSamples);
        for (let index = 0; index < currentChunkSamples; index += 1) {
            const absoluteIndex = sampleOffset + index;
            const time = absoluteIndex / DEFAULT_SAMPLE_RATE_HZ;
            const envelope = Math.min(1, absoluteIndex / 600) *
                Math.min(1, (totalSamples - absoluteIndex) / 800);
            const wobble = Math.sin(2 * Math.PI * 2.2 * time) * 18;
            const frequencyHz = baseFrequencyHz + wobble;
            frames[index] =
                Math.sin(2 * Math.PI * frequencyHz * time) * 0.18 * envelope;
        }
        await delay(CHUNK_MS, signal);
        yield {
            frames,
            sampleRate: DEFAULT_SAMPLE_RATE_HZ,
            channels: 1,
        };
        sampleOffset += currentChunkSamples;
    }
}
function buildMockReply(userText, contextJson) {
    let turns = 0;
    try {
        const parsed = JSON.parse(contextJson);
        turns = parsed.length;
    }
    catch {
        turns = 0;
    }
    const normalized = userText.trim() || "that";
    return [
        `Mock web transport heard: "${normalized}".`,
        `This path is exercising the worker, wasm runtime, streaming token flow, and queued audio output.`,
        `Context currently contains ${turns} messages.`,
    ].join(" ");
}
function chooseBaseFrequency(text) {
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
        hash = (hash * 31 + text.charCodeAt(index)) % 997;
    }
    return 210 + (hash % 120);
}
function throwIfAborted(signal) {
    if (signal.aborted) {
        throw new DOMException("The operation was aborted", "AbortError");
    }
}
function delay(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(new DOMException("The operation was aborted", "AbortError"));
            return;
        }
        const timeoutId = window.setTimeout(() => {
            cleanup();
            resolve();
        }, ms);
        const onAbort = () => {
            cleanup();
            reject(new DOMException("The operation was aborted", "AbortError"));
        };
        const cleanup = () => {
            window.clearTimeout(timeoutId);
            signal.removeEventListener("abort", onAbort);
        };
        signal.addEventListener("abort", onAbort, { once: true });
    });
}
//# sourceMappingURL=mock.js.map