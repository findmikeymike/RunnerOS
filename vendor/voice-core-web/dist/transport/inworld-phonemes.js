const SYMBOLS = new Set(["aei", "o", "ee", "bmp", "fv", "l", "r", "th", "qw", "chjsh", "cdgknstxyz"]);
const MAX_PHONES = 4096;
const MAX_TIME_MS = 120_000;
function record(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value : undefined;
}
/** Strictly optional metadata: bad alignment can never fail audio playback. */
export function parseInworldPhonemes(value) {
    const alignment = record(record(value)?.wordAlignment);
    const details = alignment?.phoneticDetails;
    const words = alignment?.words;
    if (!Array.isArray(details) || !Array.isArray(words) || !details.length ||
        details.length > MAX_PHONES || words.length > MAX_PHONES)
        return undefined;
    const cues = [];
    const seenWords = new Set();
    let total = 0;
    for (const raw of details) {
        const detail = record(raw);
        const wordIndex = detail?.wordIndex;
        if (!detail || (detail.isPartial !== undefined && detail.isPartial !== false) || !Number.isInteger(wordIndex) ||
            seenWords.has(wordIndex) ||
            wordIndex < 0 || wordIndex >= words.length ||
            typeof words[wordIndex] !== "string" ||
            words[wordIndex].length > 4096 ||
            !Array.isArray(detail.phones) || !detail.phones.length)
            return undefined;
        seenWords.add(wordIndex);
        for (const rawPhone of detail.phones) {
            if (++total > MAX_PHONES)
                return undefined;
            const phone = record(rawPhone);
            const start = phone?.startTimeSeconds;
            const duration = phone?.durationSeconds;
            const symbol = phone?.visemeSymbol;
            const phoneme = phone?.phoneSymbol;
            if (typeof start !== "number" || typeof duration !== "number" ||
                !Number.isFinite(start) || !Number.isFinite(duration) || start < 0 || duration < 0 ||
                (start + duration) * 1000 > MAX_TIME_MS || typeof phoneme !== "string" ||
                !phoneme.length || phoneme.length > 64 || typeof symbol !== "string" ||
                !SYMBOLS.has(symbol))
                return undefined;
            // Inworld labels [silence] as bmp; do not turn pauses into lip presses.
            if (duration > 0)
                cues.push({ startMs: start * 1000, endMs: (start + duration) * 1000,
                    viseme: phoneme === "[silence]" ? "sil" : symbol, phoneme });
        }
    }
    // Incomplete words or deprecated partial entries cannot certify silence in gaps.
    if (seenWords.size !== words.length || !cues.length)
        return undefined;
    cues.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
    for (let index = 1; index < cues.length; index++) {
        if (cues[index].startMs < cues[index - 1].endMs - 0.1)
            return undefined;
    }
    return cues;
}
/** Maps the actual crossfaded PCM to the provider clock without altering audio. */
export class InworldVisemeTimeline {
    cues = [];
    known = [];
    ingest(value, audioRange) {
        const cues = parseInworldPhonemes(value);
        if (!cues)
            return;
        const first = cues[0].startMs;
        const last = cues[cues.length - 1].endMs;
        // Reject unrelated/out-of-order metadata on an audio chunk. A repeated complete
        // alignment is allowed, but cannot certify a later chunk that it never covers.
        if (audioRange && (last <= audioRange.startMs || first >= audioRange.endMs))
            return;
        const deduped = new Map(this.cues.map(cue => [`${cue.startMs}:${cue.endMs}`, cue]));
        for (const cue of cues)
            deduped.set(`${cue.startMs}:${cue.endMs}`, cue);
        if (deduped.size > MAX_PHONES)
            return;
        const mergedCues = [...deduped.values()].sort((a, b) => a.startMs - b.startMs);
        for (let index = 1; index < mergedCues.length; index++) {
            if (mergedCues[index].startMs < mergedCues[index - 1].endMs - 0.1)
                return;
        }
        this.cues = mergedCues;
        // SYNC certifies the associated chunk, including gaps/padding. Standalone
        // metadata only certifies its explicit interval, never unknown past audio.
        this.known.push(audioRange ?? { startMs: first, endMs: last });
        this.known.sort((a, b) => a.startMs - b.startMs);
        const merged = [];
        for (const range of this.known) {
            const previous = merged[merged.length - 1];
            if (previous && range.startMs <= previous.endMs + 0.1)
                previous.endMs = Math.max(previous.endMs, range.endMs);
            else
                merged.push({ ...range });
        }
        this.known = merged;
    }
    project(spans, sampleRate) {
        const result = [];
        for (const span of spans) {
            const startMs = span.sourceStart * 1000 / sampleRate;
            const endMs = (span.sourceStart + span.length) * 1000 / sampleRate;
            if (!this.known.some(range => range.startMs <= startMs + 0.1 && range.endMs >= endMs - 0.1))
                return undefined;
            for (const cue of this.cues) {
                const start = Math.max(cue.startMs, startMs);
                const end = Math.min(cue.endMs, endMs);
                if (end <= start || cue.viseme === "sil")
                    continue;
                result.push({ ...cue, startMs: span.offset * 1000 / sampleRate + start - startMs,
                    endMs: span.offset * 1000 / sampleRate + end - startMs });
            }
        }
        return result.sort((a, b) => a.startMs - b.startMs);
    }
    clear() {
        this.cues = [];
        this.known = [];
    }
    discardBefore(sample, sampleRate) {
        const time = sample * 1000 / sampleRate;
        this.cues = this.cues.filter(cue => cue.endMs > time);
        this.known = this.known.filter(range => range.endMs > time);
    }
}
export function sliceSourceSpans(spans, start, end) {
    return spans.flatMap(span => {
        const left = Math.max(start, span.offset);
        const right = Math.min(end, span.offset + span.length);
        return right > left ? [{ offset: left - start, length: right - left,
                sourceStart: span.sourceStart + left - span.offset }] : [];
    });
}
export function crossfadeSourceSpans(previous, previousLength, sourceStart, currentLength, crossfadeSamples) {
    if (!previousLength)
        return [{ offset: 0, length: currentLength, sourceStart }];
    const overlap = Math.min(previousLength, currentLength, crossfadeSamples);
    // Cosine crossfade reaches equal source gains at overlap / 2.
    const oldDominates = Math.ceil(overlap / 2);
    const result = sliceSourceSpans(previous, previousLength - overlap, previousLength - overlap + oldDominates);
    if (currentLength > oldDominates)
        result.push({ offset: oldDominates,
            length: currentLength - oldDominates, sourceStart: sourceStart + oldDominates });
    return result;
}
//# sourceMappingURL=inworld-phonemes.js.map