export declare class SerialTaskQueue {
    private tail;
    run<T>(operation: () => Promise<T>): Promise<T>;
}
//# sourceMappingURL=SerialTaskQueue.d.ts.map