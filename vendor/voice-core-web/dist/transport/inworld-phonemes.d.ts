import type { TtsVisemeCue } from "./types";
type Range = {
    startMs: number;
    endMs: number;
};
export type SourceSpan = {
    offset: number;
    length: number;
    sourceStart: number;
};
/** Strictly optional metadata: bad alignment can never fail audio playback. */
export declare function parseInworldPhonemes(value: unknown): TtsVisemeCue[] | undefined;
/** Maps the actual crossfaded PCM to the provider clock without altering audio. */
export declare class InworldVisemeTimeline {
    private cues;
    private known;
    ingest(value: unknown, audioRange?: Range): void;
    project(spans: readonly SourceSpan[], sampleRate: number): TtsVisemeCue[] | undefined;
    clear(): void;
    discardBefore(sample: number, sampleRate: number): void;
}
export declare function sliceSourceSpans(spans: readonly SourceSpan[], start: number, end: number): SourceSpan[];
export declare function crossfadeSourceSpans(previous: readonly SourceSpan[], previousLength: number, sourceStart: number, currentLength: number, crossfadeSamples: number): SourceSpan[];
export {};
//# sourceMappingURL=inworld-phonemes.d.ts.map