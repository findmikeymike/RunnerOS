export const MOONSHINE_MODEL_IDS = [
  "moonshine-tiny-streaming-en",
  "moonshine-small-streaming-en",
  "moonshine-medium-streaming-en",
] as const;

export type MoonshineModelId = typeof MOONSHINE_MODEL_IDS[number];
export type LocalSttTier = "lite" | "balanced" | "quality";
export type MoonshineInstallState =
  | "unavailable"
  | "not_installed"
  | "checking"
  | "downloading"
  | "verifying"
  | "installing"
  | "ready"
  | "update_available"
  | "failed"
  | "revoked"
  | "incompatible";

export type MoonshineModelDefinition = {
  modelId: MoonshineModelId;
  productTier: LocalSttTier;
  targetClasses: readonly string[];
  supportStatus: string;
  requiredTotalBytes: number;
};

export type ElectronMoonshineTierStatus = MoonshineModelDefinition & {
  downloadAvailable?: boolean;
  registered: boolean;
  installState: MoonshineInstallState;
  modelVersion?: string;
  completedBytes?: number;
  totalBytes?: number;
  activeVersion?: string;
  inUse: boolean;
  hasError: boolean;
};

export type ElectronMoonshineRuntimeStarted = {
  modelId: MoonshineModelId;
  generation: number;
  preparationState: "unprepared" | "preparing" | "ready" | "failed";
};

export type ElectronMoonshineRuntimePoll = ElectronMoonshineRuntimeStarted & {
  tokens: Array<{
    text: string;
    confidence: number;
    isFinal: boolean;
  }>;
  finalizedTranscript: string;
  finalizationAck?: {
    generation: number;
    turn: number;
    providerEpoch: number;
    throughAudioSeq: number;
  };
  hasError: boolean;
};

export type ElectronMoonshineCapabilities = {
  localStt: boolean;
  moonshineCompiled: boolean;
  moonshineRuntimeAvailable: boolean;
  moonshineModelReady: boolean;
  moonshineModelInstall: boolean;
  moonshineRuntimeMode: "unavailable" | "candidate" | "certified";
  moonshineInstallState: MoonshineInstallState;
  moonshinePreparationState: "idle" | "preparing" | "running" | "failed";
  moonshineSupportStatus: "unavailable" | "experimental" | "certified";
};

export const MOONSHINE_MODEL_REGISTRY: readonly MoonshineModelDefinition[] = [
  {
    modelId: "moonshine-tiny-streaming-en",
    productTier: "lite",
    targetClasses: ["ios", "android", "desktop-low-resource"],
    supportStatus: "candidate-requires-wp-t4-physical-certification",
    requiredTotalBytes: 45_233_659,
  },
  {
    modelId: "moonshine-small-streaming-en",
    productTier: "balanced",
    targetClasses: ["desktop-standard"],
    supportStatus: "candidate-requires-wp-t5-default-decision",
    requiredTotalBytes: 142_300_974,
  },
  {
    modelId: "moonshine-medium-streaming-en",
    productTier: "quality",
    targetClasses: ["desktop-high-resource"],
    supportStatus: "candidate-requires-wp-t5-default-decision",
    requiredTotalBytes: 269_141_623,
  },
] as const;

const DEFINITIONS = new Map<MoonshineModelId, MoonshineModelDefinition>(
  MOONSHINE_MODEL_REGISTRY.map((definition) => [definition.modelId, definition]),
);

export function parseMoonshineModelId(value: unknown): MoonshineModelId {
  if (typeof value !== "string" || !DEFINITIONS.has(value as MoonshineModelId)) {
    throw new TypeError("Unsupported Moonshine model ID");
  }
  return value as MoonshineModelId;
}

export interface ElectronMoonshineHost {
  capabilities(): Promise<ElectronMoonshineCapabilities>;
  listTiers(): Promise<ElectronMoonshineTierStatus[]>;
  getTierStatus(modelId: unknown): Promise<ElectronMoonshineTierStatus>;
  installBundled(modelId: unknown): Promise<ElectronMoonshineTierStatus>;
  installStaged(modelId: unknown): Promise<ElectronMoonshineTierStatus>;
  beginStaged(modelId: unknown): Promise<void>;
  writeStaged(modelId: unknown, asset: "manifest" | "archive", chunk: Uint8Array): Promise<void>;
  finishStaged(modelId: unknown): Promise<void>;
  cleanupStaged(modelId: unknown): Promise<void>;
  cancelInstall(modelId: unknown): Promise<ElectronMoonshineTierStatus>;
  remove(modelId: unknown): Promise<ElectronMoonshineTierStatus>;
  startRuntime(modelId: unknown): Promise<ElectronMoonshineRuntimeStarted>;
  feedRuntimeAudio(audio: Uint8Array, sampleRateHz: number, channels: number): Promise<void>;
  pollRuntime(): Promise<ElectronMoonshineRuntimePoll>;
  requestRuntimeFinalization(turn: number): Promise<void>;
  finishRuntimeTurn(turn: number): Promise<void>;
  cancelRuntime(): Promise<void>;
  stopRuntime(): Promise<void>;
  acceptsModel(modelId: MoonshineModelId): boolean;
  shutdown(): void;
}

export class UnavailableElectronMoonshineHost implements ElectronMoonshineHost {
  async capabilities(): Promise<ElectronMoonshineCapabilities> {
    return {
      localStt: false,
      moonshineCompiled: false,
      moonshineRuntimeAvailable: false,
      moonshineModelReady: false,
      moonshineModelInstall: false,
      moonshineRuntimeMode: "unavailable",
      moonshineInstallState: "unavailable",
      moonshinePreparationState: "idle",
      moonshineSupportStatus: "unavailable",
    };
  }

  async listTiers(): Promise<ElectronMoonshineTierStatus[]> {
    return MOONSHINE_MODEL_REGISTRY.map(unavailableStatus);
  }

  async getTierStatus(modelId: unknown): Promise<ElectronMoonshineTierStatus> {
    const parsed = parseMoonshineModelId(modelId);
    return unavailableStatus(DEFINITIONS.get(parsed)!);
  }

  async installBundled(modelId: unknown): Promise<ElectronMoonshineTierStatus> {
    parseMoonshineModelId(modelId);
    throw new Error("Moonshine native model installation is unavailable in this Electron build");
  }

  async installStaged(modelId: unknown): Promise<ElectronMoonshineTierStatus> {
    parseMoonshineModelId(modelId);
    throw new Error("Moonshine native model installation is unavailable in this Electron build");
  }

  async cleanupStaged(modelId: unknown): Promise<void> {
    parseMoonshineModelId(modelId);
    throw new Error("Moonshine native staging cleanup is unavailable in this Electron build");
  }

  async beginStaged(modelId: unknown): Promise<void> {
    parseMoonshineModelId(modelId);
    throw new Error("Moonshine native staging is unavailable in this Electron build");
  }

  async writeStaged(modelId: unknown, _asset: "manifest" | "archive", _chunk: Uint8Array): Promise<void> {
    parseMoonshineModelId(modelId);
    throw new Error("Moonshine native staging is unavailable in this Electron build");
  }

  async finishStaged(modelId: unknown): Promise<void> {
    parseMoonshineModelId(modelId);
    throw new Error("Moonshine native staging is unavailable in this Electron build");
  }

  async cancelInstall(modelId: unknown): Promise<ElectronMoonshineTierStatus> {
    parseMoonshineModelId(modelId);
    throw new Error("Moonshine native model installation is unavailable in this Electron build");
  }

  async remove(modelId: unknown): Promise<ElectronMoonshineTierStatus> {
    parseMoonshineModelId(modelId);
    throw new Error("Moonshine native model installation is unavailable in this Electron build");
  }

  async startRuntime(modelId: unknown): Promise<ElectronMoonshineRuntimeStarted> {
    parseMoonshineModelId(modelId);
    throw new Error("Moonshine native runtime is unavailable in this Electron build");
  }

  async feedRuntimeAudio(_audio: Uint8Array, _sampleRateHz: number, _channels: number): Promise<void> {
    throw new Error("Moonshine native runtime is unavailable in this Electron build");
  }

  async pollRuntime(): Promise<ElectronMoonshineRuntimePoll> {
    throw new Error("Moonshine native runtime is unavailable in this Electron build");
  }

  async requestRuntimeFinalization(_turn: number): Promise<void> {
    throw new Error("Moonshine native runtime is unavailable in this Electron build");
  }

  async finishRuntimeTurn(_turn: number): Promise<void> {
    throw new Error("Moonshine native runtime is unavailable in this Electron build");
  }

  async cancelRuntime(): Promise<void> {
    throw new Error("Moonshine native runtime is unavailable in this Electron build");
  }

  async stopRuntime(): Promise<void> {
    throw new Error("Moonshine native runtime is unavailable in this Electron build");
  }

  acceptsModel(_modelId: MoonshineModelId): boolean {
    return false;
  }

  shutdown(): void {}
}

function unavailableStatus(definition: MoonshineModelDefinition): ElectronMoonshineTierStatus {
  return {
    ...definition,
    registered: false,
    installState: "unavailable",
    inUse: false,
    hasError: false,
  };
}
