import type { WebTtsTransport } from "./types.ts";
export type ChatterboxMlxTransportOptions = {
    apiBaseUrl: string;
    sessionToken?: string;
    getAuthHeaders?: () => Record<string, string>;
    onDiagnostic?: (message: string) => void;
};
export declare function checkChatterboxMlxHealth(options: Omit<ChatterboxMlxTransportOptions, "onDiagnostic">): Promise<void>;
export declare function createChatterboxMlxTransport(options: ChatterboxMlxTransportOptions): WebTtsTransport;
//# sourceMappingURL=chatterboxMlx.d.ts.map