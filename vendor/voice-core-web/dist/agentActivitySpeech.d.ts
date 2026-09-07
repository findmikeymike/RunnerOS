import type { LlmTokenEvent } from "./transport/types";
export type AgentActivityKind = "checking" | "acting" | "working";
export type AgentAttentionKind = "approval" | "credential";
export type AgentActivitySpeechOptions = {
    emit(token: LlmTokenEvent): void;
    acknowledgementDelayMs?: number;
    longWaitDelayMs?: number;
    phrases?: Partial<Record<AgentActivityKind | AgentAttentionKind | "long_wait", readonly string[]>>;
    setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
    clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
};
/**
 * Converts trusted host lifecycle events into sparse, deterministic activity
 * speech. It never accepts tool input or model-authored status text.
 */
export declare class AgentActivitySpeechController {
    private readonly emitToken;
    private readonly acknowledgementDelayMs;
    private readonly longWaitDelayMs;
    private readonly phrases;
    private readonly setTimer;
    private readonly clearTimer;
    private acknowledgementTimer;
    private longWaitTimer;
    private generation;
    private phraseIndex;
    private open;
    private answerStarted;
    private acknowledgementSpoken;
    private longWaitSpoken;
    private attentionSpoken;
    constructor(options: AgentActivitySpeechOptions);
    toolStarted(kind?: AgentActivityKind): void;
    attentionRequired(kind: AgentAttentionKind): void;
    answerBeginning(): void;
    finish(): void;
    private isCurrent;
    private speak;
    private cancelTimers;
}
//# sourceMappingURL=agentActivitySpeech.d.ts.map