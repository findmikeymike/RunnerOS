import type { WebTtsTransport } from "../types.js";
import type { ChatterboxTtsTransportControl } from "./index.js";
export type RecoveringChatterboxOptions = {
    createPrimary: () => ChatterboxTtsTransportControl;
    fallback?: WebTtsTransport;
    onDiagnostic?: (message: string) => void;
    onFallback?: (reason: string) => void;
};
export interface RecoveringChatterboxControl extends ChatterboxTtsTransportControl {
    usingFallback(): boolean;
}
export declare function createRecoveringChatterboxTransport(options: RecoveringChatterboxOptions): RecoveringChatterboxControl;
//# sourceMappingURL=recovery.d.ts.map