import type { PocketInstallStatus, VoiceRecord } from "./types";
export declare function parsePocketInstallStatus(value: unknown): PocketInstallStatus;
export declare function encodePocketInstallStatus(value: PocketInstallStatus): Record<string, unknown>;
export declare function parseVoiceRecord(value: unknown): VoiceRecord;
export declare function assertVoiceIdSupported(voiceId?: string): void;
export declare function encodeVoiceRecord(value: VoiceRecord): Record<string, unknown>;
//# sourceMappingURL=voiceAssets.d.ts.map