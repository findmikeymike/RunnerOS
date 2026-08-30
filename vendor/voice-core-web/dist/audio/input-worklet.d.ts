declare class VoiceCoreInputProcessor {
    constructor(options: any);
    chunkSize: number;
    pending: Float32Array<ArrayBuffer>;
    offset: number;
    process(inputs: any): boolean;
}
//# sourceMappingURL=input-worklet.d.ts.map