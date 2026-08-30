import type { WebTtsTransport } from "../types.js";
import { type ChatterboxDtypeMap } from "./protocol.js";
export type ChatterboxTtsTransportOptions = {
    modelBaseUrl?: string;
    modelId?: string;
    modelRevision: string;
    voiceId: string;
    referenceSha256: string;
    referenceAudioUrl: string;
    sessionToken?: string;
    dtypeMap?: ChatterboxDtypeMap;
    referenceSampleRate?: number;
    maxNewTokens?: number;
    repetitionPenalty?: number;
    onDiagnostic?: (message: string) => void;
};
export interface ChatterboxTtsTransportControl extends WebTtsTransport {
    invalidateVoice(voiceId: string): Promise<void>;
}
export declare function createChatterboxTtsTransport(options: ChatterboxTtsTransportOptions): ChatterboxTtsTransportControl;
export declare const createChatterboxTurboWebGpuTransport: typeof createChatterboxTtsTransport;
export type ChatterboxTurboWebGpuTransportOptions = ChatterboxTtsTransportOptions;
//# sourceMappingURL=index.d.ts.map