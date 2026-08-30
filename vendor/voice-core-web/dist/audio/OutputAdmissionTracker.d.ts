export declare class OutputAdmissionTracker {
    private readonly timeoutMs;
    private nextRequestId;
    private pending;
    constructor(timeoutMs: number);
    create(): {
        requestId: number;
        promise: Promise<void>;
    };
    settle(requestId: number, accepted: boolean): boolean;
    cancelAll(message: string): void;
}
//# sourceMappingURL=OutputAdmissionTracker.d.ts.map