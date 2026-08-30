/* tslint:disable */
/* eslint-disable */

export class WebRuntime {
    free(): void;
    [Symbol.dispose](): void;
    clear_context(): void;
    complete_user_transcript(text: string): void;
    feed_input_audio(samples: Int16Array, sample_rate_hz: number, channels: number): void;
    flush_output_audio(timestamp_ms: bigint): void;
    get_context_json(): string;
    get_input_stats_json(): string;
    get_state(): string;
    is_running(): boolean;
    constructor(config_json: string);
    notify_output_playback_finished(): void;
    pop_audio_json(): string;
    push_assistant_text(text: string, is_final: boolean): void;
    push_partial_transcript(text: string): void;
    push_tts_audio(samples: Int16Array, sample_rate_hz: number, channels: number, timestamp_ms: bigint): boolean;
    set_config(config_json: string): void;
    start(): void;
    start_listening(): void;
    stop(): void;
    tick(): string;
    trigger_barge_in(): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_webruntime_free: (a: number, b: number) => void;
    readonly webruntime_clear_context: (a: number) => void;
    readonly webruntime_complete_user_transcript: (a: number, b: number, c: number) => [number, number];
    readonly webruntime_feed_input_audio: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly webruntime_flush_output_audio: (a: number, b: bigint) => [number, number];
    readonly webruntime_get_context_json: (a: number) => [number, number, number, number];
    readonly webruntime_get_input_stats_json: (a: number) => [number, number, number, number];
    readonly webruntime_get_state: (a: number) => [number, number];
    readonly webruntime_is_running: (a: number) => number;
    readonly webruntime_new: (a: number, b: number) => [number, number, number];
    readonly webruntime_notify_output_playback_finished: (a: number) => [number, number];
    readonly webruntime_pop_audio_json: (a: number) => [number, number, number, number];
    readonly webruntime_push_assistant_text: (a: number, b: number, c: number, d: number) => [number, number];
    readonly webruntime_push_partial_transcript: (a: number, b: number, c: number) => void;
    readonly webruntime_push_tts_audio: (a: number, b: number, c: number, d: number, e: number, f: bigint) => [number, number, number];
    readonly webruntime_set_config: (a: number, b: number, c: number) => [number, number];
    readonly webruntime_start: (a: number) => [number, number];
    readonly webruntime_start_listening: (a: number) => [number, number];
    readonly webruntime_stop: (a: number) => [number, number];
    readonly webruntime_tick: (a: number) => [number, number, number, number];
    readonly webruntime_trigger_barge_in: (a: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
